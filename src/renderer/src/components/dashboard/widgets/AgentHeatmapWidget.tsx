import React, { useMemo } from 'react'

import type {
  Agent,
  Skill,
  SymlinkInfo,
  SymlinkStatus,
} from '../../../../../shared/types'
import { useAppSelector } from '../../../redux/hooks'
import { selectAgentItems } from '../../../redux/slices/agentsSlice'
import { selectSkillsItems } from '../../../redux/slices/skillsSlice'

// ----------------------------------------------------------------------------
// Tunables
// ----------------------------------------------------------------------------

/**
 * Cap on how many skills appear as rows. Keeps the matrix legible inside a
 * dashboard widget — users with hundreds of skills only see the most-linked
 * ones, which is the interesting signal anyway.
 */
const MAX_SKILL_ROWS = 20

/**
 * Precomputed map of status → Tailwind fill class. Using a map (vs a switch
 * inside render) means the JSX stays flat and the mapping is in one spot.
 */
const STATUS_FILL: Record<SymlinkStatus, string> = {
  valid: 'bg-success',
  broken: 'bg-amber-400',
  missing: 'bg-muted',
}

// ----------------------------------------------------------------------------
// Pure helpers
// ----------------------------------------------------------------------------

/**
 * Build a stable lookup of (skillName, agentId) → SymlinkInfo so each cell
 * can resolve its status in O(1) instead of re-scanning `skill.symlinks` per
 * render pass. The key combines skill + agent because the same skill can
 * appear in many agents and the same agent can appear in many skills.
 * @example key("tdd-workflow", "cursor") // => "tdd-workflow|cursor"
 */
function buildSymlinkIndex(skills: readonly Skill[]): Map<string, SymlinkInfo> {
  const index = new Map<string, SymlinkInfo>()
  for (const skill of skills) {
    for (const link of skill.symlinks) {
      index.set(`${skill.name}|${link.agentId}`, link)
    }
  }
  return index
}

/**
 * Abbreviate an agent name for the column header. We show two letters so the
 * heatmap stays narrow enough that 6–10 agents fit without horizontal scroll.
 * "Claude Code" → "CC", "Cursor" → "Cu", "Codex" → "Co".
 * @param name - Full agent display name
 * @returns Two-letter abbreviation, uppercased
 * @example abbreviateAgentName("Claude Code") // => "CC"
 * @example abbreviateAgentName("Cursor")       // => "Cu"
 */
function abbreviateAgentName(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase()
  }
  const single = parts[0] ?? ''
  return (single.slice(0, 2) || '?').toUpperCase()
}

// ----------------------------------------------------------------------------
// HeatmapCell — one colored square. Memoized because the matrix can have
// hundreds of cells and react-grid-layout re-renders the widget on every
// drag frame.
// ----------------------------------------------------------------------------

interface HeatmapCellProps {
  skillName: string
  agentName: string
  link: SymlinkInfo | undefined
}

const HeatmapCell = React.memo(function HeatmapCell({
  skillName,
  agentName,
  link,
}: HeatmapCellProps): React.ReactElement {
  // No explicit symlink entry == the skill isn't known to this agent at all.
  const status: SymlinkStatus = link?.status ?? 'missing'
  const fillClass = link?.isLocal ? 'bg-emerald-400' : STATUS_FILL[status]
  const label = link?.isLocal
    ? `${skillName} — local to ${agentName}`
    : `${skillName} — ${status} in ${agentName}`

  return (
    <div
      role="img"
      aria-label={label}
      title={label}
      className={`h-3.5 w-3.5 rounded-sm ${fillClass}`}
    />
  )
})

// ----------------------------------------------------------------------------
// HeatmapRow — one skill row: truncated name + cells across all installed
// agents.
// ----------------------------------------------------------------------------

interface HeatmapRowProps {
  skillName: string
  agents: readonly Agent[]
  symlinkIndex: Map<string, SymlinkInfo>
}

const HeatmapRow = React.memo(function HeatmapRow({
  skillName,
  agents,
  symlinkIndex,
}: HeatmapRowProps): React.ReactElement {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-2 py-0.5">
      <span className="truncate text-[11px] font-mono text-muted-foreground">
        {skillName}
      </span>
      <div className="flex items-center gap-1">
        {agents.map((agent) => (
          <HeatmapCell
            key={agent.id}
            skillName={skillName}
            agentName={agent.name}
            link={symlinkIndex.get(`${skillName}|${agent.id}`)}
          />
        ))}
      </div>
    </div>
  )
})

// ----------------------------------------------------------------------------
// Widget body
// ----------------------------------------------------------------------------

/**
 * Agent Heatmap widget body (experimental).
 *
 * Matrix of skills (rows) × installed agents (columns) colored by symlink
 * status: cyan = valid link, amber = broken, emerald = local, muted = not
 * linked. Complements `CoverageWidget` — Coverage answers "how much of the
 * pool does each agent cover?" while Heatmap answers "which agents claim
 * which specific skills?".
 *
 * Gated behind `FEATURE_FLAGS.ENABLE_DASHBOARD_EXPERIMENTAL` via the registry.
 */
export const AgentHeatmapWidget = React.memo(
  function AgentHeatmapWidget(): React.ReactElement {
    const skills = useAppSelector(selectSkillsItems)
    const agents = useAppSelector(selectAgentItems)

    // Only agents with an on-disk skills dir contribute meaningful columns.
    // Not-installed agents would always be "missing" — pure noise.
    const installedAgents = useMemo(
      () => agents.filter((agent) => agent.exists),
      [agents],
    )

    // Highest-linked skills first — this is the "hot zone" users care about.
    // Capped at MAX_SKILL_ROWS so the matrix stays compact.
    const topSkills = useMemo(() => {
      const byCoverage = [...skills].sort(
        (skillA, skillB) => skillB.symlinkCount - skillA.symlinkCount,
      )
      return byCoverage.slice(0, MAX_SKILL_ROWS)
    }, [skills])

    const symlinkIndex = useMemo(
      () => buildSymlinkIndex(topSkills),
      [topSkills],
    )

    if (installedAgents.length === 0 || topSkills.length === 0) {
      return (
        <div className="h-full w-full flex items-center justify-center text-xs text-muted-foreground">
          Not enough data for a heatmap yet
        </div>
      )
    }

    return (
      <div className="h-full w-full flex flex-col overflow-hidden py-1">
        {/* Agent column headers — sticky so they stay visible while the row list scrolls */}
        <div
          className="
          grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-2 py-1
          text-[10px] font-mono uppercase tracking-wide
          text-muted-foreground border-b border-border/60
        "
        >
          <span>skill</span>
          <div className="flex items-center gap-1">
            {installedAgents.map((agent) => (
              <span
                key={agent.id}
                title={agent.name}
                className="h-3.5 w-3.5 inline-flex items-center justify-center"
              >
                {abbreviateAgentName(agent.name)}
              </span>
            ))}
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {topSkills.map((skill) => (
            <HeatmapRow
              key={skill.name}
              skillName={skill.name}
              agents={installedAgents}
              symlinkIndex={symlinkIndex}
            />
          ))}
        </div>
      </div>
    )
  },
)
