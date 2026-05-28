import { GSTACK_BADGE_AGENT_IDS } from '@/shared/constants'
import type { AgentId, Skill, SymlinkInfo } from '@/shared/types'

/**
 * Path-segment matcher for `.../skills/gstack/...` on both POSIX and Windows
 * paths. Requires a `skills/` parent so a user-created directory literally
 * named `gstack` outside any agent's skills tree cannot trigger G-Stack UI.
 */
const GSTACK_SEGMENT_PATTERN = /[\\/]skills[\\/]gstack([\\/]|$)/i

/**
 * Detect whether a filesystem-like path points to a G-Stack-managed location.
 * @param candidatePath - Path candidate from symlink target or link path.
 * @returns `true` when the path contains a `skills/gstack/` segment.
 * @example
 * isGStackBundlePath('/Users/me/.claude/skills/gstack/skill-a') // true
 * @example
 * isGStackBundlePath('/Users/me/projects/gstack/skill-a') // false
 */
function isGStackBundlePath(candidatePath: string): boolean {
  return GSTACK_SEGMENT_PATTERN.test(candidatePath)
}

/**
 * Collect only the selected agent's G-Stack attribution paths for a skill.
 * This keeps sibling agents isolated: a Claude Code G-Stack copy must not make
 * the Cursor row look G-Stack-managed when Cursor owns a plain local copy.
 *
 * @param symlinks - Per-agent slot records attached to a skill.
 * @param selectedAgentId - Agent whose list is currently being filtered.
 * @returns Candidate paths that can prove this selected agent's slot is G-Stack-managed.
 * @example
 * getGStackPathCandidatesForAgent(skill.symlinks, 'claude-code')
 * // ['/Users/me/.claude/skills/gstack/ship', '/Users/me/.claude/skills/ship', ...]
 */
function getGStackPathCandidatesForAgent(
  symlinks: readonly SymlinkInfo[],
  selectedAgentId: AgentId,
): string[] {
  const selectedAgentSymlink =
    symlinks.find(
      (slot) =>
        slot.agentId === selectedAgentId &&
        (slot.status === 'valid' ||
          slot.status === 'broken' ||
          slot.status === 'inaccessible') &&
        !slot.isLocal,
    ) ?? null

  const selectedLocalSkillInfo =
    symlinks.find((slot) => slot.agentId === selectedAgentId && slot.isLocal) ??
    null

  return [
    selectedAgentSymlink?.targetPath ?? '',
    selectedAgentSymlink?.linkPath ?? '',
    selectedLocalSkillInfo?.linkPath ?? '',
    selectedLocalSkillInfo?.skillMdSymlinkTarget ?? '',
  ]
}

/**
 * Determine whether the selected agent's slot for this skill is G-Stack-managed.
 * Used by both the skill-card badge and the agent-view `G-Stack` type filter so
 * both surfaces answer the same question.
 *
 * @param skill - Skill record whose `symlinks` hold per-agent path evidence.
 * @param selectedAgentId - Currently selected agent, or `null` outside agent view.
 * @returns `true` only for supported agents with a selected slot under `skills/gstack/`.
 * @example
 * isGStackManagedForAgent(skill, 'claude-code') // true for ~/.claude/skills/gstack/ship
 */
export function isGStackManagedForAgent(
  skill: Pick<Skill, 'symlinks'>,
  selectedAgentId: AgentId | null,
): boolean {
  if (selectedAgentId === null) return false

  // Only agents known to host G-Stack-managed sibling skills get this UI.
  const isGStackEligibleAgent = GSTACK_BADGE_AGENT_IDS.some(
    (agentId) => agentId === selectedAgentId,
  )
  if (!isGStackEligibleAgent) return false

  return getGStackPathCandidatesForAgent(skill.symlinks, selectedAgentId).some(
    isGStackBundlePath,
  )
}
