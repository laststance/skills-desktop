import { AlertTriangle, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import { fetchAgents } from '../../redux/slices/agentsSlice'
import {
  deleteSkill,
  fetchSkills,
  setSkillToDelete,
} from '../../redux/slices/skillsSlice'
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
 * Confirmation dialog for permanently deleting a skill
 * Removes source directory and all agent symlinks/copies
 */
export function DeleteSkillDialog(): React.ReactElement {
  const dispatch = useAppDispatch()
  const { skillToDelete, deleting } = useAppSelector((state) => state.skills)

  const handleClose = (): void => {
    if (!deleting) {
      dispatch(setSkillToDelete(null))
    }
  }

  const handleDelete = async (): Promise<void> => {
    if (!skillToDelete) return

    const result = await dispatch(deleteSkill(skillToDelete))

    if (deleteSkill.fulfilled.match(result)) {
      toast.success(`Deleted ${result.payload.skillName}`, {
        description: `Removed skill and ${result.payload.symlinksRemoved} symlinks`,
      })
      dispatch(fetchSkills())
      dispatch(fetchAgents())
      dispatch(fetchSourceStats())
    } else {
      toast.error('Failed to delete skill', {
        description: result.error?.message || 'An unexpected error occurred',
      })
    }
  }

  return (
    <Dialog open={!!skillToDelete} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <DialogTitle>Delete Skill</DialogTitle>
          </div>
          <DialogDescription>
            Permanently delete <strong>{skillToDelete?.name}</strong> and all
            its symlinks across all agents?
            <br />
            <span className="text-destructive/80 mt-2 block">
              This action cannot be undone.
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
              'Remove'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
