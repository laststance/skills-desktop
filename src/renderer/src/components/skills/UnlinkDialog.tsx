import React from 'react'
import { toast } from 'sonner'

import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import {
  setSkillToUnlink,
  unlinkSkillFromAgent,
} from '../../redux/slices/skillsSlice'
import { refreshAllData } from '../../redux/thunks'
import { DestructiveConfirmDialog } from '../shared/DestructiveConfirmDialog'

/**
 * Confirmation dialog for removing a skill from the selected agent.
 * Handles both symlink removal and local skill folder deletion.
 */
export const UnlinkDialog = React.memo(
  function UnlinkDialog(): React.ReactElement {
    const dispatch = useAppDispatch()
    const { skillToUnlink, unlinking } = useAppSelector((state) => state.skills)

    const isLocal = skillToUnlink?.symlink.isLocal ?? false

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
        toast.success(
          isLocal
            ? `Deleted from ${symlink.agentName}`
            : `Removed from ${symlink.agentName}`,
          {
            description: isLocal
              ? `${skill.name} folder has been deleted from ${symlink.agentName}`
              : `${skill.name} is no longer linked to ${symlink.agentName}`,
          },
        )
      } else {
        toast.error(
          isLocal ? 'Failed to delete skill' : 'Failed to remove skill',
          {
            description:
              result.error?.message || 'An unexpected error occurred',
          },
        )
      }
      // Always refresh after an unlink attempt: success refreshes the list,
      // failure clears any stale `state.skills.error` (via fetchSkills.pending)
      // so the SkillsList does not stay stuck on the error view.
      refreshAllData(dispatch)
      dispatch(setSkillToUnlink(null))
    }

    return (
      <DestructiveConfirmDialog
        open={!!skillToUnlink}
        onClose={handleClose}
        onConfirm={handleUnlink}
        loading={unlinking}
        title={isLocal ? 'Delete from Agent' : 'Remove from Agent'}
        description={
          <>
            Are you sure you want to {isLocal ? 'delete' : 'remove'}{' '}
            <strong>{skillToUnlink?.skill.name}</strong> from{' '}
            <strong>{skillToUnlink?.symlink.agentName}</strong>?
            <br />
            <span className="text-muted-foreground mt-2 block">
              {isLocal
                ? 'This will permanently delete the local skill folder. This action cannot be undone.'
                : 'This only removes the link. The skill will remain available for other agents.'}
            </span>
          </>
        }
        confirmLabel={isLocal ? 'Delete' : 'Remove'}
        loadingLabel={isLocal ? 'Deleting...' : 'Removing...'}
        iconVariant="warning"
      />
    )
  },
)
