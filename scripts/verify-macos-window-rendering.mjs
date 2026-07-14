import { constants } from 'node:fs'
import {
  access,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'

const execFileAsync = promisify(execFile)
const repoRoot = resolve(import.meta.dirname, '..')
const probeSourcePath = join(
  repoRoot,
  'scripts',
  'macos-window-rendering-probe.swift',
)
const probeTimeoutSeconds = 20

/** Waits without blocking Node so launch and shutdown polling stay responsive.
 * @param {number} milliseconds - Duration to wait.
 * @returns {Promise<void>} Promise settled after the requested duration.
 * @example await delay(400)
 */
function delay(milliseconds) {
  return new Promise((settle) => setTimeout(settle, milliseconds))
}

/** Resolves an explicit app bundle or the current-architecture electron-builder output.
 * @param {string | undefined} requestedPath - Optional `.app` path from the CLI.
 * @returns {Promise<string>} Existing absolute app-bundle path.
 * @example await resolveAppBundle('dist/mac-arm64/Skills Desktop.app')
 */
async function resolveAppBundle(requestedPath) {
  const architectureDirectory = process.arch === 'arm64' ? 'mac-arm64' : 'mac'
  const fallbackDirectory = process.arch === 'arm64' ? 'mac' : 'mac-arm64'
  const candidates = requestedPath
    ? [resolve(process.cwd(), requestedPath)]
    : [
        join(repoRoot, 'dist', architectureDirectory, 'Skills Desktop.app'),
        join(repoRoot, 'dist', fallbackDirectory, 'Skills Desktop.app'),
      ]

  for (const candidate of candidates) {
    try {
      await access(candidate, constants.R_OK)
      // LaunchServices reports the physical bundle path even when the CLI received a symlink.
      return await realpath(candidate)
    } catch {
      // A release machine may have built only one architecture, so try the next known output.
    }
  }

  throw new Error(
    `Packaged app not found. Build it first or pass its path:\n  pnpm test:release:macos-window -- "/path/to/Skills Desktop.app"`,
  )
}

/** Reads the bundle-declared executable instead of assuming it matches a possibly renamed `.app`.
 * @param {string} appBundlePath - Absolute `.app` bundle path.
 * @returns {Promise<string>} Absolute path to the bundle's main executable.
 * @example await executablePathFor('/tmp/Renamed Skills.app')
 */
async function executablePathFor(appBundlePath) {
  const infoPlistPath = join(appBundlePath, 'Contents', 'Info.plist')
  const { stdout } = await execFileAsync('/usr/libexec/PlistBuddy', [
    '-c',
    'Print :CFBundleExecutable',
    infoPlistPath,
  ])
  const executableName = stdout.trim()
  if (!executableName) {
    throw new Error(`CFBundleExecutable is missing from ${infoPlistPath}`)
  }
  return join(appBundlePath, 'Contents', 'MacOS', executableName)
}

/** Starts the app through LaunchServices with a unique token and isolated writable state.
 * @param {string} appBundlePath - Signed package to verify.
 * @param {string} homeDirectory - Temporary HOME used for skill scanning.
 * @param {string} userDataDirectory - Temporary Electron userData directory.
 * @param {string} launchToken - Unique argv marker used to discover the new app PID.
 * @returns {import('node:child_process').ChildProcess} Waiting `open` process owned by this run.
 * @example launchApp('/tmp/Skills Desktop.app', '/tmp/home', '/tmp/userData', 'token')
 */
function launchApp(
  appBundlePath,
  homeDirectory,
  userDataDirectory,
  launchToken,
) {
  return spawn(
    '/usr/bin/open',
    [
      '-n',
      '-F',
      '-W',
      '--env',
      `HOME=${homeDirectory}`,
      '--env',
      `E2E_USERDATA_DIR=${userDataDirectory}`,
      '--env',
      'E2E_DISABLE_UPDATE=1',
      '--env',
      'E2E_BACKGROUND_LAUNCH=0',
      '--env',
      'ELECTRON_RUN_AS_NODE=',
      appBundlePath,
      '--args',
      `--skills-desktop-window-smoke=${launchToken}`,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
}

/** Waits until `open` confirms that LaunchServices accepted the app request.
 * @param {import('node:child_process').ChildProcess} openProcess - Process returned by `launchApp`.
 * @returns {Promise<void>} Settles on spawn or rejects with the OS launch error.
 * @example await waitForSpawn(openProcess)
 */
async function waitForSpawn(openProcess) {
  await new Promise((settle, reject) => {
    openProcess.once('spawn', settle)
    openProcess.once('error', reject)
  })
}

/** Finds the exact app instance LaunchServices created by matching executable path and unique argv.
 * @param {string} executablePath - App bundle's main executable.
 * @param {string} launchToken - Unique marker passed only to this launch.
 * @param {number} timeoutMilliseconds - Maximum process-table polling time.
 * @returns {Promise<number>} PID of the newly launched Electron main process.
 * @example await findLaunchedAppPID(executable, token, 10000)
 */
async function findLaunchedAppPID(
  executablePath,
  launchToken,
  timeoutMilliseconds,
) {
  const deadline = Date.now() + timeoutMilliseconds
  while (Date.now() < deadline) {
    const { stdout } = await execFileAsync('/bin/ps', ['-axo', 'pid=,command='])
    let tokenOwnedMainPID
    for (const line of stdout.split('\n')) {
      const match = line.match(/^\s*(\d+)\s+(.+)$/)
      if (!match) continue
      const command = match[2]
      if (command.includes(executablePath) && command.includes(launchToken)) {
        return Number(match[1])
      }
      if (
        command.includes('/Contents/MacOS/') &&
        command.includes(launchToken)
      ) {
        // The UUID is passed only to this launch; retain a safe cleanup handle if ps normalizes paths differently.
        tokenOwnedMainPID = Number(match[1])
      }
    }
    if (tokenOwnedMainPID !== undefined) return tokenOwnedMainPID

    // LaunchServices returns before Electron necessarily appears in the process table.
    await delay(200)
  }
  throw new Error(
    'LaunchServices did not create the packaged app process in time.',
  )
}

/** Reports whether an OS process still exists without sending a terminating signal.
 * @param {number} pid - Process identifier to probe.
 * @returns {boolean} `true` while the process exists or cannot be signalled.
 * @example isProcessRunning(123)
 */
function isProcessRunning(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code !== 'ESRCH'
  }
}

/** Stops only the isolated app instance, allowing Electron helpers to follow their parent.
 * @param {number | undefined} pid - App PID discovered from the unique launch token.
 * @returns {Promise<void>} Settles after graceful exit or a final forced stop.
 * @example await stopApp(123)
 */
async function stopApp(pid) {
  if (pid === undefined || !isProcessRunning(pid)) return

  process.kill(pid, 'SIGTERM')
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!isProcessRunning(pid)) return
    await delay(100)
  }

  // A hung release candidate must not outlive the smoke run or pollute the next attempt.
  if (isProcessRunning(pid)) process.kill(pid, 'SIGKILL')
}

/** Stops the waiting `open -W` process when launch or probing fails early.
 * @param {import('node:child_process').ChildProcess | undefined} openProcess - LaunchServices wrapper.
 * @returns {void} Nothing.
 * @example stopOpenProcess(openProcess)
 */
function stopOpenProcess(openProcess) {
  if (openProcess?.exitCode === null) openProcess.kill('SIGTERM')
}

/** Writes deterministic startup preferences so the capture is opaque, bounded, and updater-free.
 * @param {string} userDataDirectory - Isolated Electron profile directory.
 * @returns {Promise<void>} Settles after settings.json is ready before launch.
 * @example await writeSmokeSettings('/tmp/profile')
 */
async function writeSmokeSettings(userDataDirectory) {
  await mkdir(userDataDirectory, { recursive: true })
  await writeFile(
    join(userDataDirectory, 'settings.json'),
    JSON.stringify(
      {
        windowSize: { width: 1200, height: 800 },
        windowBackgroundBlurRadius: 0,
        autoDownloadUpdates: false,
      },
      null,
      2,
    ),
    'utf8',
  )
}

/** Runs the signed-package native rendering gate and preserves artifacts only on failure.
 * @returns {Promise<void>} Settles when a real native UI surface is observed.
 * @example await main()
 */
async function main() {
  if (process.platform !== 'darwin') {
    throw new Error('The packaged-window rendering smoke test requires macOS.')
  }

  // pnpm preserves the conventional `--` separator in the child argv on some versions.
  const requestedPaths = process.argv
    .slice(2)
    .filter((argument) => argument !== '--')
  if (requestedPaths.length > 1) {
    throw new Error('Pass at most one packaged `.app` path.')
  }
  const appBundlePath = await resolveAppBundle(requestedPaths[0])
  const executablePath = await executablePathFor(appBundlePath)
  await access(executablePath, constants.X_OK)

  const temporaryRoot = await mkdtemp(
    join(tmpdir(), 'skills-desktop-window-smoke-'),
  )
  const homeDirectory = join(temporaryRoot, 'home')
  const userDataDirectory = join(temporaryRoot, 'userData')
  const probeBinaryPath = join(temporaryRoot, 'macos-window-rendering-probe')
  const screenshotPath = join(temporaryRoot, 'packaged-window.png')
  const launchToken = randomUUID()
  let appPID
  let openProcess
  let passed = false

  try {
    await mkdir(homeDirectory, { recursive: true })
    await writeSmokeSettings(userDataDirectory)
    console.log(`Building native rendering probe: ${probeSourcePath}`)
    await execFileAsync('/usr/bin/xcrun', [
      'swiftc',
      '-O',
      probeSourcePath,
      '-o',
      probeBinaryPath,
    ])

    console.log(`Launching packaged app: ${appBundlePath}`)
    openProcess = launchApp(
      appBundlePath,
      homeDirectory,
      userDataDirectory,
      launchToken,
    )
    await waitForSpawn(openProcess)
    appPID = await findLaunchedAppPID(executablePath, launchToken, 10_000)
    console.log(`Inspecting native window for PID ${appPID}...`)

    try {
      const { stdout, stderr } = await execFileAsync(probeBinaryPath, [
        String(appPID),
        screenshotPath,
        String(probeTimeoutSeconds),
      ])
      if (stdout) process.stdout.write(stdout)
      if (stderr) process.stderr.write(stderr)
    } catch (error) {
      if (error?.stdout) process.stdout.write(error.stdout)
      if (error?.stderr) process.stderr.write(error.stderr)
      if (error?.code === 2) {
        throw new Error(
          `Packaged window stayed visually blank for ${probeTimeoutSeconds}s. Screenshot: ${screenshotPath}`,
        )
      }
      throw error
    }

    passed = true
    console.log('✅ Packaged macOS window contains rendered UI.')
  } finally {
    await stopApp(appPID)
    stopOpenProcess(openProcess)
    if (passed) {
      await rm(temporaryRoot, { recursive: true, force: true })
    } else {
      console.error(`Smoke artifacts retained at: ${temporaryRoot}`)
    }
  }
}

main().catch((error) => {
  console.error(`❌ ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
