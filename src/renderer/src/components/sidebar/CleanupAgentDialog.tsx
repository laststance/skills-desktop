import { Eraser, Loader2 } from 'lucide-react'
import React, { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { AGENT_DEFINITIONS } from '../../../../shared/constants'
import type { AgentName } from '../../../../shared/types'
import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import {
  clearCleanupAgentTarget,
  executeSyncAction,
  fetchSyncPreview,
  selectCleanupAgentTarget,
  selectSyncPreview,
} from '../../redux/slices/uiSlice'
import { errorToastDescription } from '../../utils/errorToastDescription'
import { pluralize } from '../../utils/pluralize'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'

/**
 * Per-agent cleanup dialog.
 * Opens when the user picks "Cleanup missing skills..." from `AgentItem`'s
 * right-click menu. Triggers a scoped `fetchSyncPreview({ agentId })`,
 * shows the resulting `toCreate` count, and on confirm dispatches
 * `executeSyncAction({ replaceConflicts: [], agentId })` to recreate just
 * that agent's missing symlinks.
 *
 * Why this is separate from `SyncConfirmDialog`:
 * - Global sync acts across every detected agent. A scoped per-agent run
 *   shares the IPC plumbing but needs different copy ("Cleanup `<agent>`"
 *   vs "Sync Skills") and a different mental model (recover one agent vs
 *   propagate everything).
 * - The global dialogs gate themselves on `!preview.forAgent` so a scoped
 *   preview never accidentally opens both surfaces at once.
 *
 * Lifecycle:
 * 1. `setCleanupAgentTarget(agentId)` from AgentItem
 * 2. This component mounts, dispatches `fetchSyncPreview({ agentId })`
 * 3. Render the count + Cleanup button once preview lands
 * 4. On confirm: `executeSyncAction({ agentId })` → `SyncResultDialog`
 *    takes over to display the per-item diff
 * 5. `clearCleanupAgentTarget()` resets the slice (also nulls
 *    `syncPreview` so the global confirm can't latch onto it)
 */
export const CleanupAgentDialog = React.memo(
  function CleanupAgentDialog(): React.ReactElement | null {
    const dispatch = useAppDispatch()
    const cleanupAgentTarget = useAppSelector(selectCleanupAgentTarget)
    const syncPreview = useAppSelector(selectSyncPreview)
    const isSyncing = useAppSelector((state) => state.ui.isSyncing)

    const [isExecuting, setIsExecuting] = useState(false)

    // Trigger the scoped preview as soon as the dialog opens. We re-fetch
    // every time `cleanupAgentTarget` changes so closing-then-reopening on
    // a different agent doesn't render stale numbers.
    useEffect(() => {
      if (cleanupAgentTarget) {
        dispatch(fetchSyncPreview({ agentId: cleanupAgentTarget }))
      }
    }, [cleanupAgentTarget, dispatch])

    if (!cleanupAgentTarget) return null

    // Stale-preview guard: only trust the preview when its `forAgent`
    // matches the currently-targeted agent. Defends against the race
    // where a global preview lands while a scoped fetch is in flight.
    const previewMatchesTarget =
      syncPreview?.forAgent === cleanupAgentTarget ? syncPreview : null

    const agentName: AgentName | undefined = AGENT_DEFINITIONS.find(
      (a) => a.id === cleanupAgentTarget,
    )?.name

    const conflictCount = previewMatchesTarget?.conflicts.length ?? 0
    const missingCount = previewMatchesTarget?.toCreate ?? 0
    const alreadySyncedCount = previewMatchesTarget?.alreadySynced ?? 0
    const hasWork = missingCount > 0
    const isLoadingPreview = !previewMatchesTarget

    const handleClose = (): void => {
      if (!isExecuting) {
        dispatch(clearCleanupAgentTarget())
      }
    }

    const handleCleanup = async (): Promise<void> => {
      setIsExecuting(true)

      const result = await dispatch(
        executeSyncAction({
          replaceConflicts: [],
          agentId: cleanupAgentTarget,
        }),
      )

      // SyncResultDialog renders the per-item diff on success.
      if (executeSyncAction.rejected.match(result)) {
        toast.error('Cleanup failed', {
          description: errorToastDescription(result),
        })
      }

      setIsExecuting(false)
    }

    return (
      <Dialog open onOpenChange={handleClose}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <Eraser className="h-5 w-5 text-primary" />
              <DialogTitle>
                Cleanup missing skills{agentName ? ` — ${agentName}` : ''}
              </DialogTitle>
            </div>
            <DialogDescription>
              Recreate symlinks for skills that exist in your source directory
              but are missing from {agentName ?? 'this agent'}.
            </DialogDescription>
          </DialogHeader>

          {isLoadingPreview ? (
            <div className="py-6 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Calculating cleanup plan...
            </div>
          ) : (
            <div className="py-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Skills considered</span>
                <span className="font-medium">
                  {previewMatchesTarget.totalSkills}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  Symlinks to create
                </span>
                <span
                  className={
                    hasWork ? 'font-medium text-primary' : 'font-medium'
                  }
                >
                  {missingCount}
                </span>
              </div>
              {alreadySyncedCount > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Already linked</span>
                  <span className="font-medium">{alreadySyncedCount}</span>
                </div>
              )}
              {conflictCount > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Conflicts (skipped)
                  </span>
                  <span className="font-medium text-amber-500">
                    {conflictCount}
                  </span>
                </div>
              )}
              {!hasWork && conflictCount === 0 && (
                <p className="text-muted-foreground pt-1">
                  Nothing to clean up — every source skill is already linked.
                </p>
              )}
              {conflictCount > 0 && hasWork && (
                <p className="text-xs text-muted-foreground pt-1">
                  Conflicts (real folders blocking a symlink) are not touched by
                  cleanup. Resolve them from the global Sync flow.
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={handleClose}
              disabled={isExecuting}
            >
              {hasWork ? 'Cancel' : 'Close'}
            </Button>
            {hasWork && (
              <Button
                onClick={handleCleanup}
                disabled={isExecuting || isSyncing}
              >
                {isExecuting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Cleaning up...
                  </>
                ) : (
                  `Cleanup ${missingCount} ${pluralize(missingCount, 'skill')}`
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  },
)
