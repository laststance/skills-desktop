import type { AgentFolderGroup } from '@/renderer/src/redux/slices/uiSlice'

import { pluralize } from './pluralize'

/**
 * Summarizes actual removals when useDeleteAgentFolders reports completed cleanup, including already-missing parents.
 * @param group - Sidebar group whose folders were reviewed.
 * @param deletedAgentCount - Agents whose empty parent or unprotected skill entries were removed.
 * @returns A deletion count or an explanation when no entries needed removal.
 * @example getAgentFolderDeleteSuccessTitle('unused', 0) // 'Empty agent folders were already gone'
 */
export function getAgentFolderDeleteSuccessTitle(
  group: AgentFolderGroup,
  deletedAgentCount: number,
): string {
  // Empty-parent no-ops and protected hidden folders need different completion messages.
  if (deletedAgentCount === 0) {
    return group === 'unused'
      ? 'Empty agent folders were already gone'
      : 'Hidden agent cleanup complete'
  }
  return group === 'unused'
    ? `Deleted ${deletedAgentCount} empty agent ${pluralize(deletedAgentCount, 'folder')}`
    : `Deleted skills from ${deletedAgentCount} hidden ${pluralize(deletedAgentCount, 'agent')}`
}
