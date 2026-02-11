import { ipcMain } from 'electron'

import { IPC_CHANNELS } from '../../shared/ipc-channels'
import type { SyncExecuteOptions } from '../../shared/types'
import { syncExecute, syncPreview } from '../services/syncService'

/**
 * Register IPC handlers for sync operations
 */
export function registerSyncHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.SYNC_PREVIEW, async () => {
    return syncPreview()
  })

  ipcMain.handle(
    IPC_CHANNELS.SYNC_EXECUTE,
    async (_, options: SyncExecuteOptions) => {
      return syncExecute(options)
    },
  )
}
