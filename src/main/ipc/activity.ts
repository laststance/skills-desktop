import {
  appendActivityEvents,
  listActivityEvents,
} from '@/main/services/activityLog'
import type { ActivityEventInput } from '@/shared/activityLog'
import { FEATURE_FLAGS } from '@/shared/featureFlags'
import { IPC_CHANNELS } from '@/shared/ipc-channels'

import { typedHandle } from './typedHandle'
import { broadcastTypedEvent } from './typedSend'

/**
 * Persist one or more activity events and broadcast the new log to every open
 * window. Called by the sync + skills mutation handlers after a successful
 * on-disk change. Two safety properties make it safe to call from any handler:
 *  - **Dark by flag:** a no-op unless `ENABLE_DASHBOARD_EXPERIMENTAL` is on, so
 *    shipping with the flag off adds zero production behavior.
 *  - **Never throws:** a logging failure (disk full, etc.) is swallowed — the
 *    triggering skill was already added/removed/synced on disk, so the mutation
 *    must still report success.
 * @param inputs - Events to record (the main process stamps `id` + `timestamp`).
 * @returns Resolves once persisted + broadcast, or immediately when gated off / empty / on failure.
 * @example
 * await recordActivityEvents([{ type: 'created', skillName: 'azure-ai', agentName: 'Claude Code' }])
 */
export async function recordActivityEvents(
  inputs: ActivityEventInput[],
): Promise<void> {
  if (!FEATURE_FLAGS.ENABLE_DASHBOARD_EXPERIMENTAL) return
  if (inputs.length === 0) return
  try {
    const next = await appendActivityEvents(inputs)
    broadcastTypedEvent(IPC_CHANNELS.ACTIVITY_CHANGED, next)
  } catch (err) {
    console.warn('[activity-log] failed to record events:', err)
  }
}

/**
 * Register the `activity:list` query handler so renderers can hydrate the
 * timeline on mount. Updates arrive separately via the `activity:changed`
 * broadcast emitted from {@link recordActivityEvents}.
 */
export function registerActivityHandlers(): void {
  typedHandle(IPC_CHANNELS.ACTIVITY_LIST, (_event, options) =>
    listActivityEvents(options),
  )
}
