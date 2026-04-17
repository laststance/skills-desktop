import { AlertCircle, CheckCircle } from 'lucide-react'
import React, { useMemo } from 'react'

import type { Skill } from '../../../../../shared/types'
import { useAppSelector } from '../../../redux/hooks'
import { selectSkillsItems } from '../../../redux/slices/skillsSlice'

// ----------------------------------------------------------------------------
// Pure helpers
// ----------------------------------------------------------------------------

interface HealthTotals {
  valid: number
  broken: number
  missing: number
}

/**
 * Fold all skill-level symlinks into one counts object.
 * We walk every skill once — cheaper than three separate filters.
 * @param skills - all discovered skills
 * @returns totals across every symlink entry
 * @example
 * tallySymlinks([{symlinks:[{status:'valid'},{status:'broken'}]}])
 * // => { valid: 1, broken: 1, missing: 0 }
 */
function tallySymlinks(skills: readonly Skill[]): HealthTotals {
  const totals: HealthTotals = { valid: 0, broken: 0, missing: 0 }
  for (const skill of skills) {
    for (const link of skill.symlinks) {
      totals[link.status] += 1
    }
  }
  return totals
}

/**
 * Compute the valid-link percentage (ignoring `missing`).
 * "Health" is about the quality of links that *should* exist, not coverage,
 * so missing links don't drag the number down — that belongs in the Coverage
 * widget. Returns `null` when there are no links to judge yet.
 * @example healthPercent({valid:8, broken:2}) // => 80
 * @example healthPercent({valid:0, broken:0}) // => null
 */
function healthPercent(totals: HealthTotals): number | null {
  const attempted = totals.valid + totals.broken
  if (attempted === 0) return null
  return Math.round((totals.valid / attempted) * 100)
}

// ----------------------------------------------------------------------------
// HealthBar — a 2-segment horizontal bar showing valid|broken ratio.
// Pure presentational; accepts already-computed numbers to stay testable.
// ----------------------------------------------------------------------------

interface HealthBarProps {
  valid: number
  broken: number
}

const HealthBar = React.memo(function HealthBar({
  valid,
  broken,
}: HealthBarProps): React.ReactElement {
  const total = valid + broken
  const validPct = total > 0 ? (valid / total) * 100 : 0
  const brokenPct = total > 0 ? (broken / total) * 100 : 0

  return (
    <div
      className="h-1.5 w-full rounded-full bg-muted overflow-hidden flex"
      role="img"
      aria-label={`${valid} valid, ${broken} broken`}
    >
      <div
        className="bg-cyan-400 transition-[width] duration-300"
        style={{ width: `${validPct}%` }}
      />
      <div
        className="bg-amber-400 transition-[width] duration-300"
        style={{ width: `${brokenPct}%` }}
      />
    </div>
  )
})

/**
 * Symlink Health widget body.
 *
 * Displays the valid/broken ratio across all agents with a color-coded bar.
 * Broken links demand attention — amber signals "something's off, look here"
 * without being alarmist like destructive red.
 */
export const HealthWidget = React.memo(
  function HealthWidget(): React.ReactElement {
    const skills = useAppSelector(selectSkillsItems)
    const totals = useMemo(() => tallySymlinks(skills), [skills])
    const percent = healthPercent(totals)

    return (
      <div className="h-full w-full flex flex-col justify-center gap-3 px-4 py-3">
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] text-muted-foreground uppercase tracking-wide">
            Health
          </span>
          <span className="text-2xl font-semibold tabular-nums text-foreground">
            {percent === null ? '—' : `${percent}%`}
          </span>
        </div>
        <HealthBar valid={totals.valid} broken={totals.broken} />
        <div className="flex items-center justify-between text-xs">
          <span className="inline-flex items-center gap-1 text-cyan-400">
            <CheckCircle className="h-3 w-3" aria-hidden="true" />
            <span className="tabular-nums">{totals.valid}</span>
            <span className="text-muted-foreground">valid</span>
          </span>
          <span className="inline-flex items-center gap-1 text-amber-400">
            <AlertCircle className="h-3 w-3" aria-hidden="true" />
            <span className="tabular-nums">{totals.broken}</span>
            <span className="text-muted-foreground">broken</span>
          </span>
        </div>
      </div>
    )
  },
)
