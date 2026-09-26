import { Copy, Loader2, Plus } from 'lucide-react'
import React from 'react'
import { toast } from 'sonner'

import { Button } from '@/renderer/src/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/renderer/src/components/ui/dialog'
import { useAppDispatch, useAppSelector } from '@/renderer/src/redux/hooks'
import {
  createSymlinks,
  setSkillToAddSymlinks,
  toggleAddAgentSelection,
} from '@/renderer/src/redux/slices/skillsSlice'
import { refreshAllData } from '@/renderer/src/redux/thunks'
import type { AgentId } from '@/shared/types'

import {
  getAddAgentSecondaryLabel,
  getOccupiedAgentReasonById,
  getTargetAgentsForSelection,
} from './agentSelectionHelpers'
import type { OccupiedAgentReason } from './agentSelectionHelpers'
import { AgentSelectionOption } from './AgentSelectionOption'
import { copyToAgentsWithToast } from './copyToAgentsWithToast'

/**
 * Modal for selecting agents to add a skill to from global view.
 * Offers both symlink creation and physical file-copy actions.
 */
export const AddSymlinkModal = function AddSymlinkModal(): React.ReactElement {
  const dispatch = useAppDispatch()
  const { skillToAddSymlinks, selectedAddAgentIds, addingSymlinks, copying } =
    useAppSelector((state) => state.skills)
  const { items: agents } = useAppSelector((state) => state.agents)

  const targetAgents = getTargetAgentsForSelection(agents)

  const occupiedAgentReasonById = (() => {
    if (!skillToAddSymlinks) return new Map<AgentId, OccupiedAgentReason>()
    return getOccupiedAgentReasonById(skillToAddSymlinks.symlinks)
  })()

  const isSubmitting = addingSymlinks || copying

  const handleClose = (): void => {
    if (!isSubmitting) {
      dispatch(setSkillToAddSymlinks(null))
    }
  }

  const handleAgentToggle = (agentId: AgentId): void => {
    if (occupiedAgentReasonById.has(agentId)) return
    dispatch(toggleAddAgentSelection(agentId))
  }

  const handleAddSymlinks = async (): Promise<void> => {
    if (!skillToAddSymlinks || selectedAddAgentIds.length === 0) return

    const result = await dispatch(
      createSymlinks({
        skill: skillToAddSymlinks,
        agentIds: selectedAddAgentIds,
      }),
    )

    if (createSymlinks.fulfilled.match(result)) {
      toast.success(`Added to ${result.payload.created} agent(s)`, {
        description: `${skillToAddSymlinks.name} symlinks created`,
      })
    } else {
      toast.error('Failed to create symlinks', {
        description: result.error?.message || 'An unexpected error occurred',
      })
    }
    // Always refresh after an add attempt: success refreshes the list,
    // failure clears any stale `state.skills.error` (via fetchSkills.pending)
    // so the SkillsList does not stay stuck on the error view.
    refreshAllData(dispatch)
  }

  const handleCopySkillFiles = async (): Promise<void> => {
    if (!skillToAddSymlinks || selectedAddAgentIds.length === 0) return
    await copyToAgentsWithToast(dispatch, {
      skill: skillToAddSymlinks,
      sourcePath: skillToAddSymlinks.path,
      agentIds: selectedAddAgentIds,
    })
  }

  const handleOpenChange = (open: boolean): void => {
    if (!open) handleClose()
  }

  const hasNewSelections = selectedAddAgentIds.length > 0

  return (
    <Dialog open={!!skillToAddSymlinks} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Plus className="h-5 w-5 text-primary" />
            <DialogTitle>Add Skill to Agents</DialogTitle>
          </div>
          <DialogDescription>
            Select agents to link or copy{' '}
            <strong>{skillToAddSymlinks?.name}</strong> to
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <h4 className="text-sm font-medium mb-3">Select Agents</h4>
          <div className="max-h-60 overflow-y-auto rounded-md border p-2 space-y-1">
            {targetAgents.map((agent) => {
              const occupiedReason = occupiedAgentReasonById.get(agent.id)
              return (
                <AddSymlinkAgentOption
                  key={agent.id}
                  agentId={agent.id}
                  name={agent.name}
                  secondaryLabel={getAddAgentSecondaryLabel({
                    occupiedReason,
                    exists: agent.exists,
                  })}
                  checked={
                    occupiedReason !== undefined ||
                    selectedAddAgentIds.includes(agent.id)
                  }
                  disabled={isSubmitting || occupiedReason !== undefined}
                  onToggle={handleAgentToggle}
                />
              )
            })}
          </div>
          {!hasNewSelections && (
            <p className="text-sm text-muted-foreground mt-2">
              Select at least one available agent
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={handleCopySkillFiles}
            disabled={isSubmitting || !hasNewSelections}
          >
            {copying ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Copying...
              </>
            ) : (
              <>
                <Copy className="h-4 w-4 mr-2" />
                Copy Skill files
              </>
            )}
          </Button>
          <Button
            onClick={handleAddSymlinks}
            disabled={isSubmitting || !hasNewSelections}
          >
            {addingSymlinks ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Adding...
              </>
            ) : (
              'Add Symlink'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface AddSymlinkAgentOptionProps {
  agentId: AgentId
  name: string
  secondaryLabel?: string
  checked: boolean
  disabled: boolean
  onToggle: (agentId: AgentId) => void
}

const AddSymlinkAgentOption = function AddSymlinkAgentOption({
  agentId,
  name,
  secondaryLabel,
  checked,
  disabled,
  onToggle,
}: AddSymlinkAgentOptionProps): React.ReactElement {
  return (
    <AgentSelectionOption
      agentId={agentId}
      checkboxId={`add-agent-${agentId}`}
      name={name}
      checked={checked}
      disabled={disabled}
      secondaryLabel={secondaryLabel}
      hoverClassName="hover:bg-muted"
      onToggle={onToggle}
    />
  )
}
