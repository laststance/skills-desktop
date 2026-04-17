import { FolderDot, Link2 } from 'lucide-react'
import React, { useMemo } from 'react'

import type { Agent } from '../../../../../shared/types'
import { useAppDispatch, useAppSelector } from '../../../redux/hooks'
import { selectAgentItems } from '../../../redux/slices/agentsSlice'
import { selectSkillsItems } from '../../../redux/slices/skillsSlice'
import { selectAgent } from '../../../redux/slices/uiSlice'

// ----------------------------------------------------------------------------
// Pure helpers
// ----------------------------------------------------------------------------

interface CoverageRow {
  agent: Agent
  /** Total = symlinked + local — what shows up in that agent's skills dir. */
  total: number
  /** Symlinked-from-source count (already on `agent.skillCount`). */
  linked: number
  /** Locally-created skills in that agent's directory. */
  local: number
  /** `total / totalSkillsInSource` as 0..1, clamped to 1. */
  ratio: number
}

/**
 * Build one coverage row per agent.
 *
 * `ratio` compares each agent's skill count against the **source directory**
 * size (`~/.agents/skills`). An agent with 8/10 skills shows an 80% fill
 * bar — a quick visual "how covered are you" cue. When source is empty,
 * ratio is 0 so the bar stays at 0 rather than divide-by-zero.
 *
 * @param agents - discovered agents
 * @param totalSourceSkills - size of the shared `.agents/skills` pool
 * @returns one row per agent, unsorted (already in definition order)
 */
function buildCoverageRows(
  agents: readonly Agent[],
  totalSourceSkills: number,
): CoverageRow[] {
  return agents.map((agent) => {
    const total = agent.skillCount + agent.localSkillCount
    const ratio =
      totalSourceSkills > 0
        ? Math.min(1, agent.skillCount / totalSourceSkills)
        : 0
    return {
      agent,
      total,
      linked: agent.skillCount,
      local: agent.localSkillCount,
      ratio,
    }
  })
}

// ----------------------------------------------------------------------------
// CoverageRow — a single agent row. Clicking it selects that agent in the
// main list (same interaction as the sidebar AgentsSection).
// ----------------------------------------------------------------------------

interface CoverageRowViewProps {
  row: CoverageRow
  onSelect: (agentId: Agent['id']) => void
}

const CoverageRowView = React.memo(function CoverageRowView({
  row,
  onSelect,
}: CoverageRowViewProps): React.ReactElement {
  const { agent, total, linked, local, ratio } = row
  const ratioPct = Math.round(ratio * 100)

  return (
    <button
      type="button"
      onClick={() => onSelect(agent.id)}
      disabled={!agent.exists}
      className="
        group w-full grid grid-cols-[1fr_auto] items-center gap-2 px-3 py-1.5
        rounded-md text-left text-xs
        hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
      "
      aria-label={`${agent.name}: ${linked} linked, ${local} local`}
    >
      <div className="min-w-0 flex flex-col gap-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="truncate font-medium text-foreground">
            {agent.name}
          </span>
          {!agent.exists && (
            <span className="text-[10px] text-muted-foreground uppercase tracking-wide shrink-0">
              not installed
            </span>
          )}
        </div>
        {agent.exists && (
          <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-cyan-400/70 transition-[width] duration-300"
              style={{ width: `${ratioPct}%` }}
              aria-hidden="true"
            />
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 text-[11px] shrink-0 tabular-nums">
        {linked > 0 && (
          <span className="inline-flex items-center gap-0.5 text-cyan-400">
            <Link2 className="h-3 w-3" aria-hidden="true" />
            {linked}
          </span>
        )}
        {local > 0 && (
          <span className="inline-flex items-center gap-0.5 text-emerald-400">
            <FolderDot className="h-3 w-3" aria-hidden="true" />
            {local}
          </span>
        )}
        {total === 0 && agent.exists && (
          <span className="text-muted-foreground">0</span>
        )}
      </div>
    </button>
  )
})

/**
 * Agent Coverage widget body.
 *
 * Shows a compact row per agent with a fill bar proportional to how many
 * source skills they've linked. Clicking a row filters the main skill list
 * to that agent (reuses the same selection state as the sidebar).
 */
export const CoverageWidget = React.memo(
  function CoverageWidget(): React.ReactElement {
    const dispatch = useAppDispatch()
    const agents = useAppSelector(selectAgentItems)
    const skills = useAppSelector(selectSkillsItems)

    const rows = useMemo(
      () => buildCoverageRows(agents, skills.length),
      [agents, skills.length],
    )

    const handleSelect = (agentId: Agent['id']): void => {
      dispatch(selectAgent(agentId))
    }

    if (agents.length === 0) {
      return (
        <div className="h-full w-full flex items-center justify-center text-xs text-muted-foreground">
          No agents discovered yet
        </div>
      )
    }

    return (
      <div className="h-full w-full overflow-y-auto py-2">
        <div className="flex flex-col gap-0.5">
          {rows.map((row) => (
            <CoverageRowView
              key={row.agent.id}
              row={row}
              onSelect={handleSelect}
            />
          ))}
        </div>
      </div>
    )
  },
)
