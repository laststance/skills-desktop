import React from 'react'

import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import {
  setSkillToRemove,
  removeSkill,
} from '../../redux/slices/marketplaceSlice'
import { fetchSkills } from '../../redux/slices/skillsSlice'
import { DestructiveConfirmDialog } from '../shared/DestructiveConfirmDialog'

/**
 * Confirmation dialog for removing a skill
 */
export const RemoveDialog = React.memo(
  function RemoveDialog(): React.ReactElement {
    const dispatch = useAppDispatch()
    const { skillToRemove, status } = useAppSelector(
      (state) => state.marketplace,
    )

    const isRemoving = status === 'removing'

    const handleClose = (): void => {
      if (!isRemoving) {
        dispatch(setSkillToRemove(null))
      }
    }

    const handleRemove = async (): Promise<void> => {
      if (!skillToRemove) return

      await dispatch(removeSkill(skillToRemove))
      dispatch(fetchSkills())
      handleClose()
    }

    return (
      <DestructiveConfirmDialog
        open={!!skillToRemove}
        onClose={handleClose}
        onConfirm={handleRemove}
        loading={isRemoving}
        title="Remove Skill"
        description={
          <>
            Are you sure you want to remove <strong>{skillToRemove}</strong>?
            This will remove the skill from all linked agents.
          </>
        }
        confirmLabel="Remove"
        loadingLabel="Removing..."
      />
    )
  },
)
