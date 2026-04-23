import { Copy, Loader2 } from 'lucide-react'
import React, { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import type { AgentId } from '../../../../shared/types'
import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import { copyToAgents, setSkillToCopy } from '../../redux/slices/skillsSlice'
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
 * Modal for selecting target agents when copying a skill source from one agent to others.
 * Triggered by right-click "Copy to..." on a skill card in Agent View.
 * @example
 * <CopyToAgentsModal />
 */
export const CopyToAgentsModal = React.memo(
  function CopyToAgentsModal(): React.ReactElement {
    const dispatch = useAppDispatch()
    const { skillToCopy, copying } = useAppSelector((state) => state.skills)
    const { selectedAgentId } = useAppSelector((state) => state.ui)
    const { items: agents } = useAppSelector((state) => state.agents)

    const [selectedAgents, setSelectedAgents] = useState<AgentId[]>([])

    // Reset selections when modal opens for a new skill
    useEffect(() => {
      setSelectedAgents([])
    }, [skillToCopy])

    const targetAgents = useMemo(() => {
      if (!selectedAgentId) return []
      return getTargetAgentsForSelection(agents, {
        excludeAgentId: selectedAgentId,
      })
    }, [agents, selectedAgentId])

    /** Agent IDs where this skill already occupies the destination path. */
    const occupiedAgentReasonById = useMemo(() => {
      if (!skillToCopy) return new Map<AgentId, OccupiedAgentReason>()
      return getOccupiedAgentReasonById(skillToCopy.symlinks)
    }, [skillToCopy])

    /** The on-disk source entry for the selected agent's copy operation. */
    const sourcePath = useMemo(() => {
      if (!skillToCopy || !selectedAgentId) return null
      const symlink = skillToCopy.symlinks.find(
        (s) => s.agentId === selectedAgentId,
      )
      if (!symlink) return null
      if (!symlink.isLocal && symlink.status !== 'valid') return null
      return symlink.linkPath
    }, [skillToCopy, selectedAgentId])
    const isSourceUnavailable = sourcePath === null

    const handleClose = (): void => {
      if (!copying) {
        dispatch(setSkillToCopy(null))
        setSelectedAgents([])
      }
    }

    const handleAgentToggle = (agentId: AgentId): void => {
      if (occupiedAgentReasonById.has(agentId)) return
      setSelectedAgents((prev) =>
        prev.includes(agentId)
          ? prev.filter((id) => id !== agentId)
          : [...prev, agentId],
      )
    }

    const handleCopy = async (): Promise<void> => {
      if (!skillToCopy || !sourcePath || selectedAgents.length === 0) return

      const result = await dispatch(
        copyToAgents({
          skill: skillToCopy,
          sourcePath,
          agentIds: selectedAgents,
        }),
      )

      if (copyToAgents.fulfilled.match(result)) {
        if (result.payload.failures.length > 0) {
          toast.warning(
            `Copied to ${result.payload.copied} agent(s), ${result.payload.failures.length} failed`,
            {
              description: result.payload.failures
                .map((f) => `${f.agentId}: ${f.error}`)
                .join(', '),
            },
          )
        } else {
          toast.success(`Copied to ${result.payload.copied} agent(s)`, {
            description: `${skillToCopy.name} copied successfully`,
          })
        }
      } else {
        toast.error('Failed to copy skill', {
          description: result.error?.message || 'An unexpected error occurred',
        })
      }
      // Always refresh after a copy attempt: success refreshes the list,
      // failure clears any stale `state.skills.error` (via fetchSkills.pending)
      // so the SkillsList does not stay stuck on the error view.
      refreshAllData(dispatch)
    }

    const hasNewSelections = selectedAgents.length > 0

    return (
      <Dialog
        open={!!skillToCopy}
        onOpenChange={(open) => !open && handleClose()}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Copy className="h-4 w-4" />
              Copy to Agents
            </DialogTitle>
            <DialogDescription>
              Select agents to copy <strong>{skillToCopy?.name}</strong> to.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-64 overflow-y-auto space-y-2 py-2">
            {targetAgents.map((agent) => {
              const occupiedReason = occupiedAgentReasonById.get(agent.id)
              const alreadyExists = occupiedReason !== undefined
              const checkboxId = `copy-agent-${agent.id}`
              return (
                <div
                  key={agent.id}
                  className={`flex items-center gap-3 p-2 rounded-md transition-colors ${
                    alreadyExists || isSourceUnavailable
                      ? 'opacity-50 cursor-not-allowed'
                      : 'hover:bg-accent cursor-pointer'
                  }`}
                  onClick={() =>
                    !alreadyExists &&
                    !copying &&
                    !isSourceUnavailable &&
                    handleAgentToggle(agent.id)
                  }
                >
                  <Checkbox
                    id={checkboxId}
                    aria-label={agent.name}
                    checked={alreadyExists || selectedAgents.includes(agent.id)}
                    disabled={alreadyExists || copying || isSourceUnavailable}
                    onClick={(event) => event.stopPropagation()}
                    onCheckedChange={() => handleAgentToggle(agent.id)}
                  />
                  <div
                    className={
                      alreadyExists || copying || isSourceUnavailable
                        ? 'text-sm cursor-not-allowed'
                        : 'text-sm cursor-pointer'
                    }
                  >
                    {agent.name}
                    {!agent.exists && (
                      <span className="text-xs text-muted-foreground ml-2">
                        not installed
                      </span>
                    )}
                    {alreadyExists && occupiedReason && (
                      <span className="text-xs text-muted-foreground ml-2">
                        {getOccupiedAgentReasonLabel(occupiedReason)}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          {isSourceUnavailable && (
            <p className="text-sm text-muted-foreground">
              The selected source is unavailable. Choose a valid or local skill
              before copying.
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={handleClose} disabled={copying}>
              Cancel
            </Button>
            <Button
              onClick={handleCopy}
              disabled={!hasNewSelections || copying || isSourceUnavailable}
            >
              {copying && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {copying
                ? 'Copying...'
                : `Copy to ${selectedAgents.length} agent(s)`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  },
)
