import React from 'react'
import { toast } from 'sonner'

import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import {
  cliRemoveSelectedSkills,
  selectBulkCliRemoving,
  selectCliRemoveTarget,
  setCliRemoveTarget,
} from '../../redux/slices/skillsSlice'
import { refreshAllData } from '../../redux/thunks'
import { settleCliRemoveBatch } from '../../utils/bulkOpVisuals'
import { DestructiveConfirmDialog } from '../shared/DestructiveConfirmDialog'

/**
 * Confirmation dialog for CLI-managed skill removal
 * (deregister from `~/.agents/.skill-lock.json` via `npx skills remove`).
 *
 * Subscribes to `state.skills.cliRemoveTarget` — dispatching
 * `setCliRemoveTarget([name])` (single) or `setCliRemoveTarget([...names])`
 * (batch) opens the dialog. Fires the matching thunk on confirm and refreshes
 * all data on settle, then clears the target.
 *
 * No undo: CLI remove is immediate and irreversible (the dialog IS the
 * safety net). Failures surface per-item via toast.
 */
export const DeleteCliSkillDialog = React.memo(
  function DeleteCliSkillDialog(): React.ReactElement {
    const dispatch = useAppDispatch()
    const target = useAppSelector(selectCliRemoveTarget)
    const removing = useAppSelector(selectBulkCliRemoving)

    const count = target?.length ?? 0
    const isBatch = count > 1
    const firstName = target?.[0] ?? ''
    const subject = isBatch ? (
      <>
        <strong>{count}</strong> skills
      </>
    ) : (
      <strong>{firstName}</strong>
    )

    const handleClose = (): void => {
      if (!removing) {
        dispatch(setCliRemoveTarget(null))
      }
    }

    const handleConfirm = async (): Promise<void> => {
      if (!target || target.length === 0) return

      // Single and batch paths both go through `cliRemoveSelectedSkills` —
      // the batch thunk correctly handles length-1 arrays, and
      // `toastCliRemoveBatchResult` surfaces the skill name when the batch
      // had exactly one successful item. Collapsing the two branches kept
      // the dialog honest: every remove is a batch from the main process's
      // point of view.
      try {
        const result = await dispatch(cliRemoveSelectedSkills(target))
        if (cliRemoveSelectedSkills.fulfilled.match(result)) {
          settleCliRemoveBatch(result.payload)
        } else {
          toast.error(
            isBatch ? 'Batch CLI remove failed' : 'CLI remove failed',
            { description: result.error?.message ?? 'Unexpected error' },
          )
        }
      } finally {
        // `settleCliRemoveBatch` fans out via CustomEvent dispatch + toast —
        // if either throws synchronously the dialog would otherwise stay
        // mounted on a stale target. The finally guarantees the target is
        // always cleared so the dialog cannot reopen on ghost data.
        refreshAllData(dispatch)
        dispatch(setCliRemoveTarget(null))
      }
    }

    return (
      <DestructiveConfirmDialog
        open={!!target && count > 0}
        onClose={handleClose}
        onConfirm={handleConfirm}
        loading={removing}
        title={
          isBatch ? 'Remove CLI-managed Skills' : 'Remove CLI-managed Skill'
        }
        description={
          <>
            Deregister {subject} from{' '}
            <code className="text-xs">~/.agents/.skill-lock.json</code>?
            <br />
            <span className="text-muted-foreground mt-2 block">
              This runs <code className="text-xs">npx skills remove</code> and
              cannot be undone. The skill folder and lock-file entry will be
              permanently removed.
            </span>
          </>
        }
        confirmLabel="Remove"
        loadingLabel="Removing..."
        iconVariant="warning"
      />
    )
  },
)
