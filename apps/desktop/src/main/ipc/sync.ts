import { syncExecute, syncPreview } from '@/main/services/syncService'
import { IPC_CHANNELS } from '@/shared/ipc-channels'

import { recordActivityEvents } from './activity'
import { typedHandle } from './typedHandle'

/**
 * Register IPC handlers for sync operations
 */
export function registerSyncHandlers(): void {
  typedHandle(IPC_CHANNELS.SYNC_PREVIEW, async (_, options) => {
    return syncPreview(options)
  })

  typedHandle(IPC_CHANNELS.SYNC_EXECUTE, async (_, options) => {
    const result = await syncExecute(options)
    // One summary event per run — a sync can touch dozens of skill×agent
    // pairs, so per-item events would flood the log. The counts go in `detail`.
    await recordActivityEvents([
      {
        type: 'synced',
        skillName: 'Sync',
        detail: `${result.created} created · ${result.replaced} replaced · ${result.skipped} skipped`,
      },
    ])
    return result
  })
}
