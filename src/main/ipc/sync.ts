import { IPC_CHANNELS } from '../../shared/ipc-channels'
import { syncExecute, syncPreview } from '../services/syncService'

import { typedHandle } from './typedHandle'

/**
 * Register IPC handlers for sync operations
 */
export function registerSyncHandlers(): void {
  typedHandle(IPC_CHANNELS.SYNC_PREVIEW, async () => {
    return syncPreview()
  })

  typedHandle(IPC_CHANNELS.SYNC_EXECUTE, async (_, options) => {
    return syncExecute(options)
  })
}
