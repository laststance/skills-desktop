import { IPC_CHANNELS } from '../../shared/ipc-channels'
import { syncExecute, syncPreview } from '../services/syncService'

import { typedHandle } from './typedHandle'

/**
 * Register IPC handlers for sync operations
 */
export function registerSyncHandlers(): void {
  typedHandle(IPC_CHANNELS.SYNC_PREVIEW, async (_, options) => {
    return syncPreview(options)
  })

  typedHandle(IPC_CHANNELS.SYNC_EXECUTE, async (_, options) => {
    return syncExecute(options)
  })
}
