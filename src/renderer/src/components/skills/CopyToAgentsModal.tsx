import { Copy, Loader2 } from 'lucide-react'
import React, { useCallback, useMemo, useState } from 'react'

import { Button } from '@/renderer/src/components/ui/button'
import { Checkbox } from '@/renderer/src/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/renderer/src/components/ui/dialog'
import { useComponentEffect } from '@/renderer/src/hooks/useComponentEffect'
import { useAppDispatch, useAppSelector } from '@/renderer/src/redux/hooks'
import { setSkillToCopy } from '@/renderer/src/redux/slices/skillsSlice'
import type { AgentId } from '@/shared/types'

import {
  getOccupiedAgentReasonById,
  getOccupiedAgentReasonLabel,
  getTargetAgentsForSelection,
} from './agentSelectionHelpers'
import type { OccupiedAgentReason } from './agentSelectionHelpers'
import { copyToAgentsWithToast } from './copyToAgentsWithToast'

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
    useComponentEffect(() => {
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

    const handleClose = useCallback((): void => {
      if (!copying) {
        dispatch(setSkillToCopy(null))
        setSelectedAgents([])
      }
    }, [copying, dispatch])

    const handleAgentToggle = useCallback(
      (agentId: AgentId): void => {
        if (occupiedAgentReasonById.has(agentId)) return
        setSelectedAgents((prev) =>
          prev.includes(agentId)
            ? prev.filter((id) => id !== agentId)
            : [...prev, agentId],
        )
      },
      [occupiedAgentReasonById],
    )

    const handleCopy = useCallback(async (): Promise<void> => {
      if (!skillToCopy || !sourcePath || selectedAgents.length === 0) return
      await copyToAgentsWithToast(dispatch, {
        skill: skillToCopy,
        sourcePath,
        agentIds: selectedAgents,
      })
    }, [dispatch, selectedAgents, skillToCopy, sourcePath])

    const handleOpenChange = useCallback(
      (open: boolean): void => {
        if (!open) handleClose()
      },
      [handleClose],
    )

    const hasNewSelections = selectedAgents.length > 0

    return (
      <Dialog open={!!skillToCopy} onOpenChange={handleOpenChange}>
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
              return (
                <CopyToAgentOption
                  key={agent.id}
                  agentId={agent.id}
                  name={agent.name}
                  exists={agent.exists}
                  checked={
                    occupiedReason !== undefined ||
                    selectedAgents.includes(agent.id)
                  }
                  disabled={
                    occupiedReason !== undefined ||
                    copying ||
                    isSourceUnavailable
                  }
                  occupiedReason={occupiedReason}
                  onToggle={handleAgentToggle}
                />
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

interface CopyToAgentOptionProps {
  agentId: AgentId
  name: string
  exists: boolean
  checked: boolean
  disabled: boolean
  occupiedReason?: OccupiedAgentReason
  onToggle: (agentId: AgentId) => void
}

const CopyToAgentOption = React.memo(function CopyToAgentOption({
  agentId,
  name,
  exists,
  checked,
  disabled,
  occupiedReason,
  onToggle,
}: CopyToAgentOptionProps): React.ReactElement {
  const checkboxId = `copy-agent-${agentId}`
  const alreadyExists = occupiedReason !== undefined

  const handleToggle = useCallback((): void => {
    if (!disabled) onToggle(agentId)
  }, [agentId, disabled, onToggle])

  const handleRowClick = (): void => {
    handleToggle()
  }

  const handleCheckboxClick = useCallback((event: React.MouseEvent): void => {
    event.stopPropagation()
  }, [])

  return (
    <div
      className={`flex items-center gap-3 p-2 rounded-md transition-colors ${
        disabled
          ? 'opacity-50 cursor-not-allowed'
          : 'hover:bg-accent cursor-pointer'
      }`}
      onClick={handleRowClick}
    >
      <Checkbox
        id={checkboxId}
        aria-label={name}
        checked={checked}
        disabled={disabled}
        onClick={handleCheckboxClick}
        onCheckedChange={handleToggle}
      />
      <div
        className={
          disabled ? 'text-sm cursor-not-allowed' : 'text-sm cursor-pointer'
        }
      >
        {name}
        {!exists && (
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
})
