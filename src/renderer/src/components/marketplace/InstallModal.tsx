import { Loader2 } from 'lucide-react'
import { useMemo, useState } from 'react'

import type { InstallOptions } from '../../../../shared/types'
import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import {
  selectSkillForInstall,
  installSkill,
} from '../../redux/slices/marketplaceSlice'
import { fetchSkills } from '../../redux/slices/skillsSlice'
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
 * Modal dialog for configuring skill installation options
 */
export function InstallModal(): React.ReactElement {
  const dispatch = useAppDispatch()
  const { selectedSkill, status, installProgress } = useAppSelector(
    (state) => state.marketplace,
  )
  const { items: agents } = useAppSelector((state) => state.agents)

  // Default to Claude Code selected
  const [selectedAgents, setSelectedAgents] = useState<string[]>([
    'claude-code',
  ])
  const [isGlobal] = useState(true) // Always install globally for now

  const isInstalling = status === 'installing'
  const existingAgents = useMemo(() => agents.filter((a) => a.exists), [agents])

  const handleClose = (): void => {
    if (!isInstalling) {
      dispatch(selectSkillForInstall(null))
      setSelectedAgents(['claude-code'])
    }
  }

  const handleAgentToggle = (agentId: string): void => {
    setSelectedAgents((prev) =>
      prev.includes(agentId)
        ? prev.filter((id) => id !== agentId)
        : [...prev, agentId],
    )
  }

  const handleInstall = async (): Promise<void> => {
    if (!selectedSkill || selectedAgents.length === 0) return

    const options: InstallOptions = {
      repo: selectedSkill.repo,
      global: isGlobal,
      agents: selectedAgents,
      skills: [selectedSkill.name],
    }

    await dispatch(installSkill(options))
    // Refresh the skills list after installation
    dispatch(fetchSkills())
    handleClose()
  }

  return (
    <Dialog open={!!selectedSkill} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Install Skill</DialogTitle>
          <DialogDescription>
            Configure installation options for{' '}
            <strong>{selectedSkill?.name}</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          {/* Agent selection */}
          <div>
            <h4 className="text-sm font-medium mb-3">Select Agents</h4>
            <div className="max-h-[240px] overflow-y-auto rounded-md border p-2 space-y-1">
              {existingAgents.map((agent) => (
                <label
                  key={agent.id}
                  className="flex items-center gap-3 p-2 rounded-md hover:bg-muted cursor-pointer"
                >
                  <Checkbox
                    checked={selectedAgents.includes(agent.id)}
                    onCheckedChange={() => handleAgentToggle(agent.id)}
                    disabled={isInstalling}
                  />
                  <span className="text-sm">{agent.name}</span>
                </label>
              ))}
            </div>
            {selectedAgents.length === 0 && (
              <p className="text-sm text-destructive mt-2">
                Please select at least one agent
              </p>
            )}
          </div>

          {/* Progress indicator */}
          {isInstalling && installProgress && (
            <div className="mt-4 p-3 bg-primary/10 rounded-md">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="text-sm">{installProgress.message}</span>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            disabled={isInstalling}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleInstall}
            disabled={isInstalling || selectedAgents.length === 0}
          >
            {isInstalling ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Installing...
              </>
            ) : (
              'Install'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
