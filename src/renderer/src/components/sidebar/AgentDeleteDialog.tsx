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
 * Confirmation dialog for deleting an agent's entire skills folder
 * Removes everything: symlinks, local skills, and the directory itself
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
      toast.success(`Deleted skills folder for ${result.payload.agentName}`, {
        description: `Removed ${result.payload.removedCount} items`,
      })
      dispatch(fetchSkills())
      dispatch(fetchAgents())
      dispatch(fetchSourceStats())
    } else {
      toast.error('Failed to delete skills folder', {
        description: result.error?.message || 'An unexpected error occurred',
      })
    }
  }

  return (
    <Dialog open={!!agentToDelete} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <DialogTitle>Delete Skills Folder</DialogTitle>
          </div>
          <DialogDescription>
            Permanently delete the skills folder for{' '}
            <strong>{agentToDelete?.name}</strong>?
            <br />
            <span className="text-destructive/80 mt-2 block">
              This will delete all symlinks and local skills in this agent's
              directory. This action cannot be undone.
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
                Deleting...
              </>
            ) : (
              'Delete'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
