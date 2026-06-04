import { AlertCircle, CheckCircle, Search } from 'lucide-react'
import React, { useCallback, useMemo } from 'react'

import { Button } from '@/renderer/src/components/ui/button'
import { useAppDispatch, useAppSelector } from '@/renderer/src/redux/hooks'
import { selectSkillsItems } from '@/renderer/src/redux/slices/skillsSlice'
import { openSymlinkCleanupDialog } from '@/renderer/src/redux/slices/uiSlice'
import { pluralize } from '@/renderer/src/utils/pluralize'
import type { Skill } from '@/shared/types'

// ----------------------------------------------------------------------------
// Pure helpers
// ----------------------------------------------------------------------------

interface HealthTotals {
  valid: number
  broken: number
  inaccessible: number
  missing: number
}

/**
 * Fold all skill-level symlinks into one counts object.
 * We walk every skill once — cheaper than three separate filters.
 * @param skills - all discovered skills
 * @returns totals across every symlink entry
 * @example
 * tallySymlinks([{symlinks:[{status:'valid'},{status:'broken'}]}])
 * // => { valid: 1, broken: 1, inaccessible: 0, missing: 0 }
 */
function tallySymlinks(skills: readonly Skill[]): HealthTotals {
  const totals: HealthTotals = {
    valid: 0,
    broken: 0,
    inaccessible: 0,
    missing: 0,
  }
  for (const skill of skills) {
    for (const link of skill.symlinks) {
      totals[link.status] += 1
    }
  }
  return totals
}

/**
 * Formats valid-link health so a remaining issue never presents as perfect.
 * @param totals - Link totals counted from the current skill inventory.
 * @returns Display label, or null when there are no attempted links.
 * @example healthPercentLabel({valid:999, broken:1, inaccessible:0, missing:0}) // => '99.9%'
 */
function healthPercentLabel(totals: HealthTotals): string | null {
  const attempted = totals.valid + totals.broken + totals.inaccessible
  if (attempted === 0) return null

  const percent = (totals.valid / attempted) * 100
  if (totals.valid === attempted) return '100%'

  // Tiny issue counts are still issues; avoid visually rounding them to 100%.
  return percent >= 99.5 ? `${percent.toFixed(1)}%` : `${Math.round(percent)}%`
}

// ----------------------------------------------------------------------------
// HealthBar — a 3-segment horizontal bar showing valid|cleanup|manual ratio.
// Pure presentational; accepts already-computed numbers to stay testable.
// ----------------------------------------------------------------------------

interface HealthBarProps {
  valid: number
  cleanupIssues: number
  manualReview: number
}

const HealthBar = React.memo(function HealthBar({
  valid,
  cleanupIssues,
  manualReview,
}: HealthBarProps): React.ReactElement {
  const total = valid + cleanupIssues + manualReview
  const validPct = total > 0 ? (valid / total) * 100 : 0
  const cleanupPct = total > 0 ? (cleanupIssues / total) * 100 : 0
  const manualPct = total > 0 ? (manualReview / total) * 100 : 0

  return (
    <div
      className="h-1 w-full shrink-0 rounded-full bg-muted overflow-hidden flex"
      role="img"
      aria-label={`${valid} valid, ${cleanupIssues} ${pluralize(cleanupIssues, 'cleanup issue')}, ${manualReview} manual review`}
    >
      <div
        className="bg-success transition-[width] duration-300"
        style={{ width: `${validPct}%` }}
      />
      <div
        className="bg-amber-400 transition-[width] duration-300"
        style={{ width: `${cleanupPct}%` }}
      />
      {/* Manual-review shares cleanup's amber-400 (broken + inaccessible = one needs-review hue app-wide; see SymlinkStatus). */}
      <div
        className="bg-amber-400 transition-[width] duration-300"
        style={{ width: `${manualPct}%` }}
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
    const dispatch = useAppDispatch()
    const skills = useAppSelector(selectSkillsItems)
    const totals = useMemo(() => tallySymlinks(skills), [skills])
    const percentLabel = healthPercentLabel(totals)
    const hasBrokenLinks = totals.broken > 0
    const hasManualReviewOnly = !hasBrokenLinks && totals.inaccessible > 0

    const handleScanIssues = useCallback((): void => {
      dispatch(openSymlinkCleanupDialog())
    }, [dispatch])

    return (
      <div className="h-full w-full flex flex-col gap-2 px-4 py-3">
        <span className="text-2xl font-semibold tabular-nums text-foreground">
          {percentLabel === null ? '—' : percentLabel}
        </span>
        <HealthBar
          valid={totals.valid}
          cleanupIssues={totals.broken}
          manualReview={totals.inaccessible}
        />
        <div className="flex items-center justify-between text-xs">
          <span className="inline-flex items-center gap-1 text-success">
            <CheckCircle className="h-3 w-3" aria-hidden="true" />
            <span className="tabular-nums">{totals.valid}</span>
            <span className="text-muted-foreground">valid</span>
          </span>
          <div className="flex items-center gap-2">
            {totals.broken > 0 ? (
              <span className="inline-flex items-center gap-1 text-amber-400">
                <AlertCircle className="h-3 w-3" aria-hidden="true" />
                <span className="tabular-nums">{totals.broken}</span>
                <span className="text-muted-foreground">cleanup</span>
              </span>
            ) : null}
            {totals.inaccessible > 0 ? (
              <span className="inline-flex items-center gap-1 text-amber-400">
                <AlertCircle className="h-3 w-3" aria-hidden="true" />
                <span className="tabular-nums">{totals.inaccessible}</span>
                <span className="text-muted-foreground">manual</span>
              </span>
            ) : null}
            {totals.broken === 0 && totals.inaccessible === 0 ? (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <AlertCircle className="h-3 w-3" aria-hidden="true" />
                <span className="tabular-nums">0</span>
                <span>needs review</span>
              </span>
            ) : null}
          </div>
        </div>
        <div className="min-h-8 mt-auto flex items-center justify-end">
          {hasBrokenLinks ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={handleScanIssues}
              className="h-8 min-h-8 px-2 text-[11px]"
              data-symlink-cleanup-trigger="true"
            >
              <Search className="h-3.5 w-3.5" aria-hidden="true" />
              Scan issues
            </Button>
          ) : hasManualReviewOnly ? (
            <span className="text-[11px] text-amber-400">Manual review</span>
          ) : (
            <span className="text-[11px] text-muted-foreground">Healthy</span>
          )}
        </div>
      </div>
    )
  },
)
