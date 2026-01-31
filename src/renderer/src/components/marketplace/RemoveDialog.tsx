import { AlertTriangle, Loader2 } from 'lucide-react'

import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import {
  setSkillToRemove,
  removeSkill,
} from '../../redux/slices/marketplaceSlice'
import { fetchSkills } from '../../redux/slices/skillsSlice'
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
 * Confirmation dialog for removing a skill
 */
export function RemoveDialog(): React.ReactElement {
  const dispatch = useAppDispatch()
  const { skillToRemove, status } = useAppSelector((state) => state.marketplace)

  const isRemoving = status === 'removing'

  const handleClose = (): void => {
    if (!isRemoving) {
      dispatch(setSkillToRemove(null))
    }
  }

  const handleRemove = async (): Promise<void> => {
    if (!skillToRemove) return

    await dispatch(removeSkill(skillToRemove))
    // Refresh the skills list after removal
    dispatch(fetchSkills())
    handleClose()
  }

  return (
    <Dialog open={!!skillToRemove} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <DialogTitle>Remove Skill</DialogTitle>
          </div>
          <DialogDescription>
            Are you sure you want to remove <strong>{skillToRemove}</strong>?
            This will remove the skill from all linked agents.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={handleClose} disabled={isRemoving}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleRemove}
            disabled={isRemoving}
          >
            {isRemoving ? (
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
