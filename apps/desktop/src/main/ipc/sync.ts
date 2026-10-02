import { syncExecute, syncPreview } from '@/main/services/syncService'
import { AGENT_DEFINITIONS } from '@/shared/constants'
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
    // One summary per selected-agent recovery; per-skill events would flood the log. The counts go in `detail`.
    await recordActivityEvents([
      {
        type: 'synced',
        skillName: 'Cleanup',
        agentName: AGENT_DEFINITIONS.find(
          (agent) => agent.id === options.agentId,
        )?.name,
        detail: `${result.created} created · ${result.skipped} skipped`,
      },
    ])
    return result
  })
}
