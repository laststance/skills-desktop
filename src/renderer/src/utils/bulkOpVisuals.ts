import type { SkillName } from '@/shared/types'

/**
 * Name of the DOM CustomEvent fired when a per-row bulk operation fails.
 * {@link SkillItem} rows subscribe and flash a red left edge for
 * {@link FAILED_ROW_FLASH_MS}. Exported so tests and listeners reference the
 * same string (no stringly-typed drift).
 */
export const BULK_ITEM_FAILED_EVENT = 'skills:bulkItemFailed' as const

/** How long a failed row keeps its red left edge (ms). */
export const FAILED_ROW_FLASH_MS = 3_000

/**
 * When each failed row's flash ends, on the `performance.now()` clock. The
 * event only reaches rows mounted when it fires, and a rejected bulk op swaps
 * the list for its error view until the refresh lands, so a row that mounts
 * later reads its deadline here instead.
 */
const flashEndsAtBySkillName = new Map<SkillName, number>()

/**
 * Fire `skills:bulkItemFailed` for each failed row in a bulk op. The
 * {@link SkillItem} rows listen and flash a red left edge for
 * {@link FAILED_ROW_FLASH_MS}. Uses a DOM CustomEvent instead of Redux state
 * because the failure highlight is transient and per-row — piping it through
 * the store would cause a render cascade for a 3-second visual.
 *
 * @param failedNames - SkillNames that errored in the last batch
 * @example
 * flashFailedRows(failedNames)
 */
export const flashFailedRows = (failedNames: SkillName[]): void => {
  const flashEndsAt = performance.now() + FAILED_ROW_FLASH_MS
  for (const skillName of failedNames) {
    flashEndsAtBySkillName.set(skillName, flashEndsAt)
    window.dispatchEvent(
      new CustomEvent<{ skillName: SkillName }>(BULK_ITEM_FAILED_EVENT, {
        detail: { skillName },
      }),
    )
  }
}

/**
 * Reads when a row's failure flash ends, so a row that mounts mid-flash (after
 * the error view, or on scrolling into the virtualized window) shows the rest
 * of it. {@link SkillItem} reads it on mount and on each failure event.
 * @param skillName - The row's skill.
 * @returns
 * - The flash's end time on the `performance.now()` clock while it runs
 * - `null` once it has ended, or when the row never failed
 * @example
 * flashFailedRows([toSkillName('task')])
 * getFlashEndsAt(toSkillName('task')) // => performance.now() + 3000
 * getFlashEndsAt(toSkillName('tdd')) // => null
 */
export const getFlashEndsAt = (skillName: SkillName): number | null => {
  const flashEndsAt = flashEndsAtBySkillName.get(skillName)
  if (flashEndsAt === undefined) return null
  // Drop an ended flash so the map only holds rows that are still flashing.
  if (flashEndsAt <= performance.now()) {
    flashEndsAtBySkillName.delete(skillName)
    return null
  }
  return flashEndsAt
}
