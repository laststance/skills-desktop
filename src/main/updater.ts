import { autoUpdater } from 'electron-updater'

import { IPC_CHANNELS } from '@/shared/ipc-channels'
import type { Settings } from '@/shared/settings'
import { semanticVersion } from '@/shared/types'

import { broadcastTypedEvent as broadcastEvent } from './ipc/typedSend'
import { getSettings } from './services/settings'

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
 * Initialize auto updater with IPC-based UI notifications
 * Replaces native dialogs with in-app toast notifications
 */
export function initAutoUpdater(): void {
  // Seed the updater from the persisted user preference. The default keeps
  // autoDownload off (manual confirm-via-UI flow) until the user opts in
  // via Settings → Auto Updates.
  applyUpdaterPreferences(getSettings())

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

  // Check for updates after a short delay
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('Failed to check for updates:', err)
    })
  }, 3000)
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
