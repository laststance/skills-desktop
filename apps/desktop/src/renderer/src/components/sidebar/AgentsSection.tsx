import React, { useRef } from 'react'

import { useInitialEffect } from '@/renderer/src/hooks/useInitialEffect'
import { useAppDispatch, useAppSelector } from '@/renderer/src/redux/hooks'
import { fetchAgents } from '@/renderer/src/redux/slices/agentsSlice'
import { selectHiddenAgentIds } from '@/renderer/src/redux/slices/settingsSlice'
import { getHiddenAgentsLabel } from '@/renderer/src/utils/getHiddenAgentsLabel'

import { AgentFoldersMenu } from './AgentFoldersMenu'
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
export const AgentsSection = function AgentsSection(): React.ReactElement {
  const dispatch = useAppDispatch()
  const headingRef = useRef<HTMLSpanElement>(null)
  const { items: agents, loading } = useAppSelector((state) => state.agents)
  const hiddenAgentIds = useAppSelector(selectHiddenAgentIds)

  useInitialEffect(() => {
    dispatch(fetchAgents())
  })

  const visibleInstalled = agents.filter(
    (a) => a.exists && !hiddenAgentIds.includes(a.id),
  )
  const hiddenInstalled = agents.filter(
    (a) => a.exists && hiddenAgentIds.includes(a.id),
  )
  const missingAgents = agents.filter((a) => !a.exists)
  const totalInstalled = visibleInstalled.length + hiddenInstalled.length
  const hiddenAgentsLabel = getHiddenAgentsLabel(hiddenInstalled.length)

  if (loading && agents.length === 0) {
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
        <span
          ref={headingRef}
          tabIndex={-1}
          className="text-xs font-medium uppercase tracking-wider text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
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

      <div className="relative">
        {hiddenAgentsLabel && (
          <details className="mt-4">
            <summary className="min-h-6 mr-7 content-center rounded-md text-xs text-muted-foreground cursor-pointer hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
              {hiddenAgentsLabel}
            </summary>
            <div className="mt-2 space-y-1">
              {hiddenInstalled.map((agent) => (
                <AgentItem key={agent.id} agent={agent} />
              ))}
            </div>
          </details>
        )}
        {/* A sibling trigger keeps menu clicks independent of the disclosure. */}
        <AgentFoldersMenu
          agents={hiddenInstalled}
          focusFallbackRef={headingRef}
        />
      </div>

      <div className="relative">
        {missingAgents.length > 0 && (
          <details className="mt-4">
            <summary className="min-h-6 mr-7 content-center rounded-md text-xs text-muted-foreground cursor-pointer hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
              {missingAgents.length} not installed
            </summary>
            <div className="mt-2 space-y-1 opacity-50">
              {missingAgents.map((agent) => (
                <AgentItem key={agent.id} agent={agent} />
              ))}
            </div>
          </details>
        )}
        <AgentFoldersMenu
          agents={missingAgents}
          group="unused"
          focusFallbackRef={headingRef}
        />
      </div>
    </div>
  )
}
