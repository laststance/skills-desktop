import { AlertTriangle, Loader2 } from 'lucide-react'
import React, { useCallback, useState } from 'react'

import { Button } from '@/renderer/src/components/ui/button'
import { Checkbox } from '@/renderer/src/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
} from '@/renderer/src/components/ui/dialog'
import { DialogIconHeader } from '@/renderer/src/components/ui/dialog-icon-header'
import { useExecuteSync } from '@/renderer/src/hooks/useExecuteSync'
import { useAppDispatch, useAppSelector } from '@/renderer/src/redux/hooks'
import { setSyncPreview } from '@/renderer/src/redux/slices/uiSlice'

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

    const handleClose = useCallback((): void => {
      if (!isExecuting) {
        dispatch(setSyncPreview(null))
        setSelectedPaths(new Set())
      }
    }, [dispatch, isExecuting])

    const handleToggle = useCallback((path: string): void => {
      setSelectedPaths((prev) => {
        const next = new Set(prev)
        if (next.has(path)) {
          next.delete(path)
        } else {
          next.add(path)
        }
        return next
      })
    }, [])

    // Success feedback + refreshAllData handled by SyncResultDialog
    const handleSync = useCallback(
      async (replaceAll: boolean): Promise<void> => {
        const replaceConflicts = replaceAll
          ? conflicts.map((c) => c.agentSkillPath)
          : Array.from(selectedPaths)
        const succeeded = await executeSync({ replaceConflicts })
        if (succeeded) {
          setSelectedPaths(new Set())
        }
      },
      [conflicts, executeSync, selectedPaths],
    )

    const handleSkipSelected = useCallback((): void => {
      void handleSync(false)
    }, [handleSync])

    const handleReplaceAll = useCallback((): void => {
      void handleSync(true)
    }, [handleSync])

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
            <div className="max-h-75 overflow-y-auto rounded-md border p-2 space-y-1">
              {conflicts.map((conflict) => (
                <SyncConflictRow
                  key={conflict.agentSkillPath}
                  path={conflict.agentSkillPath}
                  skillName={conflict.skillName}
                  agentName={conflict.agentName}
                  checked={selectedPaths.has(conflict.agentSkillPath)}
                  disabled={isExecuting}
                  onToggle={handleToggle}
                />
              ))}
            </div>
          </div>

          <DialogFooter className="flex gap-2">
            <Button
              variant="outline"
              onClick={handleSkipSelected}
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
              onClick={handleReplaceAll}
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

interface SyncConflictRowProps {
  path: string
  skillName: string
  agentName: string
  checked: boolean
  disabled: boolean
  onToggle: (path: string) => void
}

const SyncConflictRow = React.memo(function SyncConflictRow({
  path,
  skillName,
  agentName,
  checked,
  disabled,
  onToggle,
}: SyncConflictRowProps): React.ReactElement {
  const handleCheckedChange = useCallback((): void => {
    onToggle(path)
  }, [onToggle, path])

  return (
    <label className="flex items-center gap-3 p-2 rounded-md hover:bg-muted cursor-pointer">
      <Checkbox
        checked={checked}
        onCheckedChange={handleCheckedChange}
        disabled={disabled}
      />
      <div className="text-sm">
        <span className="font-medium">{skillName}</span>
        <span className="text-muted-foreground"> in {agentName}</span>
        <span className="text-xs text-muted-foreground block">
          Local folder will be replaced with symlink
        </span>
      </div>
    </label>
  )
})
