import { Loader2, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'

import type { AgentId } from '../../../../shared/types'
import { cn } from '../../lib/utils'
import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import { fetchAgents } from '../../redux/slices/agentsSlice'
import {
  createSymlinks,
  fetchSkills,
  setSkillToAddSymlinks,
} from '../../redux/slices/skillsSlice'
import { fetchSourceStats } from '../../redux/slices/uiSlice'
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

/**
 * Modal for selecting agents to add skill symlinks to
 * Shows agent checkboxes with already-linked agents disabled
 */
export function AddSymlinkModal(): React.ReactElement {
  const dispatch = useAppDispatch()
  const { skillToAddSymlinks, addingSymlinks } = useAppSelector(
    (state) => state.skills,
  )
  const { items: agents } = useAppSelector((state) => state.agents)

  const [selectedAgents, setSelectedAgents] = useState<AgentId[]>([])

  const existingAgents = useMemo(() => agents.filter((a) => a.exists), [agents])

  const alreadyLinkedAgentIds = useMemo(() => {
    if (!skillToAddSymlinks) return new Set<AgentId>()
    return new Set(
      skillToAddSymlinks.symlinks
        .filter((s) => s.status === 'valid')
        .map((s) => s.agentId),
    )
  }, [skillToAddSymlinks])

  const handleClose = (): void => {
    if (!addingSymlinks) {
      dispatch(setSkillToAddSymlinks(null))
      setSelectedAgents([])
    }
  }

  const handleAgentToggle = (agentId: AgentId): void => {
    if (alreadyLinkedAgentIds.has(agentId)) return
    setSelectedAgents((prev) =>
      prev.includes(agentId)
        ? prev.filter((id) => id !== agentId)
        : [...prev, agentId],
    )
  }

  const handleAddSymlinks = async (): Promise<void> => {
    if (!skillToAddSymlinks || selectedAgents.length === 0) return

    const result = await dispatch(
      createSymlinks({ skill: skillToAddSymlinks, agentIds: selectedAgents }),
    )

    if (createSymlinks.fulfilled.match(result)) {
      toast.success(`Added to ${result.payload.created} agent(s)`, {
        description: `${skillToAddSymlinks.name} symlinks created`,
      })
      dispatch(fetchSkills())
      dispatch(fetchAgents())
      dispatch(fetchSourceStats())
    } else {
      toast.error('Failed to create symlinks', {
        description: result.error?.message || 'An unexpected error occurred',
      })
    }
  }

  const hasNewSelections = selectedAgents.length > 0

  return (
    <Dialog open={!!skillToAddSymlinks} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Plus className="h-5 w-5 text-primary" />
            <DialogTitle>Add Symlink</DialogTitle>
          </div>
          <DialogDescription>
            Select agents to link <strong>{skillToAddSymlinks?.name}</strong> to
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <h4 className="text-sm font-medium mb-3">Select Agents</h4>
          <div className="max-h-[240px] overflow-y-auto rounded-md border p-2 space-y-1">
            {existingAgents.map((agent) => {
              const isAlreadyLinked = alreadyLinkedAgentIds.has(agent.id)
              return (
                <label
                  key={agent.id}
                  className={cn(
                    'flex items-center gap-3 p-2 rounded-md',
                    isAlreadyLinked
                      ? 'opacity-50 cursor-not-allowed'
                      : 'hover:bg-muted cursor-pointer',
                  )}
                >
                  <Checkbox
                    checked={
                      isAlreadyLinked || selectedAgents.includes(agent.id)
                    }
                    onCheckedChange={() => handleAgentToggle(agent.id)}
                    disabled={addingSymlinks || isAlreadyLinked}
                  />
                  <span className="text-sm">
                    {agent.name}
                    {isAlreadyLinked && (
                      <span className="text-xs text-muted-foreground ml-2">
                        (linked)
                      </span>
                    )}
                  </span>
                </label>
              )
            })}
          </div>
          {!hasNewSelections && (
            <p className="text-sm text-muted-foreground mt-2">
              Select at least one new agent
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={addingSymlinks}
          >
            Cancel
          </Button>
          <Button
            onClick={handleAddSymlinks}
            disabled={addingSymlinks || !hasNewSelections}
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
