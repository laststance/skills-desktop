import type { Agent } from '../../../../shared/types'
import { cn } from '../../lib/utils'
import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import { selectAgent } from '../../redux/slices/uiSlice'

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
 * Clicking filters skills list to show only skills installed for this agent
 * Shows "N linked, M local" skill counts
 */
export function AgentItem({ agent }: AgentItemProps): React.ReactElement {
  const dispatch = useAppDispatch()
  const { selectedAgentId } = useAppSelector((state) => state.ui)
  const isSelected = selectedAgentId === agent.id

  const handleClick = (): void => {
    if (!agent.exists) return
    // Toggle selection: if already selected, deselect (show all)
    dispatch(selectAgent(isSelected ? null : agent.id))
  }

  const skillCountText = agent.exists
    ? buildSkillCountText(agent.skillCount, agent.localSkillCount)
    : null

  return (
    <div
      className={cn(
        'flex items-center justify-between py-1.5 px-2 rounded-md transition-colors',
        agent.exists && 'cursor-pointer hover:bg-muted/50',
        isSelected && 'bg-primary/10 border border-primary/30',
      )}
      onClick={handleClick}
    >
      <span className="text-sm truncate">{agent.name}</span>
      {skillCountText && (
        <span className="text-xs text-muted-foreground whitespace-nowrap ml-2">
          {skillCountText}
        </span>
      )}
    </div>
  )
}
