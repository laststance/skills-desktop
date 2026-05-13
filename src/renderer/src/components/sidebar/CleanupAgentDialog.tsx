import { Eraser, Loader2 } from 'lucide-react'
import React, { useCallback } from 'react'
import { toast } from 'sonner'

import { Button } from '@/renderer/src/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
} from '@/renderer/src/components/ui/dialog'
import { DialogIconHeader } from '@/renderer/src/components/ui/dialog-icon-header'
import { StatRow } from '@/renderer/src/components/ui/stat-row'
import { useCycleEffect } from '@/renderer/src/hooks/useCycleEffect'
import { useExecuteSync } from '@/renderer/src/hooks/useExecuteSync'
import { useAppDispatch, useAppSelector } from '@/renderer/src/redux/hooks'
import {
  clearCleanupAgentTarget,
  fetchSyncPreview,
  selectCleanupAgentTarget,
  selectSyncPreview,
} from '@/renderer/src/redux/slices/uiSlice'
import { errorToastDescription } from '@/renderer/src/utils/errorToastDescription'
import { pluralize } from '@/renderer/src/utils/pluralize'
import { AGENT_DEFINITIONS } from '@/shared/constants'
import type { AgentName } from '@/shared/types'

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

    const { run: executeCleanup, isExecuting } =
      useExecuteSync('Cleanup failed')

    // Trigger the scoped preview as soon as the dialog opens. We re-fetch
    // every time `cleanupAgentTarget` changes so closing-then-reopening on
    // a different agent doesn't render stale numbers. If the preview thunk
    // rejects (IPC failure, missing source dir, etc.) we close the dialog
    // and surface a toast — otherwise it would hang on the loading spinner
    // forever with no way to recover.
    useCycleEffect(() => {
      if (!cleanupAgentTarget) return

      dispatch(fetchSyncPreview({ agentId: cleanupAgentTarget })).then(
        (action) => {
          if (fetchSyncPreview.rejected.match(action)) {
            toast.error('Failed to load cleanup preview', {
              description: errorToastDescription(action),
            })
            dispatch(clearCleanupAgentTarget())
          }
        },
      )
    }, [cleanupAgentTarget, dispatch])

    const handleClose = useCallback((): void => {
      if (!isExecuting) {
        dispatch(clearCleanupAgentTarget())
      }
    }, [dispatch, isExecuting])

    const handleCleanup = useCallback(async (): Promise<void> => {
      // When the dialog is closed this handler can still exist from the
      // stable hook order; only execute once a concrete agent owns the flow.
      if (!cleanupAgentTarget) return

      const succeeded = await executeCleanup({
        replaceConflicts: [],
        agentId: cleanupAgentTarget,
      })
      if (succeeded) {
        // Close this dialog so `SyncResultDialog` (which `executeSyncAction`
        // already populated via `syncResult`) becomes the sole foreground
        // surface — otherwise the per-agent dialog stays mounted underneath.
        dispatch(clearCleanupAgentTarget())
      }
    }, [cleanupAgentTarget, dispatch, executeCleanup])

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

    return (
      <Dialog open onOpenChange={handleClose}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogIconHeader
              icon={Eraser}
              title={`Cleanup missing skills${agentName ? ` — ${agentName}` : ''}`}
            />
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
              <StatRow
                label="Skills considered"
                value={previewMatchesTarget.totalSkills}
              />
              <StatRow
                label="Symlinks to create"
                value={missingCount}
                tone={hasWork ? 'primary' : 'default'}
              />
              {alreadySyncedCount > 0 && (
                <StatRow label="Already linked" value={alreadySyncedCount} />
              )}
              {conflictCount > 0 && (
                <StatRow
                  label="Conflicts (skipped)"
                  value={conflictCount}
                  tone="amber"
                />
              )}
              {!hasWork && conflictCount === 0 && (
                <p className="text-muted-foreground pt-1">
                  Nothing to clean up — every source skill is already linked.
                </p>
              )}
              {conflictCount > 0 && (
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
