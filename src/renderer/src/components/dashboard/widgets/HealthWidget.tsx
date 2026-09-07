import { AlertCircle, CheckCircle, FileWarning, Search } from 'lucide-react'
import React from 'react'

import { Button } from '@/renderer/src/components/ui/button'
import { useAppDispatch, useAppSelector } from '@/renderer/src/redux/hooks'
import {
  selectLockRecordsNeedingAttention,
  selectStaleLockEntryCount,
} from '@/renderer/src/redux/slices/skillLockSlice'
import { selectSkillsItems } from '@/renderer/src/redux/slices/skillsSlice'
import {
  openLockPruneDialog,
  openSymlinkCleanupDialog,
} from '@/renderer/src/redux/slices/uiSlice'
import { pluralize } from '@/renderer/src/utils/pluralize'
import type { Skill, SymlinkCount } from '@/shared/types'

// ----------------------------------------------------------------------------
// Pure helpers
// ----------------------------------------------------------------------------

interface HealthTotals {
  valid: SymlinkCount
  broken: SymlinkCount
  inaccessible: SymlinkCount
  missing: SymlinkCount
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
  valid: SymlinkCount
  cleanupIssues: SymlinkCount
  manualReview: SymlinkCount
}

const HealthBar = function HealthBar({
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
      // react-doctor-disable-next-line react-doctor/prefer-tag-over-role -- composed bar-chart graphic built from colored child divs; role="img"+aria-label collapses it to one labeled graphic. <img> needs a src and cannot contain children.
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
}

/**
 * Symlink Health widget body.
 *
 * Displays the valid/broken ratio across all agents with a color-coded bar.
 * Broken links demand attention — amber signals "something's off, look here"
 * without being alarmist like destructive red.
 *
 * Stale skill-lock records share this widget because they are the same kind of
 * problem: a record disagreeing with what is actually on disk. They are counted
 * separately from symlinks (a lock record has no agent and no link) and get
 * their own action, so both can be present at once.
 */
export const HealthWidget = function HealthWidget(): React.ReactElement {
  const dispatch = useAppDispatch()
  const skills = useAppSelector(selectSkillsItems)
  const totals = tallySymlinks(skills)
  const percentLabel = healthPercentLabel(totals)
  const prunableLockCount = useAppSelector(selectStaleLockEntryCount)
  // Counts blocked records too. They disagree with disk exactly as much as the
  // prunable ones do, and leaving them out reported a healthy lock while
  // `skills -g update` kept resurrecting the skills behind them.
  const lockCount = useAppSelector(selectLockRecordsNeedingAttention)
  const hasBrokenLinks = totals.broken > 0
  const hasStaleLockEntries = lockCount > 0
  // Inaccessible links are what "manual review" means, and nothing else in this
  // footer resolves them: "Scan issues" opens the broken-link cleanup and
  // "Prune lock" touches lock records. Gating this on the absence of those two
  // hid the label exactly when the widget was busiest, so a user with a broken
  // link AND an unreadable one was never told about the second.
  const hasManualReview = totals.inaccessible > 0
  const isHealthy =
    !hasBrokenLinks && !hasStaleLockEntries && totals.inaccessible === 0

  const handleScanIssues = (): void => {
    dispatch(openSymlinkCleanupDialog())
  }

  const handlePruneLock = (): void => {
    dispatch(openLockPruneDialog())
  }

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

      {/* Wraps rather than clipping: at the 6-col grid's `w: 2`-`w: 3` sizes in
          a narrow panel this row is ~111px wide, and a non-wrapping legend put
          "cleanup" and "manual" outside the shell's `overflow-hidden`, hiding
          two of the three counts with no scrollbar or affordance to find them. */}
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs">
        <span className="inline-flex items-center gap-1 text-success">
          <CheckCircle className="h-3 w-3" aria-hidden="true" />
          <span className="tabular-nums">{totals.valid}</span>
          <span className="text-muted-foreground">valid</span>
        </span>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
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
          {lockCount > 0 ? (
            <span className="inline-flex items-center gap-1 text-foreground">
              <FileWarning className="h-3 w-3" aria-hidden="true" />
              <span className="tabular-nums">{lockCount}</span>
              <span className="text-muted-foreground">lock</span>
            </span>
          ) : null}
          {totals.broken === 0 &&
          totals.inaccessible === 0 &&
          lockCount === 0 ? (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <AlertCircle className="h-3 w-3" aria-hidden="true" />
              <span className="tabular-nums">0</span>
              <span>needs review</span>
            </span>
          ) : null}
        </div>
      </div>
      <div className="min-h-8 mt-auto flex flex-wrap items-center justify-end gap-1.5">
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
        ) : null}
        {hasStaleLockEntries ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={handlePruneLock}
            className="h-8 min-h-8 px-2 text-[11px]"
          >
            <FileWarning className="h-3.5 w-3.5" aria-hidden="true" />
            {/* Nothing to prune means the dialog is pure explanation, and a
                button promising a delete would be lying about what it opens. */}
            {prunableLockCount > 0 ? 'Prune lock' : 'Review lock'}
          </Button>
        ) : null}
        {hasManualReview ? (
          <span className="text-[11px] text-amber-400">Manual review</span>
        ) : null}
        {isHealthy ? (
          <span className="text-[11px] text-muted-foreground">Healthy</span>
        ) : null}
      </div>
    </div>
  )
}
