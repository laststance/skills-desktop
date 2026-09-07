import { BarChart3, Link2, Users } from 'lucide-react'
import React from 'react'

import { useAppSelector } from '@/renderer/src/redux/hooks'
import { selectAgentItems } from '@/renderer/src/redux/slices/agentsSlice'
import { selectSkillsItems } from '@/renderer/src/redux/slices/skillsSlice'
import type { AgentCount, SkillCount } from '@/shared/types'

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
): SkillCount {
  return items.filter((skill) => skill.symlinkCount > 0).length
}

/**
 * Count agents whose skills directory actually exists on disk.
 * `exists: false` means the user never created a `~/.<agent>/skills` folder,
 * so it's not a meaningful participant.
 * @returns active agent count
 * @example countActiveAgents([{exists: true}, {exists: false}]) // => 1
 */
function countActiveAgents(
  items: ReadonlyArray<{ exists: boolean }>,
): AgentCount {
  return items.filter((agent) => agent.exists).length
}

// ----------------------------------------------------------------------------
// Tile — a single stat cell. Extracted because all three rows share this
// layout; keeping it inline would duplicate the icon+number+label markup.
//
// Two forms, switched by the container query in {@link StatsWidget}:
//   - wide  (>= 12rem): icon over number over label, three tiles side by side
//   - narrow (< 12rem): icon + number + label on one line, three tiles stacked
//
// The narrow form exists because the widget lives in a resizable
// `react-grid-layout` cell inside a resizable panel: at an 800px window with
// the default `w: 3` size it is only 112px wide, which leaves 36px per tile
// while the number alone renders 46px. The stacked-tile form overflowed into
// its neighbours and rendered "227" "222" "50" as an unreadable "22250" —
// the one thing DESIGN.md's responsive section forbids outright ("Text must
// not overlap icons, counters, badges, or adjacent actions").
// ----------------------------------------------------------------------------

interface StatTileProps {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: number
  /** Tailwind color class for the number + icon (e.g., `text-success`). */
  accentClass: string
}

const StatTile = function StatTile({
  icon: Icon,
  label,
  value,
  accentClass,
}: StatTileProps): React.ReactElement {
  return (
    // `overflow-hidden` is the hard guarantee behind the container query: even
    // at a width no breakpoint anticipated, content clips at the tile edge
    // instead of spilling onto the neighbouring stat.
    <div className="flex-1 min-w-0 overflow-hidden flex items-center gap-1.5 @min-[12rem]:flex-col @min-[12rem]:justify-center @min-[12rem]:gap-1 @min-[12rem]:px-2">
      <Icon
        className={`h-3.5 w-3.5 shrink-0 @min-[12rem]:h-4 @min-[12rem]:w-4 ${accentClass}`}
        aria-hidden="true"
      />
      <span
        className={`text-base font-semibold tabular-nums @min-[12rem]:text-2xl ${accentClass}`}
      >
        {value}
      </span>
      <span className="text-[11px] text-muted-foreground uppercase tracking-wide truncate">
        {label}
      </span>
    </div>
  )
}

/**
 * Skill Stats widget body.
 *
 * Shows three counters at a glance: total skills, linked skills, and
 * active agents. Reads from Redux directly — the dashboard canvas re-renders
 * only when these derived numbers change because `useAppSelector` uses ===
 * equality on primitive returns.
 */
export const StatsWidget = function StatsWidget(): React.ReactElement {
  const skills = useAppSelector(selectSkillsItems)
  const agents = useAppSelector(selectAgentItems)

  const totalSkills = skills.length
  const linkedSkills = countLinkedSkills(skills)
  const activeAgents = countActiveAgents(agents)

  return (
    // `@container` (not a viewport breakpoint) because the widget is resizable
    // in the grid *and* sits in a resizable panel, so its width is decoupled
    // from `innerWidth` — an 800px window can hold this widget at 112px or
    // 238px depending only on the user's own layout.
    //
    // 12rem = 192px is the measured floor for the side-by-side form: three
    // tiles need 46px for the number plus 16px of `px-2`, so 3 x 62px plus the
    // two 1px dividers = 188px.
    <div className="@container h-full w-full">
      <div className="h-full w-full flex flex-col justify-center gap-1 px-1 @min-[12rem]:flex-row @min-[12rem]:gap-0 @min-[12rem]:px-0">
        <StatTile
          icon={BarChart3}
          label="Skills"
          value={totalSkills}
          accentClass="text-foreground"
        />

        {/* Dividers only separate side-by-side tiles; stacked rows read as a
            list and a rule between each would crowd a 90px-tall body. */}
        <div
          className="hidden @min-[12rem]:block w-px bg-border"
          aria-hidden="true"
        />
        <StatTile
          icon={Link2}
          label="Linked"
          value={linkedSkills}
          accentClass="text-success"
        />

        <div
          className="hidden @min-[12rem]:block w-px bg-border"
          aria-hidden="true"
        />
        <StatTile
          icon={Users}
          label="Agents"
          value={activeAgents}
          accentClass="text-emerald-400"
        />
      </div>
    </div>
  )
}
