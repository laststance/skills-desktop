import { ipcMain } from 'electron'

import { downloadUpdate, installUpdate, checkForUpdates } from '../updater'

/**
 * Register IPC handlers for auto-update functionality
 * Allows renderer to trigger update actions
 */
export function registerUpdateHandlers(): void {
  // Trigger update download
  ipcMain.handle('update:download', () => {
    downloadUpdate()
  })

  // Install downloaded update and restart
  ipcMain.handle('update:install', () => {
    installUpdate()
  })

  // Manually check for updates
  ipcMain.handle('update:check', async () => {
    await checkForUpdates()
  })
}
