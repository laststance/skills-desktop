import type { Agent } from '../../../../shared/types'
import { cn } from '../../lib/utils'
import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import { selectAgent } from '../../redux/slices/uiSlice'
import { Badge } from '../ui/badge'

interface AgentItemProps {
  agent: Agent
}

/**
 * Single agent item in the sidebar
 * Clicking filters skills list to show only skills installed for this agent
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
      {agent.exists && agent.skillCount > 0 && (
        <Badge variant="secondary" className="text-xs">
          {agent.skillCount}
        </Badge>
      )}
    </div>
  )
}
