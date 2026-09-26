import type { AgentFolderGroup } from '@/renderer/src/redux/slices/uiSlice'

import { pluralize } from './pluralize'

/**
 * Describes the reviewed folders when AgentFoldersMenu renders confirmation for either sidebar group.
 * @param group - Hidden skills folders or not-installed agents' empty parent folders.
 * @param folderCount - Exact number of reviewed folders.
 * @returns Group-specific Trash and preservation text with singular or plural folder wording.
 * @example getAgentFolderDeleteDescription('unused', 1) // 'Move 1 empty agent folder to Trash. Folders containing files, settings, history, or skills will be kept.'
 */
export function getAgentFolderDeleteDescription(
  group: AgentFolderGroup,
  folderCount: number,
): string {
  const folderLabel = pluralize(folderCount, 'folder')
  // Each group explains the data its cleanup preserves, alongside the reviewed count.
  return group === 'unused'
    ? `Move ${folderCount} empty agent ${folderLabel} to Trash. Folders containing files, settings, history, or skills will be kept.`
    : `Move ${folderCount} skills ${folderLabel} to Trash, including all contents. Folders containing protected skills will remain.`
}
