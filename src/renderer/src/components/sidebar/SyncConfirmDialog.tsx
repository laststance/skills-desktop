import { FolderSync, Loader2 } from 'lucide-react'
import React, { useState } from 'react'
import { toast } from 'sonner'

import { shouldShowSyncConfirm } from '../../lib/syncHelpers'
import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import { executeSyncAction, setSyncPreview } from '../../redux/slices/uiSlice'
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
 * Confirmation dialog shown before sync execution (no-conflict case).
 * Explains what the sync operation will do: how many symlinks will be created
 * across how many agents, and how many are already linked.
 * Opens when syncPreview has toCreate > 0 and no conflicts.
 */
export const SyncConfirmDialog = React.memo(
  function SyncConfirmDialog(): React.ReactElement {
    const dispatch = useAppDispatch()
    const syncPreview = useAppSelector((state) => state.ui.syncPreview)
    const isSyncing = useAppSelector((state) => state.ui.isSyncing)
    const isOpen = shouldShowSyncConfirm(syncPreview)

    const [isExecuting, setIsExecuting] = useState(false)

    const handleClose = (): void => {
      if (!isExecuting) {
        dispatch(setSyncPreview(null))
      }
    }

    const handleSync = async (): Promise<void> => {
      setIsExecuting(true)

      const result = await dispatch(executeSyncAction({ replaceConflicts: [] }))

      // Success feedback + refreshAllData handled by SyncResultDialog
      if (executeSyncAction.rejected.match(result)) {
        toast.error('Sync failed', {
          description: result.error?.message || 'An unexpected error occurred',
        })
      }

      setIsExecuting(false)
    }

    return (
      <Dialog open={isOpen} onOpenChange={handleClose}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <FolderSync className="h-5 w-5 text-primary" />
              <DialogTitle>Sync Skills</DialogTitle>
            </div>
            <DialogDescription>
              Create symlinks from your source skills to all agents.
            </DialogDescription>
          </DialogHeader>

          {syncPreview && (
            <div className="py-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Skills → Agents</span>
                <span className="font-medium">
                  {syncPreview.totalSkills} skills → {syncPreview.totalAgents}{' '}
                  agents
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  New symlinks to create
                </span>
                <span className="font-medium text-primary">
                  {syncPreview.toCreate}
                </span>
              </div>
              {syncPreview.alreadySynced > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Already synced</span>
                  <span className="font-medium">
                    {syncPreview.alreadySynced}
                  </span>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={handleClose}
              disabled={isExecuting}
            >
              Cancel
            </Button>
            <Button onClick={handleSync} disabled={isExecuting || isSyncing}>
              {isExecuting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Syncing...
                </>
              ) : (
                'Sync'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  },
)
