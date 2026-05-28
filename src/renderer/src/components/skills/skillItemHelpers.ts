import { isGStackManagedForAgent } from '@/renderer/src/utils/gstackSkill'
import type { AgentId, Skill, SymlinkInfo } from '@/shared/types'

/**
 * Visibility state for SkillItem action buttons.
 * Determines which buttons (delete, add, unlink) to render.
 */
export interface SkillItemVisibility {
  /** Show X button (delete skill entirely) — only in global view */
  showDeleteButton: boolean
  /**
   * Show Add button.
   * - global view: opens AddSymlinkModal
   * - agent view (skill exists in selected agent): opens CopyToAgentsModal
   */
  showAddButton: boolean
  /** Show Trash icon (unlink symlink or delete local skill from selected agent) */
  showUnlinkButton: boolean
  /** Skill is symlinked (non-local) to selected agent with valid status */
  isLinked: boolean
  /** Skill is a local (real folder) in selected agent's skills directory */
  isLocalSkill: boolean
  /** Selected agent has a symlink whose target needs manual filesystem review */
  isInaccessibleSkill: boolean
  /** The symlink for the selected agent, if any (needed for unlink handler) */
  selectedAgentSymlink: SymlinkInfo | null
  /** The local skill SymlinkInfo for the selected agent, if any (needed for delete handler) */
  selectedLocalSkillInfo: SymlinkInfo | null
  /** Show "Copy to..." context menu — only in agent view (not global, not universal) */
  showCopyButton: boolean
  /** Show G-Stack source badge/link in selected agent view */
  showGStackBadge: boolean
}

/**
 * Subset of `Skill` that `getSkillItemVisibility` actually reads. Reused by
 * the test factory so a future field addition is a one-line change instead
 * of three (function signature, factory return, factory overrides).
 */
export type SkillVisibilityInput = Pick<Skill, 'symlinks' | 'isOrphan'>

/**
 * Compute which action buttons to show on a SkillItem card.
 *
 * Reads `isOrphan` directly off the skill — set by `scanOrphanSymlinks` in
 * main, where the source-skill existence check actually lives — instead of
 * re-deriving it from `symlinks`. The renderer no longer needs to know the
 * orphan rule; it only needs to know how to react to it.
 *
 * @param selectedAgentId - Currently selected agent filter (null = global view)
 * @param skill - The skill being rendered (only `symlinks` and `isOrphan` are read)
 * @returns Visibility flags for each action button
 *
 * @example
 * // Global view (no agent filter) — show delete & add, hide unlink
 * getSkillItemVisibility(null, { symlinks: [], isOrphan: false })
 * // => { showDeleteButton: true, showAddButton: true, showUnlinkButton: false, ... }
 *
 * @example
 * // Agent filtered view with valid symlink — show unlink and add, hide delete
 * getSkillItemVisibility('cursor', {
 *   symlinks: [{ agentId: 'cursor', status: 'valid', isLocal: false, ... }],
 *   isOrphan: false,
 * })
 * // => { showDeleteButton: false, showAddButton: true, showUnlinkButton: true, isLinked: true, ... }
 *
 * @example
 * // Orphan in global view — Delete is shown so the user can sweep the
 * // dangling skill row; Add is hidden (no live source to point a new
 * // symlink at).
 * getSkillItemVisibility(null, {
 *   symlinks: [{ agentId: 'cursor', status: 'broken', isLocal: false, ... }],
 *   isOrphan: true,
 * })
 * // => { showDeleteButton: true, showAddButton: false, showUnlinkButton: false, ... }
 *
 * @example
 * // Orphan in agent view — normal Unlink stays hidden so reviewed cleanup
 * // paths handle stale broken links. Add stays hidden.
 * getSkillItemVisibility('cursor', {
 *   symlinks: [{ agentId: 'cursor', status: 'broken', isLocal: false, ... }],
 *   isOrphan: true,
 * })
 * // => { showDeleteButton: false, showAddButton: false, showUnlinkButton: false, ... }
 */
export function getSkillItemVisibility(
  selectedAgentId: AgentId | null,
  skill: SkillVisibilityInput,
): SkillItemVisibility {
  const { symlinks, isOrphan } = skill
  const selectedAgentSymlink = selectedAgentId
    ? (symlinks.find(
        (s) =>
          s.agentId === selectedAgentId &&
          (s.status === 'valid' ||
            s.status === 'broken' ||
            s.status === 'inaccessible') &&
          !s.isLocal,
      ) ?? null)
    : null

  const selectedLocalSkillInfo = selectedAgentId
    ? (symlinks.find((s) => s.agentId === selectedAgentId && s.isLocal) ?? null)
    : null

  const isLocalSkill = Boolean(selectedLocalSkillInfo)
  const hasUsableSkillInSelectedAgent =
    isLocalSkill || selectedAgentSymlink?.status === 'valid'
  const isInaccessibleSkill =
    selectedAgentSymlink !== null &&
    selectedAgentSymlink.status === 'inaccessible'
  // Orphan handling — see Skill.isOrphan for why the Add button is gated.
  // Source: scanOrphanSymlinks() in src/main/services/skillScanner.ts.
  const showGStackBadge = isGStackManagedForAgent(skill, selectedAgentId)

  return {
    // Delete is the primary cleanup action for orphans in global view —
    // sweeping the dangling row removes every agent-side symlink at once.
    // Restored so users have an explicit way to act on what the loosened
    // selectFilteredSkills now shows them.
    showDeleteButton: !selectedAgentId,
    // Orphan skills have no live source to symlink _to_, so the Add button
    // (which opens AddSymlinkModal / CopyToAgentsModal) would surface a flow
    // that can only fail. Stays gated on `!isOrphan` even after the Delete
    // and Unlink loosens.
    showAddButton:
      (!selectedAgentId || hasUsableSkillInSelectedAgent) &&
      !isOrphan &&
      !isInaccessibleSkill,
    // Broken and inaccessible non-local symlinks need reviewed cleanup paths
    // that recheck the target; generic unlink only stays for valid symlinks.
    showUnlinkButton:
      isLocalSkill ||
      (selectedAgentSymlink !== null &&
        selectedAgentSymlink.status === 'valid'),
    isLinked:
      selectedAgentSymlink !== null && selectedAgentSymlink.status === 'valid',
    isLocalSkill,
    isInaccessibleSkill,
    selectedAgentSymlink,
    selectedLocalSkillInfo,
    // "Copy to..." opens CopyToAgentsModal which fans out from the live
    // source skill — for an orphan, that source is gone. Hide the action
    // for the same reason `showAddButton` is gated on `!isOrphan`.
    showCopyButton:
      selectedAgentId !== null &&
      hasUsableSkillInSelectedAgent &&
      !isOrphan &&
      !isInaccessibleSkill,
    showGStackBadge,
  }
}
