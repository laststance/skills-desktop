import { AlertTriangle, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import { fetchAgents } from '../../redux/slices/agentsSlice'
import { fetchSkills } from '../../redux/slices/skillsSlice'
import {
  executeSyncAction,
  fetchSourceStats,
  setSyncPreview,
} from '../../redux/slices/uiSlice'
import { Button } from '../ui/button'
import { Checkbox } from '../ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'

/**
 * Dialog for resolving sync conflicts (local folders that would be replaced by symlinks)
 * Users can select which conflicts to replace and which to skip
 */
export function SyncConflictDialog(): React.ReactElement {
  const dispatch = useAppDispatch()
  const { syncPreview, isSyncing } = useAppSelector((state) => state.ui)

  const conflicts = syncPreview?.conflicts ?? []
  const hasConflicts = conflicts.length > 0
  const isOpen = hasConflicts && !!syncPreview

  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  const [isExecuting, setIsExecuting] = useState(false)

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

  const handleSync = async (replaceAll: boolean): Promise<void> => {
    setIsExecuting(true)

    const replaceConflicts = replaceAll
      ? conflicts.map((c) => c.agentSkillPath)
      : Array.from(selectedPaths)

    const result = await dispatch(executeSyncAction({ replaceConflicts }))

    if (executeSyncAction.fulfilled.match(result)) {
      const { created, replaced } = result.payload
      toast.success('Sync completed', {
        description: `Created ${created} symlinks, replaced ${replaced} conflicts`,
      })
      dispatch(fetchSkills())
      dispatch(fetchAgents())
      dispatch(fetchSourceStats())
    } else {
      toast.error('Sync failed', {
        description: result.error?.message || 'An unexpected error occurred',
      })
    }

    setIsExecuting(false)
    setSelectedPaths(new Set())
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            <DialogTitle>Sync Conflicts</DialogTitle>
          </div>
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
                  onCheckedChange={() => handleToggle(conflict.agentSkillPath)}
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
}
