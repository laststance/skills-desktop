import { AlertTriangle, Loader2 } from 'lucide-react'
import React, { useState } from 'react'

import { useExecuteSync } from '../../hooks/useExecuteSync'
import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import { setSyncPreview } from '../../redux/slices/uiSlice'
import { Button } from '../ui/button'
import { Checkbox } from '../ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
} from '../ui/dialog'
import { DialogIconHeader } from '../ui/dialog-icon-header'

/**
 * Dialog for resolving sync conflicts (local folders that would be replaced by symlinks)
 * Users can select which conflicts to replace and which to skip
 */
export const SyncConflictDialog = React.memo(
  function SyncConflictDialog(): React.ReactElement {
    const dispatch = useAppDispatch()
    const { syncPreview, isSyncing } = useAppSelector((state) => state.ui)

    const conflicts = syncPreview?.conflicts ?? []
    const hasConflicts = conflicts.length > 0
    // Global conflict dialog only — per-agent previews carry `forAgent`
    // and are owned by `CleanupAgentDialog`. Without this guard a scoped
    // preview with conflicts would open both dialogs simultaneously.
    const isOpen = hasConflicts && !!syncPreview && !syncPreview.forAgent

    const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
    const { run: executeSync, isExecuting } = useExecuteSync('Sync failed')

    const handleClose = (): void => {
      if (!isExecuting) {
        dispatch(setSyncPreview(null))
        setSelectedPaths(new Set())
      }
    }

    const handleToggle = (path: string): void => {
      setSelectedPaths((prev) => {
        const next = new Set(prev)
        if (next.has(path)) {
          next.delete(path)
        } else {
          next.add(path)
        }
        return next
      })
    }

    // Success feedback + refreshAllData handled by SyncResultDialog
    const handleSync = async (replaceAll: boolean): Promise<void> => {
      const replaceConflicts = replaceAll
        ? conflicts.map((c) => c.agentSkillPath)
        : Array.from(selectedPaths)
      await executeSync({ replaceConflicts })
      setSelectedPaths(new Set())
    }

    return (
      <Dialog open={isOpen} onOpenChange={handleClose}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogIconHeader
              icon={AlertTriangle}
              title="Sync Conflicts"
              tone="amber"
            />
            <DialogDescription>
              {conflicts.length} local folder(s) found where symlinks would be
              created. Select which to replace with symlinks.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <div className="max-h-[300px] overflow-y-auto rounded-md border p-2 space-y-1">
              {conflicts.map((conflict) => (
                <label
                  key={conflict.agentSkillPath}
                  className="flex items-center gap-3 p-2 rounded-md hover:bg-muted cursor-pointer"
                >
                  <Checkbox
                    checked={selectedPaths.has(conflict.agentSkillPath)}
                    onCheckedChange={() =>
                      handleToggle(conflict.agentSkillPath)
                    }
                    disabled={isExecuting}
                  />
                  <div className="text-sm">
                    <span className="font-medium">{conflict.skillName}</span>
                    <span className="text-muted-foreground">
                      {' '}
                      in {conflict.agentName}
                    </span>
                    <span className="text-xs text-muted-foreground block">
                      Local folder will be replaced with symlink
                    </span>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <DialogFooter className="flex gap-2">
            <Button
              variant="outline"
              onClick={async () => handleSync(false)}
              disabled={isExecuting || isSyncing}
            >
              {isExecuting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Syncing...
                </>
              ) : (
                `Skip${selectedPaths.size > 0 ? ' unselected' : ' all conflicts'}`
              )}
            </Button>
            <Button
              variant="destructive"
              onClick={async () => handleSync(true)}
              disabled={isExecuting || isSyncing}
            >
              Replace all
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  },
)
