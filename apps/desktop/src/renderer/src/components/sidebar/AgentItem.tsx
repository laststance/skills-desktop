import {
  Eraser,
  EyeOff,
  FolderOpen,
  MoreHorizontal,
  Terminal,
  Trash2,
} from 'lucide-react'
import React, { useRef, useState } from 'react'

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
  setActiveTab,
  setCleanupAgentTarget,
} from '@/renderer/src/redux/slices/uiSlice'
import { AGENT_DEFINITIONS } from '@/shared/constants'
import type { Agent, AgentId, SkillCount } from '@/shared/types'

interface AgentItemProps {
  agent: Agent
  focusFallbackRef?: React.RefObject<HTMLElement | null>
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
function buildSkillCountText(
  linked: SkillCount,
  local: SkillCount,
): string | null {
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
 * The filter and its actions menu are separate keyboard stops.
 * Shows "N linked, M local" skill counts.
 * Hover tooltip displays the agent's skills folder path.
 */
export const AgentItem = function AgentItem({
  agent,
  focusFallbackRef,
}: AgentItemProps): React.ReactElement {
  const dispatch = useAppDispatch()
  const { selectedAgentId } = useAppSelector((state) => state.ui)
  const hiddenAgentIds = useAppSelector(selectHiddenAgentIds)
  const isSelected = selectedAgentId === agent.id
  const isHidden = hiddenAgentIds.includes(agent.id)
  const [contextOpen, setContextOpen] = useState(false)
  const actionsRef = useRef<HTMLButtonElement>(null)
  const focusFirstActionOnEntry = useRef(false)
  const returnFocusTarget = useRef<HTMLElement | null>(null)
  const { revealInFinder, openInTerminal } = useOpenFolder()
  const updateSettings = useUpdateSettings()

  const handleClick = (): void => {
    if (!agent.exists) return
    // Sidebar agent navigation always targets the installed-skills list, even
    // when the user is currently browsing Marketplace discovery.
    dispatch(setActiveTab('installed'))
    dispatch(selectAgent(isSelected ? null : agent.id))
  }

  const handleContextMenu = (
    event: React.SyntheticEvent<HTMLButtonElement>,
  ): void => {
    event.preventDefault()
    if (!agent.exists) return

    // Row shortcuts bypass the dropdown trigger, so restore their invoker on close.
    returnFocusTarget.current = event.currentTarget
    setContextOpen(true)
  }

  const handleContextKey = (
    event: React.KeyboardEvent<HTMLButtonElement>,
  ): void => {
    if (
      event.key === 'ContextMenu' ||
      (event.shiftKey && event.key === 'F10')
    ) {
      handleContextMenu(event)
    }
  }

  const handleMenuOpenChange = (
    open: boolean,
    activation?: 'click-only',
  ): void => {
    focusFirstActionOnEntry.current = open && activation === 'click-only'
    // The named Actions button opens on click or keyboard input and lets Radix restore its focus.
    if (open) returnFocusTarget.current = null
    setContextOpen(open)
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
    updateSettings({
      hiddenAgentIds: toggleArrayMember(hiddenAgentIds, agent.id),
    })
    setContextOpen(false)
  }

  const skillCountText = agent.exists
    ? buildSkillCountText(agent.skillCount, agent.localSkillCount)
    : null

  const tooltipPath = getAgentTooltipPath(agent.id)

  return (
    <div className="group/agent relative">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`Filter skills by ${agent.name}${skillCountText ? ` (${skillCountText})` : ''}`}
            aria-pressed={isSelected}
            aria-disabled={!agent.exists}
            className={cn(
              'flex w-full items-center gap-2 min-h-11 py-1.5 px-2 rounded-md transition-colors border-l-4 border-l-transparent text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
              agent.exists &&
                'cursor-pointer pr-9 group-hover/agent:bg-muted/50',
              isSelected && 'border-l-primary bg-primary/10',
            )}
            onClick={handleClick}
            onKeyDown={handleContextKey}
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
        </TooltipTrigger>
        {tooltipPath && (
          <TooltipContent side="right">
            <span>{tooltipPath}</span>
          </TooltipContent>
        )}
      </Tooltip>
      {agent.exists && (
        <DropdownMenu open={contextOpen} onOpenChange={handleMenuOpenChange}>
          <DropdownMenuTrigger
            ref={actionsRef}
            aria-label={`Actions for ${agent.name}`}
            className="absolute right-1 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:text-foreground"
            onClick={(event) => {
              // Radix handles pointerdown and keydown; assistive activation can send only a click.
              if (event.detail === 0)
                handleMenuOpenChange(!contextOpen, 'click-only')
            }}
            onKeyDown={handleContextKey}
            onContextMenu={handleContextMenu}
          >
            <MoreHorizontal aria-hidden="true" className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            onFocus={(event) => {
              // A click-only activation does not update Radix's last-input modality.
              if (
                !focusFirstActionOnEntry.current ||
                event.target !== event.currentTarget
              )
                return
              focusFirstActionOnEntry.current = false
              const firstAction =
                event.currentTarget.querySelector<HTMLElement>(
                  '[role="menuitem"]:not([aria-disabled="true"])',
                )
              if (firstAction) {
                event.preventDefault()
                firstAction.focus({ preventScroll: true })
              }
            }}
            onCloseAutoFocus={(event) => {
              const shortcutTarget = returnFocusTarget.current
              returnFocusTarget.current = null
              // Radix restores a mounted Actions trigger according to how the menu closed.
              if (!shortcutTarget && actionsRef.current?.isConnected) return

              // Settings or a rescan can remove the invoker while its menu is open.
              const target = shortcutTarget?.isConnected
                ? shortcutTarget
                : focusFallbackRef?.current
              if (target) {
                event.preventDefault()
                // A dialog or outside control may already have claimed focus.
                if (document.activeElement === document.body) target.focus()
              }
            }}
          >
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
      )}
    </div>
  )
}
