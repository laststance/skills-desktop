import React, { useEffect } from 'react'

import { useAppDispatch, useAppSelector } from '@/renderer/src/redux/hooks'
import { fetchAgents } from '@/renderer/src/redux/slices/agentsSlice'
import { selectHiddenAgentIds } from '@/renderer/src/redux/slices/settingsSlice'

import { AgentItem } from './AgentItem'

/**
 * Sidebar section listing detected AI agents.
 *
 * Three-way partition over `agents`:
 * - **visibleInstalled** — installed *and* not hidden via settings. Primary list.
 * - **hiddenInstalled** — installed but the user has chosen to hide them
 *   from the sidebar. Rendered inside a `<details>` disclosure so the user
 *   can expand to see / restore them without leaving the sidebar.
 * - **missingAgents** — not installed on this machine. Rendered inside
 *   the existing "N not installed" disclosure (greyed out).
 *
 * The stale-selection invariant (clear `selectedAgentId` when its agent
 * gets hidden) lives in `redux/listener.ts` so it fires regardless of
 * whether this component is mounted.
 */
export const AgentsSection = React.memo(
  function AgentsSection(): React.ReactElement {
    const dispatch = useAppDispatch()
    const { items: agents, loading } = useAppSelector((state) => state.agents)
    const hiddenAgentIds = useAppSelector(selectHiddenAgentIds)

    useEffect(() => {
      dispatch(fetchAgents())
    }, [dispatch])

    const visibleInstalled = agents.filter(
      (a) => a.exists && !hiddenAgentIds.includes(a.id),
    )
    const hiddenInstalled = agents.filter(
      (a) => a.exists && hiddenAgentIds.includes(a.id),
    )
    const missingAgents = agents.filter((a) => !a.exists)
    const totalInstalled = visibleInstalled.length + hiddenInstalled.length

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
            ({visibleInstalled.length})
          </span>
        </div>

        {totalInstalled === 0 ? (
          <div className="text-xs text-muted-foreground py-2">
            No agents detected
          </div>
        ) : visibleInstalled.length === 0 ? (
          // Distinct from "No agents detected": the user has installed
          // agents but hidden every one of them. Point them back at the
          // place they can fix it.
          <div className="text-xs text-muted-foreground py-2 leading-relaxed">
            All installed agents are hidden.
            <br />
            Open Settings → Agents to show some.
          </div>
        ) : (
          <div className="space-y-1">
            {visibleInstalled.map((agent) => (
              <AgentItem key={agent.id} agent={agent} />
            ))}
          </div>
        )}

        {hiddenInstalled.length > 0 && (
          <details className="mt-4">
            <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
              {hiddenInstalled.length} hidden
            </summary>
            <div className="mt-2 space-y-1 opacity-50">
              {hiddenInstalled.map((agent) => (
                <AgentItem key={agent.id} agent={agent} />
              ))}
            </div>
          </details>
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
  },
)
