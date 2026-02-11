import { Trash2 } from 'lucide-react'
import { useState } from 'react'

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
 * Single agent item in the sidebar
 * Left-click filters skills list. Right-click opens context menu for delete.
 * Shows "N linked, M local" skill counts
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
    if (!agent.exists || agent.skillCount === 0) return
    setContextOpen(true)
  }

  const handleDelete = (): void => {
    dispatch(setAgentToDelete(agent))
    setContextOpen(false)
  }

  const skillCountText = agent.exists
    ? buildSkillCountText(agent.skillCount, agent.localSkillCount)
    : null

  return (
    <DropdownMenu open={contextOpen} onOpenChange={setContextOpen}>
      <DropdownMenuTrigger asChild>
        <div
          className={cn(
            'flex items-center justify-between py-1.5 px-2 rounded-md transition-colors',
            agent.exists && 'cursor-pointer hover:bg-muted/50',
            isSelected && 'bg-primary/10 border border-primary/30',
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
      <DropdownMenuContent>
        <DropdownMenuItem
          onClick={handleDelete}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="h-4 w-4 mr-2" />
          Remove all symlinks
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
