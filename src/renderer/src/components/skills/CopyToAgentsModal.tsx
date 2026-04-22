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

import { getTargetAgentsForSelection } from './agentSelectionHelpers'

/**
 * Modal for selecting target agents when copying a skill from one agent to others.
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

    /** Agent IDs where this skill already exists (valid symlink or local) */
    const alreadyExistsAgentIds = useMemo(() => {
      if (!skillToCopy) return new Set<AgentId>()
      return new Set(
        skillToCopy.symlinks
          .filter((s) => s.status === 'valid' || s.isLocal)
          .map((s) => s.agentId),
      )
    }, [skillToCopy])

    /** The linkPath of the skill in the source agent */
    const sourceLinkPath = useMemo(() => {
      if (!skillToCopy || !selectedAgentId) return null
      const symlink = skillToCopy.symlinks.find(
        (s) => s.agentId === selectedAgentId,
      )
      return symlink?.linkPath ?? null
    }, [skillToCopy, selectedAgentId])

    const handleClose = (): void => {
      if (!copying) {
        dispatch(setSkillToCopy(null))
        setSelectedAgents([])
      }
    }

    const handleAgentToggle = (agentId: AgentId): void => {
      if (alreadyExistsAgentIds.has(agentId)) return
      setSelectedAgents((prev) =>
        prev.includes(agentId)
          ? prev.filter((id) => id !== agentId)
          : [...prev, agentId],
      )
    }

    const handleCopy = async (): Promise<void> => {
      if (!skillToCopy || !sourceLinkPath || selectedAgents.length === 0) return

      const result = await dispatch(
        copyToAgents({
          skill: skillToCopy,
          linkPath: sourceLinkPath,
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
              const alreadyExists = alreadyExistsAgentIds.has(agent.id)
              const checkboxId = `copy-agent-${agent.id}`
              return (
                <div
                  key={agent.id}
                  className={`flex items-center gap-3 p-2 rounded-md transition-colors ${
                    alreadyExists
                      ? 'opacity-50 cursor-not-allowed'
                      : 'hover:bg-accent cursor-pointer'
                  }`}
                  onClick={() =>
                    !alreadyExists && !copying && handleAgentToggle(agent.id)
                  }
                >
                  <Checkbox
                    id={checkboxId}
                    checked={alreadyExists || selectedAgents.includes(agent.id)}
                    disabled={alreadyExists || copying}
                    onCheckedChange={() => handleAgentToggle(agent.id)}
                  />
                  <label
                    htmlFor={checkboxId}
                    className="text-sm cursor-pointer"
                  >
                    {agent.name}
                    {!agent.exists && (
                      <span className="text-xs text-muted-foreground ml-2">
                        not installed
                      </span>
                    )}
                    {alreadyExists && (
                      <span className="text-xs text-muted-foreground ml-2">
                        already exists
                      </span>
                    )}
                  </label>
                </div>
              )
            })}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleClose} disabled={copying}>
              Cancel
            </Button>
            <Button
              onClick={handleCopy}
              disabled={!hasNewSelections || copying}
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
