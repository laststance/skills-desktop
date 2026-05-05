/**
 * Clamp a desired window size to a display's usable work area.
 *
 * "Work area" excludes the macOS menu bar and Dock — the same region the OS
 * lets a window cover without going off-screen. We use `screen.getDisplayMatching`
 * to pick the display the window would actually open on (in practice the
 * primary display at launch — Electron offers no API for "the display the
 * cursor is on" before a window exists).
 *
 * Why clamp at all: a user may save a size on a wide external monitor and
 * later launch on a 13" laptop. Without clamping the window would either
 * open off-screen or get force-shrunk by macOS — both feel broken. Clamping
 * to `min(saved, workAreaSize)` keeps the window fully visible while
 * respecting the user's preference whenever the display can fit it.
 *
 * @param desired - The size the user persisted in settings
 * @param workArea - The display's usable size (Display.workAreaSize)
 * @returns The clamped size — both dimensions ≤ workArea
 * @example
 * clampSizeToWorkArea({ width: 3000, height: 2000 }, { width: 1440, height: 900 })
 * // => { width: 1440, height: 900 }
 * clampSizeToWorkArea({ width: 1000, height: 700 }, { width: 1440, height: 900 })
 * // => { width: 1000, height: 700 }
 */
export function clampSizeToWorkArea(
  desired: { width: number; height: number },
  workArea: { width: number; height: number },
): { width: number; height: number } {
  return {
    width: Math.min(desired.width, workArea.width),
    height: Math.min(desired.height, workArea.height),
  }
}
