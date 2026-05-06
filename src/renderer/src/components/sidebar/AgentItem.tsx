import { Eraser, EyeOff, FolderOpen, Terminal, Trash2 } from 'lucide-react'
import React, { useMemo, useState } from 'react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/renderer/src/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/renderer/src/components/ui/tooltip'
import { useOpenFolder } from '@/renderer/src/hooks/useOpenFolder'
import { useUpdateSettings } from '@/renderer/src/hooks/useUpdateSettings'
import { cn, toggleArrayMember } from '@/renderer/src/lib/utils'
import { useAppDispatch, useAppSelector } from '@/renderer/src/redux/hooks'
import { setAgentToDelete } from '@/renderer/src/redux/slices/agentsSlice'
import { selectHiddenAgentIds } from '@/renderer/src/redux/slices/settingsSlice'
import {
  selectAgent,
  setCleanupAgentTarget,
} from '@/renderer/src/redux/slices/uiSlice'
import { AGENT_DEFINITIONS } from '@/shared/constants'
import type { Agent, AgentId } from '@/shared/types'

interface AgentItemProps {
  agent: Agent
}

/**
 * Build skill count display text
 * @param linked - Number of symlinked skills
 * @param local - Number of local skills
 * @returns
 * - "3 linked, 1 local" (both present)
 * - "3 linked" (only linked)
 * - "1 local" (only local)
 * - null (neither)
 * @example
 * buildSkillCountText(3, 1) // => "3 linked, 1 local"
 * buildSkillCountText(0, 2) // => "2 local"
 */
function buildSkillCountText(linked: number, local: number): string | null {
  const parts: string[] = []
  if (linked > 0) parts.push(`${linked} linked`)
  if (local > 0) parts.push(`${local} local`)
  return parts.length > 0 ? parts.join(', ') : null
}

/**
 * Get the tilde-notation display path for an agent's skills folder.
 *
 * Reads `scanDir` directly — the same field `src/main/constants.ts`
 * uses to build `AGENTS.path`. Cline and Warp diverge from `installDir`
 * here so the tooltip matches what the scanner actually reads (their
 * own home dirs, not the universal source).
 * @param agentId - Agent ID to look up
 * @returns "~/.claude/skills/" style path, or undefined if not found
 * @example
 * getAgentTooltipPath('claude-code') // => "~/.claude/skills/"
 * getAgentTooltipPath('cline')       // => "~/.cline/skills/"
 */
function getAgentTooltipPath(agentId: AgentId): string | undefined {
  const def = AGENT_DEFINITIONS.find((d) => d.id === agentId)
  if (!def) return undefined
  return `~/${def.scanDir}/skills/`
}

/**
 * Single agent item in the sidebar
 * Left-click filters skills list. Right-click opens context menu for delete.
 * Shows "N linked, M local" skill counts.
 * Hover tooltip displays the agent's skills folder path.
 */
export const AgentItem = React.memo(function AgentItem({
  agent,
}: AgentItemProps): React.ReactElement {
  const dispatch = useAppDispatch()
  const { selectedAgentId } = useAppSelector((state) => state.ui)
  const hiddenAgentIds = useAppSelector(selectHiddenAgentIds)
  const isSelected = selectedAgentId === agent.id
  const isHidden = hiddenAgentIds.includes(agent.id)
  const [contextOpen, setContextOpen] = useState(false)
  const { revealInFinder, openInTerminal } = useOpenFolder()
  const updateSettings = useUpdateSettings()

  const handleClick = (): void => {
    if (!agent.exists) return
    dispatch(selectAgent(isSelected ? null : agent.id))
  }

  const handleContextMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    if (!agent.exists) return
    setContextOpen(true)
  }

  const handleRevealInFinder = (): void => {
    void revealInFinder(agent.path)
  }

  const handleOpenInTerminal = (): void => {
    void openInTerminal(agent.path)
  }

  const handleDelete = (): void => {
    dispatch(setAgentToDelete(agent))
    setContextOpen(false)
  }

  const handleCleanupMissing = (): void => {
    // Opens `CleanupAgentDialog`. The dialog itself dispatches the scoped
    // `fetchSyncPreview({ agentId })` once it mounts, so we don't need
    // to chain it here — keeps the menu handler synchronous.
    dispatch(setCleanupAgentTarget(agent.id))
    setContextOpen(false)
  }

  const handleToggleHidden = (): void => {
    // Pure visibility toggle — skills, symlinks, and marketplace presence
    // are untouched. Matching unhide affordances live in Settings → Agents
    // and inside the "N hidden" sidebar disclosure.
    updateSettings({
      hiddenAgentIds: toggleArrayMember(hiddenAgentIds, agent.id),
    })
    setContextOpen(false)
  }

  const skillCountText = useMemo(
    () =>
      agent.exists
        ? buildSkillCountText(agent.skillCount, agent.localSkillCount)
        : null,
    [agent.exists, agent.skillCount, agent.localSkillCount],
  )

  const tooltipPath = useMemo(() => getAgentTooltipPath(agent.id), [agent.id])

  return (
    <Tooltip>
      <DropdownMenu
        open={contextOpen}
        onOpenChange={(open) => {
          if (!open) setContextOpen(false)
        }}
      >
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Filter skills by ${agent.name}${skillCountText ? ` (${skillCountText})` : ''}`}
              className={cn(
                'flex w-full items-center gap-2 min-h-[44px] py-1.5 px-2 rounded-md transition-colors border-l-4 border-l-transparent text-left',
                agent.exists && 'cursor-pointer hover:bg-muted/50',
                isSelected && 'border-l-primary bg-primary/10',
              )}
              onClick={handleClick}
              onContextMenu={handleContextMenu}
            >
              <span
                className={cn(
                  'text-sm truncate min-w-0',
                  !agent.exists && 'text-muted-foreground/70',
                )}
              >
                {agent.name}
              </span>
              {skillCountText && (
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {skillCountText}
                </span>
              )}
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <DropdownMenuContent>
          {/* Folder actions go above destructive items so accidental keyboard */}
          {/* navigation (Down arrow → Enter) lands on a safe action first. */}
          {/* `onSelect` (not `onClick`) — Radix DropdownMenu.Item only fires */}
          {/* `onSelect` for keyboard activation (Enter/Space). */}
          <DropdownMenuItem onSelect={handleRevealInFinder}>
            <FolderOpen className="h-4 w-4 mr-2" />
            Reveal in Finder
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={handleOpenInTerminal}>
            <Terminal className="h-4 w-4 mr-2" />
            Open in Terminal
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={handleToggleHidden}>
            <EyeOff className="h-4 w-4 mr-2" />
            {isHidden ? 'Show in sidebar' : 'Hide from sidebar'}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleCleanupMissing}>
            <Eraser className="h-4 w-4 mr-2" />
            Cleanup missing skills...
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={handleDelete}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Delete skills folder
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {tooltipPath && (
        <TooltipContent side="right">
          <span>{tooltipPath}</span>
        </TooltipContent>
      )}
    </Tooltip>
  )
})
