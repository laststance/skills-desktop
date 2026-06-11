import { Loader2 } from 'lucide-react'
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
import {
  ToggleGroup,
  ToggleGroupItem,
} from '@/renderer/src/components/ui/toggle-group'
import { useAppDispatch, useAppSelector } from '@/renderer/src/redux/hooks'
import {
  selectSkillForInstall,
  installSkill,
} from '@/renderer/src/redux/slices/marketplaceSlice'
import { fetchSkills } from '@/renderer/src/redux/slices/skillsSlice'
import type { AgentId, InstallOptions } from '@/shared/types'

type InstallTargetMode = 'universal-only' | 'universal-and-agents'

const DEFAULT_INSTALL_TARGET_MODE: InstallTargetMode = 'universal-and-agents'
const DEFAULT_SELECTED_AGENT_IDS: AgentId[] = ['claude-code']

/**
 * Check whether Radix emitted a real install target mode before committing it to state.
 * @param value - ToggleGroup value emitted by the install target segmented control.
 * @returns true when the value is one of the supported install target modes.
 * @example
 * isInstallTargetMode('universal-only') // => true
 */
function isInstallTargetMode(value: string): value is InstallTargetMode {
  return value === 'universal-only' || value === 'universal-and-agents'
}

/**
 * Resolve the CLI agent payload from the visible install mode.
 * @param mode - Install target selected in the Marketplace modal.
 * @param selectedAgents - Agent ids checked for symlink creation.
 * @returns Empty for Universal-only installs; selected ids when symlinks should be created.
 * @example
 * getInstallAgentIds('universal-only', ['claude-code']) // => []
 */
function getInstallAgentIds(
  mode: InstallTargetMode,
  selectedAgents: AgentId[],
): AgentId[] {
  if (mode === 'universal-only') {
    return []
  }

  return selectedAgents
}

/**
 * Modal dialog for configuring Marketplace installs before the CLI runs.
 * @returns Dialog UI when a Marketplace skill is selected, otherwise an inert closed dialog.
 * @example
 * <InstallModal />
 */
export const InstallModal = React.memo(
  function InstallModal(): React.ReactElement {
    const dispatch = useAppDispatch()
    const { selectedSkill, status, installProgress } = useAppSelector(
      (state) => state.marketplace,
    )
    const { items: agents } = useAppSelector((state) => state.agents)

    const [installTargetMode, setInstallTargetMode] =
      useState<InstallTargetMode>(DEFAULT_INSTALL_TARGET_MODE)
    const [selectedAgents, setSelectedAgents] = useState<AgentId[]>([
      ...DEFAULT_SELECTED_AGENT_IDS,
    ])

    const isInstalling = status === 'installing'
    const existingAgents = useMemo(
      () => agents.filter((a) => a.exists),
      [agents],
    )
    const existingAgentIds = useMemo(
      () => new Set(existingAgents.map((agent) => agent.id)),
      [existingAgents],
    )
    const validSelectedAgents = useMemo(
      () => selectedAgents.filter((id) => existingAgentIds.has(id)),
      [existingAgentIds, selectedAgents],
    )
    const hasAvailableAgents = existingAgents.length > 0
    // With no installed agents, Universal-only is the only actionable target.
    const effectiveInstallTargetMode: InstallTargetMode = hasAvailableAgents
      ? installTargetMode
      : 'universal-only'
    const shouldCreateAgentSymlinks =
      effectiveInstallTargetMode === 'universal-and-agents'
    const canInstall =
      !isInstalling &&
      selectedSkill !== null &&
      (!shouldCreateAgentSymlinks || validSelectedAgents.length > 0)

    const handleClose = useCallback((): void => {
      if (!isInstalling) {
        dispatch(selectSkillForInstall(null))
        setInstallTargetMode(DEFAULT_INSTALL_TARGET_MODE)
        setSelectedAgents([...DEFAULT_SELECTED_AGENT_IDS])
      }
    }, [dispatch, isInstalling])

    const handleInstallTargetModeChange = useCallback((value: string): void => {
      if (isInstallTargetMode(value)) {
        setInstallTargetMode(value)
      }
    }, [])

    const handleAgentToggle = useCallback((agentId: AgentId): void => {
      setSelectedAgents((prev) =>
        prev.includes(agentId)
          ? prev.filter((id) => id !== agentId)
          : [...prev, agentId],
      )
    }, [])

    const handleInstall = useCallback(async (): Promise<void> => {
      if (!canInstall || !selectedSkill) return

      const options: InstallOptions = {
        repo: selectedSkill.repo,
        // Marketplace installs are global-only by design — skills land in the
        // shared ~/.agents/skills/ source dir. The target mode below only
        // controls whether the CLI also creates agent symlinks.
        global: true,
        agents: getInstallAgentIds(
          effectiveInstallTargetMode,
          validSelectedAgents,
        ),
        skills: [selectedSkill.name],
      }

      await dispatch(installSkill(options))
      // Refresh the skills list after installation
      dispatch(fetchSkills())
      handleClose()
    }, [
      canInstall,
      dispatch,
      effectiveInstallTargetMode,
      handleClose,
      selectedSkill,
      validSelectedAgents,
    ])

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
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-medium mb-2">Install target</h4>
                <ToggleGroup
                  type="single"
                  value={effectiveInstallTargetMode}
                  onValueChange={handleInstallTargetModeChange}
                  variant="outline"
                  disabled={isInstalling}
                  className="w-full gap-0 rounded-md border border-border/60 bg-muted/30 p-0.5"
                >
                  <ToggleGroupItem
                    value="universal-only"
                    aria-label="Universal only"
                    className="h-8 flex-1 rounded-r-none"
                  >
                    Universal
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    value="universal-and-agents"
                    aria-label="Universal plus selected agents"
                    disabled={!hasAvailableAgents}
                    className="h-8 flex-1 rounded-l-none border-l-0"
                  >
                    Universal + agents
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>

              {shouldCreateAgentSymlinks ? (
                <div>
                  <h4 className="text-sm font-medium mb-3">
                    Symlink agent directories
                  </h4>
                  <div className="max-h-60 overflow-y-auto rounded-md border p-2 space-y-1">
                    {existingAgents.map((agent) => (
                      <InstallAgentOption
                        key={agent.id}
                        agentId={agent.id}
                        name={agent.name}
                        checked={selectedAgents.includes(agent.id)}
                        disabled={isInstalling}
                        onToggle={handleAgentToggle}
                      />
                    ))}
                  </div>
                  {validSelectedAgents.length === 0 && (
                    <p className="text-sm text-destructive mt-2">
                      Please select at least one agent
                    </p>
                  )}
                </div>
              ) : (
                <div className="rounded-md border bg-muted/20 p-3">
                  <p className="text-sm font-medium">No agent symlinks</p>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    ~/.agents/skills/{selectedSkill?.name}
                  </p>
                </div>
              )}
            </div>

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
              disabled={!canInstall}
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
  },
)

interface InstallAgentOptionProps {
  agentId: AgentId
  name: string
  checked: boolean
  disabled: boolean
  onToggle: (agentId: AgentId) => void
}

/**
 * Checkbox row for choosing which installed agent dirs receive Marketplace symlinks.
 * @param props - Agent identity, disabled state, checked state, and toggle callback.
 * @returns A compact selectable row for the install dialog.
 * @example
 * <InstallAgentOption agentId="claude-code" name="Claude Code" checked={true} disabled={false} onToggle={toggle} />
 */
const InstallAgentOption = React.memo(function InstallAgentOption({
  agentId,
  name,
  checked,
  disabled,
  onToggle,
}: InstallAgentOptionProps): React.ReactElement {
  const handleCheckedChange = useCallback((): void => {
    onToggle(agentId)
  }, [agentId, onToggle])

  return (
    <label className="flex items-center gap-3 p-2 rounded-md hover:bg-muted cursor-pointer">
      <Checkbox
        checked={checked}
        onCheckedChange={handleCheckedChange}
        disabled={disabled}
      />
      <span className="text-sm">{name}</span>
    </label>
  )
})
