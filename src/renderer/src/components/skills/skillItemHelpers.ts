import type { SymlinkInfo } from '../../../../shared/types'

/**
 * Visibility state for SkillItem action buttons.
 * Determines which buttons (delete, add, unlink) to render.
 */
export interface SkillItemVisibility {
  /** Show X button (delete skill entirely) — only in global view */
  showDeleteButton: boolean
  /** Show Add button (create symlinks) — only in global view */
  showAddButton: boolean
  /** Show Trash icon (unlink from selected agent) */
  showUnlinkButton: boolean
  /** Show link emoji — skill is validly linked to selected agent */
  isLinked: boolean
  /** The symlink for the selected agent, if any (needed for unlink handler) */
  selectedAgentSymlink: SymlinkInfo | null
}

/**
 * Compute which action buttons to show on a SkillItem card.
 *
 * @param selectedAgentId - Currently selected agent filter (null = global view)
 * @param symlinks - Symlink info array for the skill
 * @returns Visibility flags for each action button
 *
 * @example
 * // Global view (no agent filter) — show delete & add, hide unlink
 * getSkillItemVisibility(null, []) // => { showDeleteButton: true, showAddButton: true, showUnlinkButton: false, ... }
 *
 * @example
 * // Agent filtered view with valid symlink — show unlink, hide delete & add
 * getSkillItemVisibility('cursor', [{ agentId: 'cursor', status: 'valid', isLocal: false, ... }])
 * // => { showDeleteButton: false, showAddButton: false, showUnlinkButton: true, isLinked: true, ... }
 */
export function getSkillItemVisibility(
  selectedAgentId: string | null,
  symlinks: SymlinkInfo[],
): SkillItemVisibility {
  const selectedAgentSymlink = selectedAgentId
    ? (symlinks.find(
        (s) =>
          s.agentId === selectedAgentId &&
          (s.status === 'valid' || s.status === 'broken') &&
          !s.isLocal,
      ) ?? null)
    : null

  return {
    showDeleteButton: !selectedAgentId,
    showAddButton: !selectedAgentId,
    showUnlinkButton: !!selectedAgentSymlink,
    isLinked: !!selectedAgentSymlink && selectedAgentSymlink.status === 'valid',
    selectedAgentSymlink,
  }
}
