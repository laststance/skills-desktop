import React from 'react'
import { toast } from 'sonner'
import { match } from 'ts-pattern'

import type { SymlinkInfo } from '../../../../shared/types'
import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import {
  setSkillToUnlink,
  unlinkSkillFromAgent,
} from '../../redux/slices/skillsSlice'
import { refreshAllData } from '../../redux/thunks'
import { DestructiveConfirmDialog } from '../shared/DestructiveConfirmDialog'

/**
 * Three exhaustive states the dialog has to cover:
 * - `local`  : real skill folder lives in the agent dir; removal is permanent.
 * - `broken` : the agent has a dangling symlink to a source that no longer
 *              exists (orphan); removal is permanent (nothing to restore to).
 * - `valid`  : a working symlink that can be safely removed (the source dir
 *              and any other agents' links survive).
 *
 * `'missing'` symlinks never reach this dialog — the unlink button is gated
 * out for them upstream (see SkillItemHelpers).
 */
type UnlinkVariant = 'local' | 'broken' | 'valid'

interface UnlinkCopy {
  title: string
  detailText: string
  confirmLabel: string
  loadingLabel: string
  successTitle: string
  successDescription: string
  errorTitle: string
}

/** Pure mapper from symlink shape → strings shown in the dialog and toast. */
function getUnlinkCopy(
  variant: UnlinkVariant,
  skillName: string,
  agentName: string,
): UnlinkCopy {
  return match(variant)
    .with('local', () => ({
      title: 'Delete from Agent',
      detailText:
        'This will permanently delete the local skill folder. This action cannot be undone.',
      confirmLabel: 'Delete',
      loadingLabel: 'Deleting...',
      successTitle: `Deleted from ${agentName}`,
      successDescription: `${skillName} folder has been deleted from ${agentName}`,
      errorTitle: 'Failed to delete skill',
    }))
    .with('broken', () => ({
      title: 'Remove Broken Link',
      detailText:
        'The original skill source no longer exists, so this cannot be undone.',
      confirmLabel: 'Remove',
      loadingLabel: 'Removing...',
      successTitle: `Cleaned up broken link in ${agentName}`,
      successDescription: `Broken symlink to ${skillName} removed from ${agentName}`,
      errorTitle: 'Failed to remove broken link',
    }))
    .with('valid', () => ({
      title: 'Remove from Agent',
      detailText:
        'This only removes the link. The skill will remain available for other agents.',
      confirmLabel: 'Remove',
      loadingLabel: 'Removing...',
      successTitle: `Removed from ${agentName}`,
      successDescription: `${skillName} is no longer linked to ${agentName}`,
      errorTitle: 'Failed to remove skill',
    }))
    .exhaustive()
}

/**
 * Compute the variant from the symlink record (single source of truth).
 *
 * `'missing'` is mapped to `'broken'` defensively: both represent "no live
 * link to remove" (a cleanup operation, not a live unlink). Upstream gating
 * in `SkillItemHelpers` should prevent `'missing'` from ever reaching this
 * dialog, but the explicit branch ensures it can never silently fall through
 * to `'valid'` and surface the wrong "remove live link" copy.
 */
function pickVariant(symlink: SymlinkInfo): UnlinkVariant {
  if (symlink.isLocal) return 'local'
  if (symlink.status === 'broken' || symlink.status === 'missing')
    return 'broken'
  return 'valid'
}

/**
 * Confirmation dialog for removing a skill from the selected agent.
 * Handles three states (local folder delete / broken-symlink cleanup / live
 * symlink unlink) via an exhaustive ts-pattern match — adding a future
 * variant forces the copy table to be updated at compile time.
 */
export const UnlinkDialog = React.memo(
  function UnlinkDialog(): React.ReactElement {
    const dispatch = useAppDispatch()
    const { skillToUnlink, unlinking } = useAppSelector((state) => state.skills)

    const variant: UnlinkVariant = skillToUnlink
      ? pickVariant(skillToUnlink.symlink)
      : 'valid'
    const copy = getUnlinkCopy(
      variant,
      skillToUnlink?.skill.name ?? '',
      skillToUnlink?.symlink.agentName ?? '',
    )

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
        toast.success(copy.successTitle, {
          description: copy.successDescription,
        })
      } else {
        toast.error(copy.errorTitle, {
          description: result.error?.message || 'An unexpected error occurred',
        })
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
        title={copy.title}
        description={
          <>
            Are you sure you want to {copy.confirmLabel.toLowerCase()}{' '}
            <strong>{skillToUnlink?.skill.name}</strong> from{' '}
            <strong>{skillToUnlink?.symlink.agentName}</strong>?
            <br />
            <span className="text-muted-foreground mt-2 block">
              {copy.detailText}
            </span>
          </>
        }
        confirmLabel={copy.confirmLabel}
        loadingLabel={copy.loadingLabel}
        iconVariant="warning"
      />
    )
  },
)
