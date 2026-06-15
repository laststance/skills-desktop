import React from 'react'

/**
 * Tone variants for a `StatRow` value.
 * - `default`: neutral foreground; used when the count is informational.
 * - `primary`: brand accent; used when the count represents actionable work
 *   (e.g. "Symlinks to create" when there is something to do).
 * - `amber`: warning hue; used for conflict or skipped counts.
 */
type StatRowTone = 'default' | 'primary' | 'amber'

/**
 * Map of tone → utility classes applied to the value `<span>`. Centralised
 * here so the three sync dialogs cannot drift on accent colour or weight.
 */
const VALUE_CLASS_BY_TONE: Record<StatRowTone, string> = {
  default: 'font-medium',
  primary: 'font-medium text-primary',
  amber: 'font-medium text-amber-500',
}

interface StatRowProps {
  /** Left-aligned label rendered in muted foreground. */
  label: React.ReactNode
  /** Right-aligned value rendered in `font-medium` plus the tone colour. */
  value: React.ReactNode
  /** Visual emphasis for `value`. Defaults to `'default'`. */
  tone?: StatRowTone
}

/**
 * One row of the "skills considered / symlinks to create / conflicts skipped"
 * count list rendered by every sync-related dialog. Replaces the inline
 * `flex justify-between` markup that was duplicated three times across
 * `SyncConfirmDialog`, `SyncConflictDialog`, and `CleanupAgentDialog`.
 *
 * @example
 * <StatRow label="Skills considered" value={preview.totalSkills} />
 * @example
 * <StatRow label="Symlinks to create" value={missingCount} tone="primary" />
 * @example
 * <StatRow label="Conflicts (skipped)" value={conflictCount} tone="amber" />
 */
export const StatRow = React.memo(function StatRow({
  label,
  value,
  tone = 'default',
}: StatRowProps): React.ReactElement {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={VALUE_CLASS_BY_TONE[tone]}>{value}</span>
    </div>
  )
})
