import { GSTACK_BADGE_AGENT_IDS } from '../../../../shared/constants'
import type { AgentId, Skill, SymlinkInfo } from '../../../../shared/types'

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
 * // Orphan skill — both delete and unlink hidden (cleanup flow handled separately)
 * getSkillItemVisibility(null, {
 *   symlinks: [{ agentId: 'cursor', status: 'broken', isLocal: false, ... }],
 *   isOrphan: true,
 * })
 * // => { showDeleteButton: false, showUnlinkButton: false, ... }
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
  // Orphan handling — see Skill.isOrphan for why the delete/unlink buttons
  // are gated. Source: scanOrphanSymlinks() in src/main/services/skillScanner.ts.
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
    showDeleteButton: !selectedAgentId && !isOrphan,
    showAddButton: !selectedAgentId || hasSkillInSelectedAgent,
    showUnlinkButton: hasSkillInSelectedAgent && !isOrphan,
    isLinked: !!selectedAgentSymlink && selectedAgentSymlink.status === 'valid',
    isLocalSkill,
    selectedAgentSymlink,
    selectedLocalSkillInfo,
    showCopyButton: !!selectedAgentId && hasSkillInSelectedAgent,
    showGStackBadge,
  }
}
