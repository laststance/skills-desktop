import React from 'react'
import { toast } from 'sonner'

import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import { deleteSkill, setSkillToDelete } from '../../redux/slices/skillsSlice'
import { refreshAllData } from '../../redux/thunks'
import { DestructiveConfirmDialog } from '../shared/DestructiveConfirmDialog'

/**
 * Confirmation dialog for permanently deleting a skill
 * Removes source directory and all agent symlinks/copies
 */
export const DeleteSkillDialog = React.memo(
  function DeleteSkillDialog(): React.ReactElement {
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
      } else {
        toast.error('Failed to delete skill', {
          description: result.error?.message || 'An unexpected error occurred',
        })
      }
      // Always refresh after a delete attempt: success refreshes the list,
      // failure clears any stale `state.skills.error` (via fetchSkills.pending)
      // so the SkillsList does not stay stuck on the error view.
      refreshAllData(dispatch)
      dispatch(setSkillToDelete(null))
    }

    return (
      <DestructiveConfirmDialog
        open={!!skillToDelete}
        onClose={handleClose}
        onConfirm={handleDelete}
        loading={deleting}
        title="Delete Skill"
        description={
          <>
            Permanently delete <strong>{skillToDelete?.name}</strong> and all
            its symlinks across all agents?
            <br />
            <span className="text-destructive/80 mt-2 block">
              This action cannot be undone.
            </span>
          </>
        }
        confirmLabel="Remove"
        loadingLabel="Deleting..."
      />
    )
  },
)
