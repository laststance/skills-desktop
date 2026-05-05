import { useRef, useState } from 'react'
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
 * need their own `useState`. `run` resolves to `true` only when the thunk
 * fulfills; it returns `false` for rejections AND for re-entrant calls
 * that arrive while a previous run is still in flight. Callers therefore
 * gate success-only side effects on the boolean without re-implementing
 * the rejected-match check or worrying about double-dispatch.
 *
 * Internally guarded by a `useRef` flag so that double-clicks or rapid
 * re-renders cannot fire `dispatch(executeSyncAction)` twice in parallel,
 * and by `try/finally` so an unexpected throw still releases both the
 * ref guard and the `isExecuting` state.
 *
 * @param toastTitle - Title used for the failure toast (e.g. "Sync failed").
 * @returns
 * - `run(options)`: dispatches the thunk, raises a toast on rejection, returns `true` when fulfilled and `false` when rejected or skipped due to a still-running call
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
  const isExecutingRef = useRef(false)

  const run = async (options: SyncExecuteOptions): Promise<boolean> => {
    if (isExecutingRef.current) return false
    isExecutingRef.current = true
    setIsExecuting(true)
    try {
      const result = await dispatch(executeSyncAction(options))
      const succeeded = !executeSyncAction.rejected.match(result)
      if (!succeeded) {
        toast.error(toastTitle, {
          description: errorToastDescription(result),
        })
      }
      return succeeded
    } finally {
      isExecutingRef.current = false
      setIsExecuting(false)
    }
  }

  return { run, isExecuting }
}
