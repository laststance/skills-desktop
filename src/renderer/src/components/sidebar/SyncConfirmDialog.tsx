import { FolderSync, Loader2 } from 'lucide-react'
import React from 'react'

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
import { useExecuteSync } from '@/renderer/src/hooks/useExecuteSync'
import { shouldShowSyncConfirm } from '@/renderer/src/lib/syncHelpers'
import { useAppDispatch, useAppSelector } from '@/renderer/src/redux/hooks'
import { setSyncPreview } from '@/renderer/src/redux/slices/uiSlice'

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

    const { run: executeSync, isExecuting } = useExecuteSync('Sync failed')

    const handleClose = (): void => {
      if (!isExecuting) {
        dispatch(setSyncPreview(null))
      }
    }

    // Success feedback + refreshAllData handled by SyncResultDialog
    const handleSync = async (): Promise<void> => {
      await executeSync({ replaceConflicts: [] })
    }

    return (
      <Dialog open={isOpen} onOpenChange={handleClose}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogIconHeader icon={FolderSync} title="Sync Skills" />
            <DialogDescription>
              Create symlinks from your source skills to all agents.
            </DialogDescription>
          </DialogHeader>

          {syncPreview && (
            <div className="py-4 space-y-2 text-sm">
              <StatRow
                label="Skills → Agents"
                value={`${syncPreview.totalSkills} skills → ${syncPreview.totalAgents} agents`}
              />
              <StatRow
                label="New symlinks to create"
                value={syncPreview.toCreate}
                tone="primary"
              />
              {syncPreview.alreadySynced > 0 && (
                <StatRow
                  label="Already synced"
                  value={syncPreview.alreadySynced}
                />
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
