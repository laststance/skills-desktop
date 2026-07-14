import AppKit
import CoreGraphics
import Foundation
import ImageIO

/// Native image measurements used to distinguish rendered UI from a compositor-level flat surface.
struct RenderingMetrics {
  let width: Int
  let height: Int
  let sampledPixels: Int
  let luminanceStandardDeviation: Double
  let nonBackgroundRatio: Double
  let quantizedColors: Int
}

/// A captured window and the variation measured inside its client area.
struct RenderingProbeResult {
  let windowID: CGWindowID
  let metrics: RenderingMetrics
}

/// Operational failures are separate from the intentional blank-window exit code used by the release gate.
enum RenderingProbeError: Error, CustomStringConvertible {
  case usage
  case noWindow(pid_t)
  case screenRecordingPermissionMissing
  case captureFailed(Int32)
  case imageLoadFailed(String)
  case bitmapFailed

  var description: String {
    switch self {
    case .usage:
      return
        "usage: macos-window-rendering-probe <pid> <output.png> [timeout-seconds] | --image <input.png>"
    case .noWindow(let pid):
      return "no eligible visible layer-0 window appeared for PID \(pid)"
    case .screenRecordingPermissionMissing:
      return "Screen Recording permission is required to inspect the packaged app window"
    case .captureFailed(let status):
      return "screencapture failed with exit status \(status)"
    case .imageLoadFailed(let path):
      return "could not load PNG at \(path)"
    case .bitmapFailed:
      return "could not decode the captured PNG into an RGBA bitmap"
    }
  }
}

private let maximumBlankLuminanceStandardDeviation = 2.0
private let maximumBlankNonBackgroundRatio = 0.01

/// Finds the largest visible normal window owned by a process.
/// @param pid Process identifier whose top-level window should be captured.
/// @returns Core Graphics window number, or throws while no candidate exists.
/// @example `try largestWindowID(for: 123)`
func largestWindowID(for pid: pid_t) throws -> CGWindowID {
  let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
  guard let entries = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[CFString: Any]]
  else {
    throw RenderingProbeError.noWindow(pid)
  }

  let candidates: [(CGWindowID, Double)] = entries.compactMap { entry in
    guard
      let ownerPID = entry[kCGWindowOwnerPID] as? NSNumber,
      ownerPID.int32Value == pid,
      let layer = entry[kCGWindowLayer] as? NSNumber,
      layer.intValue == 0,
      let windowNumber = entry[kCGWindowNumber] as? NSNumber,
      let boundsDictionary = entry[kCGWindowBounds] as? NSDictionary,
      let bounds = CGRect(dictionaryRepresentation: boundsDictionary),
      bounds.width >= 200,
      bounds.height >= 150
    else {
      return nil
    }

    return (CGWindowID(windowNumber.uint32Value), bounds.width * bounds.height)
  }

  guard let candidate = candidates.max(by: { $0.1 < $1.1 }) else {
    throw RenderingProbeError.noWindow(pid)
  }
  return candidate.0
}

/// Captures one native window without sound or shadow so only app pixels are classified.
/// @param windowID Core Graphics window number returned by `largestWindowID`.
/// @param outputURL Destination PNG URL.
/// @returns Nothing; throws when the system capture command fails.
/// @example `try capture(windowID: 42, to: URL(fileURLWithPath: "/tmp/app.png"))`
func capture(windowID: CGWindowID, to outputURL: URL) throws {
  let process = Process()
  process.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
  process.arguments = ["-x", "-o", "-l", String(windowID), outputURL.path]
  try process.run()
  process.waitUntilExit()
  guard process.terminationStatus == 0 else {
    throw RenderingProbeError.captureFailed(process.terminationStatus)
  }
}

/// Measures central client-area variation while ignoring borders and the title bar.
/// @param imageURL Captured PNG to inspect.
/// @returns Variation metrics that separate a flat renderer from real UI.
/// @example `let metrics = try analyze(URL(fileURLWithPath: "/tmp/app.png"))`
func analyze(_ imageURL: URL) throws -> RenderingMetrics {
  guard
    let source = CGImageSourceCreateWithURL(imageURL as CFURL, nil),
    let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
  else {
    throw RenderingProbeError.imageLoadFailed(imageURL.path)
  }

  let width = image.width
  let height = image.height
  let bytesPerPixel = 4
  let bytesPerRow = width * bytesPerPixel
  var pixels = [UInt8](repeating: 0, count: height * bytesPerRow)
  guard
    let context = CGContext(
      data: &pixels,
      width: width,
      height: height,
      bitsPerComponent: 8,
      bytesPerRow: bytesPerRow,
      space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    )
  else {
    throw RenderingProbeError.bitmapFailed
  }
  context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))

  // Ignore borders and top chrome, then sample every fourth pixel so 4K windows stay fast.
  let xStart = max(0, width / 20)
  let xEnd = min(width, width - width / 20)
  let yStart = max(0, height / 10)
  let yEnd = min(height, height - height / 20)
  var luminanceValues: [Double] = []
  var histogram: [UInt32: Int] = [:]

  for y in stride(from: yStart, to: yEnd, by: 4) {
    for x in stride(from: xStart, to: xEnd, by: 4) {
      let offset = y * bytesPerRow + x * bytesPerPixel
      let red = pixels[offset]
      let green = pixels[offset + 1]
      let blue = pixels[offset + 2]
      let luminance = 0.2126 * Double(red) + 0.7152 * Double(green) + 0.0722 * Double(blue)
      luminanceValues.append(luminance)

      // Five bits per channel absorbs antialiasing noise without hiding real UI colors.
      let color = (UInt32(red >> 3) << 10) | (UInt32(green >> 3) << 5) | UInt32(blue >> 3)
      histogram[color, default: 0] += 1
    }
  }

  let count = max(1, luminanceValues.count)
  let mean = luminanceValues.reduce(0, +) / Double(count)
  let variance =
    luminanceValues.reduce(0) { partial, value in
      partial + (value - mean) * (value - mean)
    } / Double(count)
  let dominantCount = histogram.values.max() ?? count

  return RenderingMetrics(
    width: width,
    height: height,
    sampledPixels: count,
    luminanceStandardDeviation: sqrt(variance),
    nonBackgroundRatio: 1 - Double(dominantCount) / Double(count),
    quantizedColors: histogram.count
  )
}

/// Classifies the Electron 43 regression only when both luminance and color variation are nearly absent.
/// @param metrics Captured image variation measurements.
/// @returns `true` when the client area is effectively one flat color.
/// @example `isEffectivelyBlank(metrics)`
func isEffectivelyBlank(_ metrics: RenderingMetrics) -> Bool {
  metrics.luminanceStandardDeviation < maximumBlankLuminanceStandardDeviation
    && metrics.nonBackgroundRatio < maximumBlankNonBackgroundRatio
}

/// Prints stable machine-readable measurements for release logs and failure diagnosis.
/// @param windowID Optional Core Graphics window identifier for live captures.
/// @param imageURL PNG that produced the measurements.
/// @param metrics Captured image variation measurements.
/// @returns Nothing.
/// @example `report(windowID: 42, imageURL: imageURL, metrics: metrics)`
func report(windowID: CGWindowID?, imageURL: URL, metrics: RenderingMetrics) {
  if let windowID {
    print("windowID=\(windowID) png=\(imageURL.path)")
  } else {
    print("png=\(imageURL.path)")
  }
  print(
    String(
      format: "size=%dx%d samples=%d lumaStdDev=%.4f nonBackgroundRatio=%.6f quantizedColors=%d",
      metrics.width,
      metrics.height,
      metrics.sampledPixels,
      metrics.luminanceStandardDeviation,
      metrics.nonBackgroundRatio,
      metrics.quantizedColors
    )
  )
  print("classification=\(isEffectivelyBlank(metrics) ? "SOLID_BLANK" : "REAL_UI")")
}

/// Polls the native compositor until real UI appears or the timeout proves the window stayed flat.
/// @param pid Process identifier launched through macOS LaunchServices.
/// @param outputURL Destination overwritten by each capture attempt.
/// @param timeoutSeconds Maximum time to tolerate startup-only flat frames.
/// @returns The first non-blank result, or the final blank result at timeout.
/// @example `try waitForRenderedWindow(pid: 123, outputURL: imageURL, timeoutSeconds: 20)`
func waitForRenderedWindow(
  pid: pid_t,
  outputURL: URL,
  timeoutSeconds: TimeInterval
) throws -> RenderingProbeResult {
  guard CGPreflightScreenCaptureAccess() else {
    throw RenderingProbeError.screenRecordingPermissionMissing
  }

  let deadline = Date().addingTimeInterval(timeoutSeconds)
  var lastBlankResult: RenderingProbeResult?

  repeat {
    do {
      let windowID = try largestWindowID(for: pid)
      try capture(windowID: windowID, to: outputURL)
      let result = RenderingProbeResult(windowID: windowID, metrics: try analyze(outputURL))
      if !isEffectivelyBlank(result.metrics) {
        return result
      }
      lastBlankResult = result
    } catch RenderingProbeError.noWindow(_) {
      // LaunchServices can report the process before WindowServer publishes its first window.
    }

    Thread.sleep(forTimeInterval: 0.4)
  } while Date() < deadline

  if let lastBlankResult {
    return lastBlankResult
  }
  throw RenderingProbeError.noWindow(pid)
}

do {
  if CommandLine.arguments.count == 3, CommandLine.arguments[1] == "--image" {
    let imageURL = URL(fileURLWithPath: CommandLine.arguments[2])
    let metrics = try analyze(imageURL)
    report(windowID: nil, imageURL: imageURL, metrics: metrics)
    exit(isEffectivelyBlank(metrics) ? 2 : 0)
  }

  guard
    (3...4).contains(CommandLine.arguments.count),
    let pid = pid_t(CommandLine.arguments[1]),
    let timeoutSeconds = CommandLine.arguments.count == 4
      ? TimeInterval(CommandLine.arguments[3])
      : 20,
    timeoutSeconds > 0
  else {
    throw RenderingProbeError.usage
  }

  let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])
  let result = try waitForRenderedWindow(
    pid: pid,
    outputURL: outputURL,
    timeoutSeconds: timeoutSeconds
  )
  report(windowID: result.windowID, imageURL: outputURL, metrics: result.metrics)
  exit(isEffectivelyBlank(result.metrics) ? 2 : 0)
} catch {
  fputs("error: \(error)\n", stderr)
  exit(1)
}
