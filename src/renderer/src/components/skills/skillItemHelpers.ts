import { GSTACK_BADGE_AGENT_IDS } from '@/shared/constants'
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
  /** The symlink for the selected agent, if any (needed for unlink handler) */
  selectedAgentSymlink: SymlinkInfo | null
  /** The local skill SymlinkInfo for the selected agent, if any (needed for delete handler) */
  selectedLocalSkillInfo: SymlinkInfo | null
  /** Show "Copy to..." context menu — only in agent view (not global, not universal) */
  showCopyButton: boolean
  /** Show G-Stack source badge/link in selected agent view */
  showGStackBadge: boolean
}

/** Path-segment matcher for `.../gstack/...` on both POSIX and Windows paths. */
const GSTACK_SEGMENT_PATTERN = /(^|[\\/])gstack([\\/]|$)/i

/**
 * Detect whether a filesystem-like path points to a G-Stack-managed location.
 * @param candidatePath - Path candidate from symlink target or link path.
 * @returns
 * - `true`: Path contains a standalone `gstack` segment.
 * - `false`: Empty or non-matching path.
 * @example
 * isGStackBundlePath('/Users/me/.claude/skills/gstack/skill-a') // => true
 * @example
 * isGStackBundlePath('../gstack/skill-a') // => true
 * @example
 * isGStackBundlePath('/Users/me/.agents/skills/task') // => false
 */
function isGStackBundlePath(candidatePath: string): boolean {
  return GSTACK_SEGMENT_PATTERN.test(candidatePath)
}

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
 * // Orphan in agent view — Unlink is shown so the user can clear the
 * // dangling agent-side symlink one row at a time. Add stays hidden.
 * getSkillItemVisibility('cursor', {
 *   symlinks: [{ agentId: 'cursor', status: 'broken', isLocal: false, ... }],
 *   isOrphan: true,
 * })
 * // => { showDeleteButton: false, showAddButton: false, showUnlinkButton: true, ... }
 */
export function getSkillItemVisibility(
  selectedAgentId: AgentId | null,
  skill: Pick<Skill, 'symlinks' | 'isOrphan'>,
): SkillItemVisibility {
  const { symlinks, isOrphan } = skill
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
  const hasSkillInSelectedAgent = !!selectedAgentSymlink || isLocalSkill
  // Orphan handling — see Skill.isOrphan for why the Add button is gated.
  // Source: scanOrphanSymlinks() in src/main/services/skillScanner.ts.
  const gStackPathCandidates = [
    selectedAgentSymlink?.targetPath ?? '',
    selectedAgentSymlink?.linkPath ?? '',
    selectedLocalSkillInfo?.linkPath ?? '',
  ]
  const isGStackEligibleAgent =
    selectedAgentId !== null &&
    GSTACK_BADGE_AGENT_IDS.some((agentId) => agentId === selectedAgentId)
  const showGStackBadge =
    isGStackEligibleAgent && gStackPathCandidates.some(isGStackBundlePath)

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
    showAddButton: (!selectedAgentId || hasSkillInSelectedAgent) && !isOrphan,
    // Unlink is the per-agent cleanup action — drives the right-click
    // "Cleanup missing skills..." flow's row-level analogue. For orphans
    // it removes the dangling symlink without touching siblings.
    showUnlinkButton: hasSkillInSelectedAgent,
    isLinked: !!selectedAgentSymlink && selectedAgentSymlink.status === 'valid',
    isLocalSkill,
    selectedAgentSymlink,
    selectedLocalSkillInfo,
    // "Copy to..." opens CopyToAgentsModal which fans out from the live
    // source skill — for an orphan, that source is gone. Hide the action
    // for the same reason `showAddButton` is gated on `!isOrphan`.
    showCopyButton: !!selectedAgentId && hasSkillInSelectedAgent && !isOrphan,
    showGStackBadge,
  }
}
