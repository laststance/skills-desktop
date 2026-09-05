import type { AgentFolderGroup } from '@/renderer/src/redux/slices/uiSlice'

import { pluralize } from './pluralize'

/**
 * Explains preserved entries when AgentFoldersMenu renders its deletion review.
 * @param skippedCount - Agents without an eligible dedicated folder.
 * @param protectedCount - Protected skill entries in reviewed folders.
 * @param group - Sidebar group being reviewed.
 * @returns Non-empty notices in shared-folder then protected-skill order.
 * @example getAgentFolderDeleteNotices(0, 1) // ['1 protected skill entry will be kept.']
 */
export function getAgentFolderDeleteNotices(
  skippedCount: number,
  protectedCount: number,
  group: AgentFolderGroup = 'hidden',
): string[] {
  const notices: string[] = []
  // Omit zero-count notices so the dialog only describes meaningful exclusions.
  if (skippedCount > 0) {
    notices.push(
      group === 'hidden'
        ? `${skippedCount} hidden ${pluralize(skippedCount, 'agent')} with shared or unavailable folders will be skipped.`
        : `${skippedCount} ${pluralize(skippedCount, 'agent')} without an empty, separate folder will be skipped.`,
    )
  }
  if (group === 'hidden' && protectedCount > 0) {
    notices.push(
      `${protectedCount} protected skill ${pluralize(protectedCount, 'entry', 'entries')} will be kept.`,
    )
  }
  return notices
}
