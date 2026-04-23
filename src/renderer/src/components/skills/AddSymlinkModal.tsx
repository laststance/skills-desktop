import { Copy, Loader2, Plus } from 'lucide-react'
import React, { useMemo } from 'react'
import { toast } from 'sonner'

import type { AgentId } from '../../../../shared/types'
import { cn } from '../../lib/utils'
import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import {
  copyToAgents,
  createSymlinks,
  setSkillToAddSymlinks,
  toggleAddAgentSelection,
} from '../../redux/slices/skillsSlice'
import { refreshAllData } from '../../redux/thunks'
import { Button } from '../ui/button'
import { Checkbox } from '../ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'

import {
  getOccupiedAgentReasonById,
  getOccupiedAgentReasonLabel,
  getTargetAgentsForSelection,
} from './agentSelectionHelpers'
import type { OccupiedAgentReason } from './agentSelectionHelpers'

/**
 * Modal for selecting agents to add a skill to from global view.
 * Offers both symlink creation and physical file-copy actions.
 */
export const AddSymlinkModal = React.memo(
  function AddSymlinkModal(): React.ReactElement {
    const dispatch = useAppDispatch()
    const { skillToAddSymlinks, selectedAddAgentIds, addingSymlinks, copying } =
      useAppSelector((state) => state.skills)
    const { items: agents } = useAppSelector((state) => state.agents)

    const targetAgents = useMemo(
      () => getTargetAgentsForSelection(agents),
      [agents],
    )

    const occupiedAgentReasonById = useMemo(() => {
      if (!skillToAddSymlinks) return new Map<AgentId, OccupiedAgentReason>()
      return getOccupiedAgentReasonById(skillToAddSymlinks.symlinks)
    }, [skillToAddSymlinks])

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

      const result = await dispatch(
        copyToAgents({
          skill: skillToAddSymlinks,
          sourcePath: skillToAddSymlinks.path,
          agentIds: selectedAddAgentIds,
        }),
      )

      if (copyToAgents.fulfilled.match(result)) {
        if (result.payload.failures.length > 0) {
          toast.warning(
            `Copied to ${result.payload.copied} agent(s), ${result.payload.failures.length} failed`,
            {
              description: result.payload.failures
                .map((failure) => `${failure.agentId}: ${failure.error}`)
                .join(', '),
            },
          )
        } else {
          toast.success(`Copied to ${result.payload.copied} agent(s)`, {
            description: `${skillToAddSymlinks.name} copied successfully`,
          })
        }
      } else {
        toast.error('Failed to copy skill', {
          description: result.error?.message || 'An unexpected error occurred',
        })
      }
      refreshAllData(dispatch)
    }

    const hasNewSelections = selectedAddAgentIds.length > 0

    return (
      <Dialog
        open={!!skillToAddSymlinks}
        onOpenChange={(open) => !open && handleClose()}
      >
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
            <div className="max-h-[240px] overflow-y-auto rounded-md border p-2 space-y-1">
              {targetAgents.map((agent) => {
                const occupiedReason = occupiedAgentReasonById.get(agent.id)
                const isOccupied = occupiedReason !== undefined
                const checkboxId = `add-agent-${agent.id}`
                return (
                  <div
                    key={agent.id}
                    className={cn(
                      'flex items-center gap-3 p-2 rounded-md',
                      isOccupied
                        ? 'opacity-50 cursor-not-allowed'
                        : 'hover:bg-muted cursor-pointer',
                    )}
                    onClick={() =>
                      !isOccupied &&
                      !isSubmitting &&
                      handleAgentToggle(agent.id)
                    }
                  >
                    <Checkbox
                      id={checkboxId}
                      aria-label={agent.name}
                      checked={
                        isOccupied || selectedAddAgentIds.includes(agent.id)
                      }
                      onClick={(event) => event.stopPropagation()}
                      onCheckedChange={() => handleAgentToggle(agent.id)}
                      disabled={isSubmitting || isOccupied}
                    />
                    <div
                      className={cn(
                        'text-sm',
                        isOccupied || isSubmitting
                          ? 'cursor-not-allowed'
                          : 'cursor-pointer',
                      )}
                    >
                      {agent.name}
                      {!agent.exists && (
                        <span className="text-xs text-muted-foreground ml-2">
                          not installed
                        </span>
                      )}
                      {isOccupied && occupiedReason && (
                        <span className="text-xs text-muted-foreground ml-2">
                          {getOccupiedAgentReasonLabel(occupiedReason)}
                        </span>
                      )}
                    </div>
                  </div>
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
  },
)
