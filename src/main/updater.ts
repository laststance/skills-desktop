import { BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'

import { IPC_CHANNELS } from '../shared/ipc-channels'
import type { IpcEventChannel, IpcEventContract } from '../shared/ipc-contract'
import { semanticVersion } from '../shared/types'

import { typedSend } from './ipc/typedSend'

/**
 * Send typed event to all renderer windows
 * @param channel - Event channel name
 * @param args - Payload matching the contract
 */
function broadcastEvent<C extends IpcEventChannel>(
  channel: C,
  ...args: IpcEventContract[C] extends void ? [] : [IpcEventContract[C]]
): void {
  const windows = BrowserWindow.getAllWindows()
  for (const win of windows) {
    typedSend(win.webContents, channel, ...args)
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
