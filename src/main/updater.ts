import { BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'

/**
 * Update event types sent to renderer via IPC
 */
export interface UpdateInfo {
  version: string
  releaseNotes?: string
}

export interface DownloadProgress {
  percent: number
  bytesPerSecond: number
  total: number
  transferred: number
}

/**
 * Send update event to all renderer windows
 */
function sendUpdateEvent(
  channel: string,
  data?: UpdateInfo | DownloadProgress | { message: string },
): void {
  const windows = BrowserWindow.getAllWindows()
  for (const win of windows) {
    win.webContents.send(channel, data)
  }
}

/**
 * Initialize auto updater with IPC-based UI notifications
 * Replaces native dialogs with in-app toast notifications
 */
export function initAutoUpdater(): void {
  // Disable auto download - user should confirm via UI
  autoUpdater.autoDownload = false

  autoUpdater.on('checking-for-update', () => {
    console.log('Checking for updates...')
    sendUpdateEvent('update:checking')
  })

  autoUpdater.on('update-available', (info) => {
    console.log('Update available:', info.version)
    sendUpdateEvent('update:available', {
      version: info.version,
      releaseNotes:
        typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
    })
  })

  autoUpdater.on('update-not-available', () => {
    console.log('No updates available')
    sendUpdateEvent('update:not-available')
  })

  autoUpdater.on('error', (err) => {
    console.error('Auto updater error:', err)
    sendUpdateEvent('update:error', { message: err.message })
  })

  autoUpdater.on('download-progress', (progress) => {
    console.log(`Download progress: ${progress.percent.toFixed(1)}%`)
    sendUpdateEvent('update:progress', {
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      total: progress.total,
      transferred: progress.transferred,
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    console.log('Update downloaded:', info.version)
    sendUpdateEvent('update:downloaded', {
      version: info.version,
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
