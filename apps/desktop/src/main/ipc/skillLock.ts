import {
  pruneLockEntries,
  scanStaleLockEntries,
} from '@/main/services/skillLockService'
import { IPC_CHANNELS } from '@/shared/ipc-channels'

import { typedHandle } from './typedHandle'

/**
 * IPC surface for the skills CLI lock file.
 *
 * Read-then-confirm, deliberately in two calls: the dashboard polls
 * `scanStale` on every skill refresh, and `prune` only runs behind an explicit
 * user confirmation. Main revalidates the names on the way in, so a stale
 * renderer list can never widen the blast radius.
 */
export function registerSkillLockHandlers(): void {
  typedHandle(IPC_CHANNELS.SKILLS_LOCK_SCAN_STALE, async () => {
    return scanStaleLockEntries()
  })

  typedHandle(IPC_CHANNELS.SKILLS_LOCK_PRUNE, async (_, options) => {
    return pruneLockEntries(options.names)
  })
}
