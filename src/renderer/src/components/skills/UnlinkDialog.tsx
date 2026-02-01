import { AlertTriangle, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import {
  fetchSkills,
  setSkillToUnlink,
  unlinkSkillFromAgent,
} from '../../redux/slices/skillsSlice'
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
 * Confirmation dialog for removing a skill symlink from the selected agent
 * Only removes the symlink, not the canonical skill from ~/.agents/skills/
 */
export function UnlinkDialog(): React.ReactElement {
  const dispatch = useAppDispatch()
  const { skillToUnlink, unlinking } = useAppSelector((state) => state.skills)

  const handleClose = (): void => {
    if (!unlinking) {
      dispatch(setSkillToUnlink(null))
    }
  }

  const handleUnlink = async (): Promise<void> => {
    if (!skillToUnlink) return

    const { skill, symlink } = skillToUnlink
    const result = await dispatch(unlinkSkillFromAgent({ skill, symlink }))

    if (unlinkSkillFromAgent.fulfilled.match(result)) {
      // Show success toast
      toast.success(`Removed from ${symlink.agentName}`, {
        description: `${skill.name} is no longer linked to ${symlink.agentName}`,
      })
      // Refresh skills list
      dispatch(fetchSkills())
    } else {
      // Show error toast
      toast.error('Failed to remove skill', {
        description: result.error?.message || 'An unexpected error occurred',
      })
    }
  }

  return (
    <Dialog open={!!skillToUnlink} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            <DialogTitle>Remove from Agent</DialogTitle>
          </div>
          <DialogDescription>
            Are you sure you want to remove{' '}
            <strong>{skillToUnlink?.skill.name}</strong> from{' '}
            <strong>{skillToUnlink?.symlink.agentName}</strong>?
            <br />
            <span className="text-muted-foreground mt-2 block">
              This only removes the link. The skill will remain available for
              other agents.
            </span>
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={handleClose} disabled={unlinking}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleUnlink}
            disabled={unlinking}
          >
            {unlinking ? (
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
