import { autoUpdater } from 'electron-updater'

import { IPC_CHANNELS } from '@/shared/ipc-channels'
import type { Settings } from '@/shared/settings'
import { semanticVersion } from '@/shared/types'

import { broadcastTypedEvent as broadcastEvent } from './ipc/typedSend'
import { getSettings } from './services/settings'

/**
 * Delay before the boot-time update check fires, giving the renderer time to
 * mount and subscribe to the `update:*` IPC channels before the first
 * `update-available`/`update-not-available` event is broadcast.
 */
const UPDATE_CHECK_DELAY_MS = 3000

/**
 * Push the user's persisted update preference onto the live
 * `electron-updater` singleton. Called once at init (so the boot-time
 * update check honors the saved value) and again from the `settings:set`
 * IPC handler whenever `autoDownloadUpdates` flips, so a mid-session change
 * takes effect on the next check without an app restart.
 *
 * Also pins `autoInstallOnAppQuit` to `false`: electron-updater defaults it
 * to `true`, which would silently install an already-downloaded update on the
 * next quit and bypass the app's explicit confirm-via-UI install flow. Pinning
 * it here (idempotently re-applied on every preference change) keeps installs
 * user-initiated regardless of the auto-download setting.
 * @param preferences - The `autoDownloadUpdates` slice of Settings.
 * @example
 * applyUpdaterPreferences({ autoDownloadUpdates: true })
 * // autoUpdater.autoDownload === true, autoUpdater.autoInstallOnAppQuit === false
 */
export function applyUpdaterPreferences(
  preferences: Pick<Settings, 'autoDownloadUpdates'>,
): void {
  autoUpdater.autoDownload = preferences.autoDownloadUpdates
  // Never auto-install on quit — install stays user-initiated via the UI.
  autoUpdater.autoInstallOnAppQuit = false
}

/**
 * Register the `electron-updater` lifecycle handlers that forward each phase
 * to the renderer as a typed IPC broadcast. Extracted so both the production
 * `initAutoUpdater` and the test-only `initAutoUpdaterForE2E` share one
 * source of truth for the event-to-IPC mapping (no behavior drift between
 * the two entry points).
 * @example
 * registerUpdaterEventHandlers()
 * // autoUpdater now broadcasts UPDATE_CHECKING / UPDATE_AVAILABLE / etc. over IPC
 */
function registerUpdaterEventHandlers(): void {
  autoUpdater.on('checking-for-update', () => {
    console.log('Checking for updates...')
    broadcastEvent(IPC_CHANNELS.UPDATE_CHECKING)
  })

  autoUpdater.on('update-available', (info) => {
    console.log('Update available:', info.version)
    broadcastEvent(IPC_CHANNELS.UPDATE_AVAILABLE, {
      version: semanticVersion(info.version),
      releaseNotes:
        typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
    })
  })

  autoUpdater.on('update-not-available', () => {
    console.log('No updates available')
    broadcastEvent(IPC_CHANNELS.UPDATE_NOT_AVAILABLE)
  })

  autoUpdater.on('error', (err) => {
    console.error('Auto updater error:', err)
    broadcastEvent(IPC_CHANNELS.UPDATE_ERROR, { message: err.message })
  })

  autoUpdater.on('download-progress', (progress) => {
    console.log(`Download progress: ${progress.percent.toFixed(1)}%`)
    broadcastEvent(IPC_CHANNELS.UPDATE_PROGRESS, {
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      total: progress.total,
      transferred: progress.transferred,
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    console.log('Update downloaded:', info.version)
    broadcastEvent(IPC_CHANNELS.UPDATE_DOWNLOADED, {
      version: semanticVersion(info.version),
      releaseNotes:
        typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
    })
  })
}

/**
 * Initialize auto updater with IPC-based UI notifications
 * Replaces native dialogs with in-app toast notifications
 */
export function initAutoUpdater(): void {
  // Seed the updater from the persisted user preference. The default keeps
  // autoDownload off, preserving the manual confirm-via-UI flow.
  applyUpdaterPreferences(getSettings())

  registerUpdaterEventHandlers()

  // Check for updates after a short delay
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('Failed to check for updates:', err)
    })
  }, UPDATE_CHECK_DELAY_MS)
}

/**
 * Options for {@link initAutoUpdaterForE2E}.
 */
interface E2EUpdaterOptions {
  /** Localhost generic feed base URL; macOS GETs `<feedUrl>/latest-mac.yml`. */
  feedUrl: string
  /**
   * Baseline version the feed is compared against. Set LOW (e.g. "0.0.1") so a
   * higher advertised feed version compares as available. Omit to keep the
   * real `app.version`.
   */
  currentVersion?: string
}

/**
 * Guard the test-only update feed URL to a localhost loopback http origin —
 * `E2E_UPDATE_FEED_URL` flows straight into `setFeedURL`, so this stops the
 * offline-E2E seam from ever being pointed at a real network host (which would
 * also bypass the production `app.isPackaged` gate). Throws on any non-loopback
 * or non-http URL; called first in {@link initAutoUpdaterForE2E}.
 * @param feedUrl - Candidate feed base URL injected by the e2e harness.
 * @returns void — returns only for a loopback http URL; throws otherwise.
 * @example
 * assertLoopbackFeedUrl('http://127.0.0.1:54321') // ok
 * assertLoopbackFeedUrl('https://example.com')    // throws
 */
function assertLoopbackFeedUrl(feedUrl: string): void {
  const parsedFeedUrl = new URL(feedUrl)
  // WHATWG URL keeps IPv6 hosts bracketed (e.g. "[::1]"); strip the brackets so
  // the bare-address comparison matches a real IPv6 loopback feed URL too.
  const hostname = parsedFeedUrl.hostname.replace(/^\[|\]$/g, '')
  const isLoopbackHost =
    hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1'
  if (parsedFeedUrl.protocol !== 'http:' || !isLoopbackHost) {
    throw new Error(`E2E update feed must use a loopback http URL: ${feedUrl}`)
  }
}

/**
 * TEST-ONLY seam that drives a deterministic, OFFLINE update-DETECTION check
 * against a localhost generic feed. Reached only from `src/main/index.ts` when
 * the `E2E_UPDATE_FEED_URL` env var is set, which the Electron e2e spec
 * (`e2e/spec/update-detection.e2e.ts`) injects; it is NEVER set in production,
 * so this function is dead code in shipped builds. It forces dev-mode update
 * config (so a check runs in the unpacked build), disables auto-download (the
 * dummy artifact is never fetched), optionally lowers `currentVersion` so the
 * feed compares as newer, points the feed at localhost, registers the shared
 * IPC handlers, and triggers the check immediately (no boot delay).
 * @param options - {@link E2EUpdaterOptions}: `feedUrl` (required localhost URL) and optional `currentVersion`.
 * @example
 * // Driven by the e2e harness, never in production:
 * initAutoUpdaterForE2E({ feedUrl: 'http://127.0.0.1:54321', currentVersion: '0.0.1' })
 * // -> GET http://127.0.0.1:54321/latest-mac.yml, then broadcasts UPDATE_AVAILABLE for the higher feed version
 */
export function initAutoUpdaterForE2E(options: E2EUpdaterOptions): void {
  // Defense-in-depth: this seam takes its URL straight from an env var, so
  // refuse anything but a localhost loopback http feed before wiring it in.
  assertLoopbackFeedUrl(options.feedUrl)

  // Allow an update CHECK in the UNPACKED e2e build. Without this,
  // isUpdaterActive() short-circuits (app.isPackaged === false) and
  // checkForUpdates() logs "Skip checkForUpdates because application is not
  // packed and dev update config is not forced" and does nothing.
  autoUpdater.forceDevUpdateConfig = true

  // Detection-only: never fetch the dummy artifact. With autoDownload=false the
  // availability check stops after the version comparison (downloadPromise is null).
  autoUpdater.autoDownload = false

  // Force the comparison baseline LOW so the higher feed version compares as
  // newer. `currentVersion` is declared `readonly currentVersion: SemVer` in
  // electron-updater's .d.ts, but at runtime it is a plain writable instance
  // field, and the comparison path uses semver gt/eq which accept a string —
  // so a plain string works (e.g. gt('99.0.0','0.0.1') === true). The cast is
  // REQUIRED to assign past the readonly type; importing `semver` to build a
  // SemVer is not viable (transitive-only dep, ESM main process has no require).
  if (options.currentVersion !== undefined) {
    ;(autoUpdater as unknown as { currentVersion: string }).currentVersion =
      options.currentVersion
  }

  // Point at the localhost generic feed. On macOS this GETs <feedUrl>/latest-mac.yml.
  // Calling setFeedURL before checkForUpdates also short-circuits the on-disk
  // dev-app-update.yml lookup, keeping the test fully offline.
  autoUpdater.setFeedURL({ provider: 'generic', url: options.feedUrl })

  registerUpdaterEventHandlers()

  // Trigger detection immediately (no boot delay): fetch + parse + compare the
  // yml, then broadcast UPDATE_AVAILABLE. No artifact download.
  autoUpdater.checkForUpdates().catch((err) => {
    console.error('Failed to check for updates (E2E):', err)
  })
}

/**
 * Manually trigger update download
 * Called from renderer via IPC
 */
export function downloadUpdate(): void {
  autoUpdater.downloadUpdate()
}

/**
 * Install downloaded update and restart app
 * Called from renderer via IPC
 */
export function installUpdate(): void {
  autoUpdater.quitAndInstall()
}

/**
 * Manually check for updates
 * Called from renderer via IPC
 */
export async function checkForUpdates(): Promise<void> {
  await autoUpdater.checkForUpdates()
}
