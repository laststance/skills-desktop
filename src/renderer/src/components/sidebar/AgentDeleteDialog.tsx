import React from 'react'
import { toast } from 'sonner'

import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import {
  removeAllSymlinksFromAgent,
  setAgentToDelete,
} from '../../redux/slices/agentsSlice'
import { refreshAllData } from '../../redux/thunks'
import { DestructiveConfirmDialog } from '../shared/DestructiveConfirmDialog'

/**
 * Confirmation dialog for deleting an agent's entire skills folder
 * Removes everything: symlinks, local skills, and the directory itself
 */
export const AgentDeleteDialog = React.memo(
  function AgentDeleteDialog(): React.ReactElement {
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
        refreshAllData(dispatch)
      } else {
        toast.error('Failed to delete skills folder', {
          description: result.error?.message || 'An unexpected error occurred',
        })
      }
    }

    return (
      <DestructiveConfirmDialog
        open={!!agentToDelete}
        onClose={handleClose}
        onConfirm={handleDelete}
        loading={deleting}
        title="Delete Skills Folder"
        description={
          <>
            Permanently delete the skills folder for{' '}
            <strong>{agentToDelete?.name}</strong>?
            <br />
            <span className="text-destructive/80 mt-2 block">
              This will delete all symlinks and local skills in this agent's
              directory. This action cannot be undone.
            </span>
          </>
        }
        confirmLabel="Delete"
        loadingLabel="Deleting..."
      />
    )
  },
)
