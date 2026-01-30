import { useEffect } from 'react'

import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import { fetchAgents } from '../../redux/slices/agentsSlice'

import { AgentItem } from './AgentItem'

/**
 * Agents section showing list of detected AI agents
 */
export function AgentsSection(): React.ReactElement {
  const dispatch = useAppDispatch()
  const { items: agents, loading } = useAppSelector((state) => state.agents)

  useEffect(() => {
    dispatch(fetchAgents())
  }, [dispatch])

  const existingAgents = agents.filter((a) => a.exists)
  const missingAgents = agents.filter((a) => !a.exists)

  if (loading) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Agents
          </span>
        </div>
        <div className="text-xs text-muted-foreground">Loading...</div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Agents
        </span>
        <span className="text-xs text-muted-foreground">
          ({existingAgents.length})
        </span>
      </div>

      {existingAgents.length === 0 ? (
        <div className="text-xs text-muted-foreground py-2">
          No agents detected
        </div>
      ) : (
        <div className="space-y-1">
          {existingAgents.map((agent) => (
            <AgentItem key={agent.id} agent={agent} />
          ))}
        </div>
      )}

      {missingAgents.length > 0 && (
        <details className="mt-4">
          <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
            {missingAgents.length} not installed
          </summary>
          <div className="mt-2 space-y-1 opacity-50">
            {missingAgents.map((agent) => (
              <AgentItem key={agent.id} agent={agent} />
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
