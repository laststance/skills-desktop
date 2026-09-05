import { pluralize } from './pluralize'

/**
 * Explains preserved entries when HiddenAgentsMenu renders its deletion review.
 * @param skippedCount - Hidden agents without an eligible dedicated folder.
 * @param protectedCount - Protected skill entries in reviewed folders.
 * @returns Non-empty notices in shared-folder then protected-skill order.
 * @example getHiddenAgentsDeleteNotices(0, 1) // ['1 protected skill entry will be kept.']
 */
export function getHiddenAgentsDeleteNotices(
  skippedCount: number,
  protectedCount: number,
): string[] {
  const notices: string[] = []
  // Omit zero-count notices so the dialog only describes meaningful exclusions.
  if (skippedCount > 0) {
    notices.push(
      `${skippedCount} hidden ${pluralize(skippedCount, 'agent')} with shared or unavailable folders will be skipped.`,
    )
  }
  if (protectedCount > 0) {
    notices.push(
      `${protectedCount} protected skill ${pluralize(protectedCount, 'entry', 'entries')} will be kept.`,
    )
  }
  return notices
}
