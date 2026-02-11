import { AlertTriangle, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import {
  fetchAgents,
  removeAllSymlinksFromAgent,
  setAgentToDelete,
} from '../../redux/slices/agentsSlice'
import { fetchSkills } from '../../redux/slices/skillsSlice'
import { fetchSourceStats } from '../../redux/slices/uiSlice'
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
 * Confirmation dialog for removing all skill symlinks from an agent
 * Only removes symlinks, not local skills
 */
export function AgentDeleteDialog(): React.ReactElement {
  const dispatch = useAppDispatch()
  const { agentToDelete, deleting } = useAppSelector((state) => state.agents)

  const handleClose = (): void => {
    if (!deleting) {
      dispatch(setAgentToDelete(null))
    }
  }

  const handleDelete = async (): Promise<void> => {
    if (!agentToDelete) return

    const result = await dispatch(removeAllSymlinksFromAgent(agentToDelete))

    if (removeAllSymlinksFromAgent.fulfilled.match(result)) {
      toast.success(
        `Removed ${result.payload.removedCount} symlinks from ${result.payload.agentName}`,
      )
      dispatch(fetchSkills())
      dispatch(fetchAgents())
      dispatch(fetchSourceStats())
    } else {
      toast.error('Failed to remove symlinks', {
        description: result.error?.message || 'An unexpected error occurred',
      })
    }
  }

  return (
    <Dialog open={!!agentToDelete} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            <DialogTitle>Remove All Symlinks</DialogTitle>
          </div>
          <DialogDescription>
            Remove all skill symlinks from{' '}
            <strong>{agentToDelete?.name}</strong>?
            <br />
            <span className="text-muted-foreground mt-2 block">
              This only removes symlinks. Local skills and source skills will
              remain available.
            </span>
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={handleClose} disabled={deleting}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Removing...
              </>
            ) : (
              'Remove'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
