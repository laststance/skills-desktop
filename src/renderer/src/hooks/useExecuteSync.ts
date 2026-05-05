import { useState } from 'react'
import { toast } from 'sonner'

import type { SyncExecuteOptions } from '../../../shared/types'
import { useAppDispatch } from '../redux/hooks'
import { executeSyncAction } from '../redux/slices/uiSlice'
import { errorToastDescription } from '../utils/errorToastDescription'

/**
 * Encapsulates the dispatch + rejected-match + toast flow shared by every
 * sync-related dialog (`SyncConfirmDialog`, `SyncConflictDialog`,
 * `CleanupAgentDialog`). Replaces three near-identical handlers that each
 * managed their own `isExecuting` and toast call.
 *
 * The hook owns the component-local executing flag so dialogs no longer
 * need their own `useState`. `run` resolves to `true` on success and
 * `false` on rejection, letting the caller chain success-only side
 * effects (e.g. closing a scoped dialog) without re-implementing the
 * rejected-match check.
 *
 * @param toastTitle - Title used for the failure toast (e.g. "Sync failed").
 * @returns
 * - `run(options)`: dispatches the thunk, raises a toast on rejection, returns `true` when fulfilled
 * - `isExecuting`: `true` from the moment `run` is called until the thunk settles
 * @example
 * const { run, isExecuting } = useExecuteSync('Cleanup failed')
 * const handleCleanup = async (): Promise<void> => {
 *   const succeeded = await run({ replaceConflicts: [], agentId })
 *   if (succeeded) dispatch(clearCleanupAgentTarget())
 * }
 */
export function useExecuteSync(toastTitle: string): {
  run: (options: SyncExecuteOptions) => Promise<boolean>
  isExecuting: boolean
} {
  const dispatch = useAppDispatch()
  const [isExecuting, setIsExecuting] = useState(false)

  const run = async (options: SyncExecuteOptions): Promise<boolean> => {
    setIsExecuting(true)
    const result = await dispatch(executeSyncAction(options))
    const succeeded = !executeSyncAction.rejected.match(result)
    if (!succeeded) {
      toast.error(toastTitle, {
        description: errorToastDescription(result),
      })
    }
    setIsExecuting(false)
    return succeeded
  }

  return { run, isExecuting }
}
