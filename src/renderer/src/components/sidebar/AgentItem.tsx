import { Trash2 } from 'lucide-react'
import { useState } from 'react'

import { AGENT_DEFINITIONS } from '../../../../shared/constants'
import type { Agent } from '../../../../shared/types'
import { cn } from '../../lib/utils'
import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import { setAgentToDelete } from '../../redux/slices/agentsSlice'
import { selectAgent } from '../../redux/slices/uiSlice'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

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
 * @param agentId - Agent ID to look up
 * @returns "~/.claude/skills/" style path, or undefined if not found
 * @example
 * getAgentTooltipPath('claude-code') // => "~/.claude/skills/"
 * getAgentTooltipPath('cursor')      // => "~/.cursor/skills/"
 */
function getAgentTooltipPath(agentId: string): string | undefined {
  const def = AGENT_DEFINITIONS.find((d) => d.id === agentId)
  return def ? `~/${def.dir}/skills/` : undefined
}

/**
 * Single agent item in the sidebar
 * Left-click filters skills list. Right-click opens context menu for delete.
 * Shows "N linked, M local" skill counts.
 * Hover tooltip displays the agent's skills folder path.
 */
export function AgentItem({ agent }: AgentItemProps): React.ReactElement {
  const dispatch = useAppDispatch()
  const { selectedAgentId } = useAppSelector((state) => state.ui)
  const isSelected = selectedAgentId === agent.id
  const [contextOpen, setContextOpen] = useState(false)

  const handleClick = (): void => {
    if (!agent.exists) return
    dispatch(selectAgent(isSelected ? null : agent.id))
  }

  const handleContextMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    if (!agent.exists) return
    setContextOpen(true)
  }

  const handleDelete = (): void => {
    dispatch(setAgentToDelete(agent))
    setContextOpen(false)
  }

  const skillCountText = agent.exists
    ? buildSkillCountText(agent.skillCount, agent.localSkillCount)
    : null

  const tooltipPath = getAgentTooltipPath(agent.id)

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
            <div
              className={cn(
                'flex items-center justify-between py-1.5 px-2 rounded-md transition-colors border-l-4 border-l-transparent',
                agent.exists && 'cursor-pointer hover:bg-muted/50',
                isSelected && 'border-l-primary bg-primary/10',
              )}
              onClick={handleClick}
              onContextMenu={handleContextMenu}
            >
              <span className="text-sm truncate">{agent.name}</span>
              {skillCountText && (
                <span className="text-xs text-muted-foreground whitespace-nowrap ml-2">
                  {skillCountText}
                </span>
              )}
            </div>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <DropdownMenuContent>
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
          <span className="text-muted-foreground">{tooltipPath}</span>
        </TooltipContent>
      )}
    </Tooltip>
  )
}
