import { Eye, EyeOff } from 'lucide-react'
import React, { useEffect } from 'react'

import { Button } from '@/renderer/src/components/ui/button'
import { Checkbox } from '@/renderer/src/components/ui/checkbox'
import { useUpdateSettings } from '@/renderer/src/hooks/useUpdateSettings'
import { cn, toggleArrayMember } from '@/renderer/src/lib/utils'
import { useAppDispatch, useAppSelector } from '@/renderer/src/redux/hooks'
import { fetchAgents } from '@/renderer/src/redux/slices/agentsSlice'
import { selectHiddenAgentIds } from '@/renderer/src/redux/slices/settingsSlice'
import type { Agent, AgentId } from '@/shared/types'

import { SectionFrame } from './SectionFrame'

/**
 * Settings → Agents pane.
 *
 * Lets the user pick which installed agents are shown in the main
 * sidebar. The persisted shape is `Settings.hiddenAgentIds` (the small
 * common-case set), but the UI inverts to "Show in sidebar" — checked
 * means visible — because that matches the mental model better than a
 * double-negative "uncheck to hide".
 *
 * Important: this is a pure visibility toggle. The agent's skills
 * folder, symlinks, and Marketplace presence are unaffected — the
 * user can flip an agent back on at any time and the sidebar entry
 * (with all its counts and right-click actions) reappears intact.
 *
 * Sync flow on every toggle:
 *  1. `useUpdateSettings` does the optimistic local dispatch +
 *     `settings:set` IPC.
 *  2. Main writes `settings.json` atomically and broadcasts
 *     `settings:changed` to every window — `useSettingsSync` in the
 *     main window receives it and re-renders the sidebar.
 *
 * Settings can open before the main window has finished scanning, so
 * we re-fire `fetchAgents` on mount when the slice is empty. Idempotent
 * with the main window's mount-time fetch.
 */
export const Agents = React.memo(function Agents(): React.ReactElement {
  const dispatch = useAppDispatch()
  const { items: agents, loading } = useAppSelector((state) => state.agents)
  const hiddenAgentIds = useAppSelector(selectHiddenAgentIds)
  const updateSettings = useUpdateSettings()

  useEffect(() => {
    if (agents.length === 0) {
      dispatch(fetchAgents())
    }
  }, [dispatch, agents.length])

  const installed = agents.filter((a) => a.exists)
  const notInstalled = agents.filter((a) => !a.exists)
  const visibleCount = installed.filter(
    (a) => !hiddenAgentIds.includes(a.id),
  ).length
  const hiddenCount = installed.length - visibleCount

  const handleToggle = (agentId: AgentId): void => {
    // Inversion: "Show in sidebar" checkbox flip ⇄ membership in
    // hiddenAgentIds. We treat every click as a toggle relative to the
    // latest known state instead of trusting the next-state from the
    // checkbox event — the schema upstream already pins membership, so
    // either side of the flip lands on the correct array.
    updateSettings({
      hiddenAgentIds: toggleArrayMember(hiddenAgentIds, agentId),
    })
  }

  const handleShowAll = (): void => {
    updateSettings({ hiddenAgentIds: [] })
  }

  return (
    <SectionFrame
      title="Agents"
      description="Choose which agents appear in the main window sidebar. Hiding an agent here doesn't uninstall it — skills and symlinks are unaffected."
    >
      {loading && installed.length === 0 ? (
        <p className="text-sm text-muted-foreground">Loading agents…</p>
      ) : installed.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No agents detected on this machine yet.
        </p>
      ) : (
        <>
          <div className="flex items-center justify-between" aria-live="polite">
            <p className="text-xs text-muted-foreground tabular-nums">
              {visibleCount} visible · {hiddenCount} hidden
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleShowAll}
              disabled={hiddenCount === 0}
            >
              <Eye className="h-3.5 w-3.5 mr-1.5" />
              Show all
            </Button>
          </div>

          <ul
            className="flex flex-col gap-1 rounded-md border border-border bg-card/30 p-2"
            aria-label="Installed agents"
          >
            {installed.map((agent) => (
              <AgentToggleRow
                key={agent.id}
                agent={agent}
                isVisible={!hiddenAgentIds.includes(agent.id)}
                onToggle={handleToggle}
              />
            ))}
          </ul>

          {notInstalled.length > 0 && (
            <details className="mt-1">
              <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground select-none">
                {notInstalled.length} not installed
              </summary>
              <ul
                className="mt-2 flex flex-col gap-1 rounded-md border border-border bg-card/30 p-2"
                aria-label="Not-installed agents"
              >
                {notInstalled.map((agent) => (
                  <li
                    key={agent.id}
                    className="flex items-center gap-3 px-2 py-1.5"
                  >
                    {/* Disabled — there's nothing for the user to hide */}
                    {/* when the agent isn't installed in the first place. */}
                    <Checkbox
                      checked={false}
                      disabled
                      aria-label={`${agent.name} (not installed)`}
                    />
                    <span className="text-sm text-muted-foreground">
                      {agent.name}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </SectionFrame>
  )
})

interface AgentToggleRowProps {
  agent: Agent
  isVisible: boolean
  onToggle: (agentId: AgentId) => void
}

const AgentToggleRow = React.memo(function AgentToggleRow({
  agent,
  isVisible,
  onToggle,
}: AgentToggleRowProps): React.ReactElement {
  const checkboxId = `agent-visibility-${agent.id}`
  return (
    <li className="flex items-center gap-3 px-2 py-1.5 rounded hover:bg-muted/30">
      <Checkbox
        id={checkboxId}
        checked={isVisible}
        onCheckedChange={(next) => {
          // Radix passes `boolean | "indeterminate"`. Ignore the indeterminate
          // case — we never set it, but treating it like a flip would dispatch
          // a phantom hide/show.
          if (typeof next === 'boolean') onToggle(agent.id)
        }}
        aria-label={`Show ${agent.name} in sidebar`}
      />
      <label
        htmlFor={checkboxId}
        className="flex-1 flex items-center justify-between cursor-pointer text-sm"
      >
        <span className={cn(!isVisible && 'text-muted-foreground')}>
          {agent.name}
        </span>
        {!isVisible && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <EyeOff className="h-3 w-3" />
            Hidden
          </span>
        )}
      </label>
    </li>
  )
})
