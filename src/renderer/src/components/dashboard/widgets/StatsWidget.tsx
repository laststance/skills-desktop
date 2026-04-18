import { BarChart3, Link2, Users } from 'lucide-react'
import React, { useMemo } from 'react'

import { useAppSelector } from '../../../redux/hooks'
import { selectAgentItems } from '../../../redux/slices/agentsSlice'
import { selectSkillsItems } from '../../../redux/slices/skillsSlice'

// ----------------------------------------------------------------------------
// Pure helpers — derived outside the component so they're trivially testable
// and so the component body stays declarative.
// ----------------------------------------------------------------------------

/**
 * Count skills that have at least one valid symlink.
 * `symlinkCount` is populated by main process and already excludes broken/missing.
 * @returns linked skill count
 * @example countLinkedSkills([{symlinkCount: 2}, {symlinkCount: 0}]) // => 1
 */
function countLinkedSkills(
  items: ReadonlyArray<{ symlinkCount: number }>,
): number {
  return items.filter((skill) => skill.symlinkCount > 0).length
}

/**
 * Count agents whose skills directory actually exists on disk.
 * `exists: false` means the user never created a `~/.<agent>/skills` folder,
 * so it's not a meaningful participant.
 * @returns active agent count
 * @example countActiveAgents([{exists: true}, {exists: false}]) // => 1
 */
function countActiveAgents(items: ReadonlyArray<{ exists: boolean }>): number {
  return items.filter((agent) => agent.exists).length
}

// ----------------------------------------------------------------------------
// Tile — a single stat cell. Extracted because all three rows share this
// layout; keeping it inline would duplicate the icon+number+label markup.
// ----------------------------------------------------------------------------

interface StatTileProps {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: number
  /** Tailwind color class for the number + icon (e.g., `text-success`). */
  accentClass: string
}

const StatTile = React.memo(function StatTile({
  icon: Icon,
  label,
  value,
  accentClass,
}: StatTileProps): React.ReactElement {
  return (
    <div className="flex-1 min-w-0 flex flex-col items-center justify-center gap-1 px-2">
      <Icon className={`h-4 w-4 ${accentClass}`} aria-hidden="true" />
      <span className={`text-2xl font-semibold tabular-nums ${accentClass}`}>
        {value}
      </span>
      <span className="text-[11px] text-muted-foreground uppercase tracking-wide">
        {label}
      </span>
    </div>
  )
})

/**
 * Skill Stats widget body.
 *
 * Shows three counters at a glance: total skills, linked skills, and
 * active agents. Reads from Redux directly — the dashboard canvas re-renders
 * only when these derived numbers change because `useAppSelector` uses ===
 * equality on primitive returns.
 */
export const StatsWidget = React.memo(
  function StatsWidget(): React.ReactElement {
    const skills = useAppSelector(selectSkillsItems)
    const agents = useAppSelector(selectAgentItems)

    const totalSkills = skills.length
    const linkedSkills = useMemo(() => countLinkedSkills(skills), [skills])
    const activeAgents = useMemo(() => countActiveAgents(agents), [agents])

    return (
      <div className="h-full w-full flex items-stretch">
        <StatTile
          icon={BarChart3}
          label="Skills"
          value={totalSkills}
          accentClass="text-foreground"
        />
        <div className="w-px bg-border" aria-hidden="true" />
        <StatTile
          icon={Link2}
          label="Linked"
          value={linkedSkills}
          accentClass="text-success"
        />
        <div className="w-px bg-border" aria-hidden="true" />
        <StatTile
          icon={Users}
          label="Agents"
          value={activeAgents}
          accentClass="text-emerald-400"
        />
      </div>
    )
  },
)
