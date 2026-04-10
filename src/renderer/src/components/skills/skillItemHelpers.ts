import type { AgentId, SymlinkInfo } from '../../../../shared/types'

/**
 * Visibility state for SkillItem action buttons.
 * Determines which buttons (delete, add, unlink) to render.
 */
export interface SkillItemVisibility {
  /** Show X button (delete skill entirely) — only in global view */
  showDeleteButton: boolean
  /** Show Add button (create symlinks) — only in global view */
  showAddButton: boolean
  /** Show Trash icon (unlink symlink or delete local skill from selected agent) */
  showUnlinkButton: boolean
  /** Skill is symlinked (non-local) to selected agent with valid status */
  isLinked: boolean
  /** Skill is a local (real folder) in selected agent's skills directory */
  isLocalSkill: boolean
  /** The symlink for the selected agent, if any (needed for unlink handler) */
  selectedAgentSymlink: SymlinkInfo | null
  /** The local skill SymlinkInfo for the selected agent, if any (needed for delete handler) */
  selectedLocalSkillInfo: SymlinkInfo | null
  /** Show "Copy to..." context menu — only in agent view (not global, not universal) */
  showCopyButton: boolean
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
 *
 * @example
 * // Agent filtered view with local skill — show unlink button for deletion
 * getSkillItemVisibility('cursor', [{ agentId: 'cursor', status: 'valid', isLocal: true, ... }])
 * // => { showDeleteButton: false, showUnlinkButton: true, isLocalSkill: true, selectedLocalSkillInfo: {...}, ... }
 */
export function getSkillItemVisibility(
  selectedAgentId: AgentId | null,
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

  const selectedLocalSkillInfo = selectedAgentId
    ? (symlinks.find((s) => s.agentId === selectedAgentId && s.isLocal) ?? null)
    : null

  const isLocalSkill = !!selectedLocalSkillInfo

  return {
    showDeleteButton: !selectedAgentId,
    showAddButton: !selectedAgentId,
    showUnlinkButton: !!selectedAgentSymlink || isLocalSkill,
    isLinked: !!selectedAgentSymlink && selectedAgentSymlink.status === 'valid',
    isLocalSkill,
    selectedAgentSymlink,
    selectedLocalSkillInfo,
    showCopyButton:
      !!selectedAgentId && (!!selectedAgentSymlink || isLocalSkill),
  }
}
