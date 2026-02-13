import { IPC_CHANNELS } from '../../shared/ipc-channels'
import { downloadUpdate, installUpdate, checkForUpdates } from '../updater'

import { typedHandle } from './typedHandle'

/**
 * Register IPC handlers for auto-update functionality
 * Allows renderer to trigger update actions
 */
export function registerUpdateHandlers(): void {
  // Trigger update download
  typedHandle(IPC_CHANNELS.UPDATE_DOWNLOAD, () => {
    downloadUpdate()
  })

  // Install downloaded update and restart
  typedHandle(IPC_CHANNELS.UPDATE_INSTALL, () => {
    installUpdate()
  })

  // Manually check for updates
  typedHandle(IPC_CHANNELS.UPDATE_CHECK, async () => {
    await checkForUpdates()
  })
}
