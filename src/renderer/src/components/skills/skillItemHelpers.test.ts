import { describe, expect, it } from 'vitest'

import type { AbsolutePath, AgentId, Skill, SymlinkInfo } from '@/shared/types'

import {
  getSkillItemVisibility,
  type SkillVisibilityInput,
} from './skillItemHelpers'

/**
 * Create a mock SymlinkInfo for testing
 */
function makeSymlink(
  overrides: Partial<SymlinkInfo> & { agentId: AgentId },
): SymlinkInfo {
  return {
    agentName: 'Test Agent' as SymlinkInfo['agentName'],
    status: 'valid',
    targetPath: '/target' as AbsolutePath,
    linkPath: '/link' as AbsolutePath,
    isLocal: false,
    ...overrides,
  }
}

/**
 * Bundle a list of symlinks into the minimal `Skill` shape that
 * {@link getSkillItemVisibility} reads. `isOrphan` is auto-derived from the
 * symlinks (every entry broken/missing AND no local copy = orphan), matching
 * what `scanOrphanSymlinks` would set in production. Override when a test
 * needs to assert the inverse. `skillMdSymlinkTarget` lives on each
 * `SymlinkInfo` slot — pass it via `makeSymlink` to simulate a gstack-managed
 * local skill whose SKILL.md symlinks into the gstack source tree.
 */
function makeSkill(
  symlinks: SymlinkInfo[],
  overrides?: Partial<Pick<Skill, 'isOrphan'>>,
): SkillVisibilityInput {
  const derivedOrphan =
    symlinks.length > 0 &&
    symlinks.some((s) => s.status === 'broken') &&
    !symlinks.some((s) => s.status === 'valid' || s.isLocal)
  return {
    symlinks,
    isOrphan: overrides?.isOrphan ?? derivedOrphan,
  }
}

describe('getSkillItemVisibility', () => {
  describe('global view (no agent selected)', () => {
    it('shows delete and add buttons, hides unlink', () => {
      const result = getSkillItemVisibility(null, makeSkill([]))

      expect(result.showDeleteButton).toBe(true)
      expect(result.showAddButton).toBe(true)
      expect(result.showUnlinkButton).toBe(false)
      expect(result.isLinked).toBe(false)
      expect(result.selectedAgentSymlink).toBeNull()
      expect(result.selectedLocalSkillInfo).toBeNull()
    })

    it('shows delete and add even when symlinks exist', () => {
      const symlinks = [makeSymlink({ agentId: 'cursor' })]
      const result = getSkillItemVisibility(null, makeSkill(symlinks))

      expect(result.showDeleteButton).toBe(true)
      expect(result.showAddButton).toBe(true)
      expect(result.showUnlinkButton).toBe(false)
    })
  })

  describe('agent filtered view (agent selected)', () => {
    it('hides delete button and keeps add hidden when selected agent has no skill', () => {
      const result = getSkillItemVisibility('cursor', makeSkill([]))

      expect(result.showDeleteButton).toBe(false)
      expect(result.showAddButton).toBe(false)
    })

    it('shows add button when selected agent has a valid symlink', () => {
      const symlinks = [
        makeSymlink({ agentId: 'cursor', status: 'valid', isLocal: false }),
      ]
      const result = getSkillItemVisibility('cursor', makeSkill(symlinks))

      expect(result.showAddButton).toBe(true)
    })

    it('shows add button when selected agent has a local skill', () => {
      const symlinks = [
        makeSymlink({ agentId: 'cursor', status: 'valid', isLocal: true }),
      ]
      const result = getSkillItemVisibility('cursor', makeSkill(symlinks))

      expect(result.showAddButton).toBe(true)
    })

    it('shows unlink button when valid symlink exists for selected agent', () => {
      const symlinks = [
        makeSymlink({ agentId: 'cursor', status: 'valid', isLocal: false }),
      ]
      const result = getSkillItemVisibility('cursor', makeSkill(symlinks))

      expect(result.showUnlinkButton).toBe(true)
      expect(result.isLinked).toBe(true)
      expect(result.selectedAgentSymlink).toBe(symlinks[0])
    })

    it('shows unlink button for orphan-only broken symlink so user can clean it up', () => {
      // PR #131 (issue #71 PR-2) intentionally surfaces unlink for orphan
      // rows: removing a dangling symlink at `linkPath` is a safe `rm` op
      // regardless of whether the target resolves, and it's how the user
      // sweeps orphans one row at a time without the bulk Cleanup dialog.
      // Add stays gated separately because re-adding requires a live source.
      const symlinks = [
        makeSymlink({ agentId: 'cursor', status: 'broken', isLocal: false }),
      ]
      const result = getSkillItemVisibility('cursor', makeSkill(symlinks))

      expect(result.showUnlinkButton).toBe(true)
      // isLinked still requires status==='valid'; broken does NOT count as
      // linked even though it now satisfies showUnlinkButton.
      expect(result.isLinked).toBe(false)
    })

    it('still shows unlink for broken symlink when another agent has a valid copy', () => {
      // Live source skill with one healthy and one broken agent link — the
      // orphan guard must NOT trigger here. Removing the broken link is safe
      // and meaningful because the source still exists.
      const symlinks = [
        makeSymlink({ agentId: 'cursor', status: 'broken', isLocal: false }),
        makeSymlink({ agentId: 'codex', status: 'valid', isLocal: false }),
      ]
      const result = getSkillItemVisibility('cursor', makeSkill(symlinks))

      expect(result.showUnlinkButton).toBe(true)
      expect(result.isLinked).toBe(false)
    })

    it('hides unlink button when no symlink for selected agent', () => {
      const symlinks = [
        makeSymlink({ agentId: 'codex', status: 'valid', isLocal: false }),
      ]
      const result = getSkillItemVisibility('cursor', makeSkill(symlinks))

      expect(result.showUnlinkButton).toBe(false)
      expect(result.selectedAgentSymlink).toBeNull()
    })

    it('shows unlink button for local skills (isLocal=true)', () => {
      const symlinks = [
        makeSymlink({ agentId: 'cursor', status: 'valid', isLocal: true }),
      ]
      const result = getSkillItemVisibility('cursor', makeSkill(symlinks))

      expect(result.showUnlinkButton).toBe(true)
      expect(result.selectedAgentSymlink).toBeNull()
      expect(result.selectedLocalSkillInfo).toBe(symlinks[0])
    })

    it('detects local skill when isLocal=true for selected agent', () => {
      const symlinks = [
        makeSymlink({ agentId: 'cursor', status: 'valid', isLocal: true }),
      ]
      const result = getSkillItemVisibility('cursor', makeSkill(symlinks))

      expect(result.isLocalSkill).toBe(true)
      expect(result.isLinked).toBe(false)
      expect(result.selectedLocalSkillInfo).toBe(symlinks[0])
    })

    it('isLocalSkill is false for symlinked skills', () => {
      const symlinks = [
        makeSymlink({ agentId: 'cursor', status: 'valid', isLocal: false }),
      ]
      const result = getSkillItemVisibility('cursor', makeSkill(symlinks))

      expect(result.isLocalSkill).toBe(false)
      expect(result.isLinked).toBe(true)
      expect(result.selectedLocalSkillInfo).toBeNull()
    })

    it('isLocalSkill is false in global view', () => {
      const symlinks = [
        makeSymlink({ agentId: 'cursor', status: 'valid', isLocal: true }),
      ]
      const result = getSkillItemVisibility(null, makeSkill(symlinks))

      expect(result.isLocalSkill).toBe(false)
      expect(result.selectedLocalSkillInfo).toBeNull()
    })

    it('hides unlink button for missing symlinks', () => {
      const symlinks = [
        makeSymlink({ agentId: 'cursor', status: 'missing', isLocal: false }),
      ]
      const result = getSkillItemVisibility('cursor', makeSkill(symlinks))

      expect(result.showUnlinkButton).toBe(false)
    })
  })

  describe('showCopyButton', () => {
    it('returns false when no agent is selected (global view)', () => {
      const symlinks = [
        makeSymlink({ agentId: 'cursor', status: 'valid', isLocal: false }),
      ]
      const result = getSkillItemVisibility(null, makeSkill(symlinks))
      expect(result.showCopyButton).toBe(false)
    })

    it('returns false when selected agent has no symlink for the skill', () => {
      const symlinks = [
        makeSymlink({ agentId: 'cursor', status: 'valid', isLocal: false }),
      ]
      const result = getSkillItemVisibility('codex', makeSkill(symlinks))
      expect(result.showCopyButton).toBe(false)
    })

    it('returns true when a specific agent is selected with a valid symlink', () => {
      const symlinks = [
        makeSymlink({ agentId: 'cursor', status: 'valid', isLocal: false }),
      ]
      const result = getSkillItemVisibility('cursor', makeSkill(symlinks))
      expect(result.showCopyButton).toBe(true)
    })

    it('returns true when a specific agent is selected with a local skill', () => {
      const symlinks = [
        makeSymlink({ agentId: 'cursor', status: 'valid', isLocal: true }),
      ]
      const result = getSkillItemVisibility('cursor', makeSkill(symlinks))
      expect(result.showCopyButton).toBe(true)
    })

    it('returns false when agent is selected but no symlink exists for that agent', () => {
      const symlinks = [
        makeSymlink({ agentId: 'codex', status: 'valid', isLocal: false }),
      ]
      const result = getSkillItemVisibility('cursor', makeSkill(symlinks))
      expect(result.showCopyButton).toBe(false)
    })
  })

  describe('showGStackBadge', () => {
    it('shows badge for gstack-backed symlink in supported agent view', () => {
      const symlinks = [
        makeSymlink({
          agentId: 'claude-code',
          targetPath: '/Users/me/.claude/skills/gstack/task',
          linkPath: '/Users/me/.claude/skills/task',
          isLocal: false,
          status: 'valid',
        }),
      ]

      const result = getSkillItemVisibility('claude-code', makeSkill(symlinks))
      expect(result.showGStackBadge).toBe(true)
    })

    it('shows badge for codex-managed gstack symlinks (multi-agent coverage)', () => {
      // symlinkChecker resolves relative readlink results to absolute paths
      // before populating `targetPath`, so the renderer always sees the
      // resolved form (e.g. `/Users/me/.codex/skills/gstack/task`). This
      // guards multi-agent coverage of GSTACK_BADGE_AGENT_IDS — earlier
      // versions only matched on `claude-code`.
      const symlinks = [
        makeSymlink({
          agentId: 'codex',
          targetPath: '/Users/me/.codex/skills/gstack/task',
          linkPath: '/Users/me/.codex/skills/task',
          isLocal: false,
          status: 'valid',
        }),
      ]

      const result = getSkillItemVisibility('codex', makeSkill(symlinks))
      expect(result.showGStackBadge).toBe(true)
    })

    it('hides badge in global view even when gstack path exists', () => {
      const symlinks = [
        makeSymlink({
          agentId: 'claude-code',
          targetPath: '/Users/me/.claude/skills/gstack/task',
          isLocal: false,
          status: 'valid',
        }),
      ]

      const result = getSkillItemVisibility(null, makeSkill(symlinks))
      expect(result.showGStackBadge).toBe(false)
    })

    it('hides badge for non-supported agents', () => {
      const symlinks = [
        makeSymlink({
          agentId: 'gemini-cli',
          targetPath: '/Users/me/.gemini/skills/gstack/task',
          linkPath: '/Users/me/.gemini/skills/task',
          isLocal: false,
          status: 'valid',
        }),
      ]

      const result = getSkillItemVisibility('gemini-cli', makeSkill(symlinks))
      expect(result.showGStackBadge).toBe(false)
    })

    it('shows badge for local skill whose SKILL.md symlinks into gstack tree', () => {
      // Real production case: ~/.claude/skills/ship/ is a real folder whose
      // only entry is a SKILL.md symlink into ~/.claude/skills/gstack/ship/.
      // Neither the linkPath (the real folder) nor any agent symlink contains
      // the "gstack" segment — only the resolved SKILL.md target does.
      // Without the fourth candidate, the badge would be hidden.
      const symlinks = [
        makeSymlink({
          agentId: 'claude-code',
          linkPath: '/Users/me/.claude/skills/ship' as AbsolutePath,
          isLocal: true,
          status: 'valid',
          targetPath: undefined,
          skillMdSymlinkTarget:
            '/Users/me/.claude/skills/gstack/ship/SKILL.md' as AbsolutePath,
        }),
      ]

      const result = getSkillItemVisibility('claude-code', makeSkill(symlinks))
      expect(result.showGStackBadge).toBe(true)
    })

    it('hides badge when SKILL.md target does not contain the gstack segment', () => {
      // A user-installed local skill whose SKILL.md happens to be a symlink
      // into a different location (not gstack) — no badge should show.
      const symlinks = [
        makeSymlink({
          agentId: 'claude-code',
          linkPath: '/Users/me/.claude/skills/custom' as AbsolutePath,
          isLocal: true,
          status: 'valid',
          targetPath: undefined,
          skillMdSymlinkTarget:
            '/Users/me/projects/my-skills/custom/SKILL.md' as AbsolutePath,
        }),
      ]

      const result = getSkillItemVisibility('claude-code', makeSkill(symlinks))
      expect(result.showGStackBadge).toBe(false)
    })

    it('falls back to existing candidates when skillMdSymlinkTarget is undefined (regression)', () => {
      // Guards the existing 3-candidate path — agent symlink whose targetPath
      // contains "gstack" must still flip the badge on, exactly as before.
      // skillMdSymlinkTarget defaults to undefined via makeSkill(), simulating
      // a Skill record produced before the new field landed.
      const symlinks = [
        makeSymlink({
          agentId: 'claude-code',
          targetPath: '/Users/me/.claude/skills/gstack/task' as AbsolutePath,
          linkPath: '/Users/me/.claude/skills/task' as AbsolutePath,
          isLocal: false,
          status: 'valid',
        }),
      ]

      const result = getSkillItemVisibility('claude-code', makeSkill(symlinks))
      expect(result.showGStackBadge).toBe(true)
    })
  })

  describe('orphan skill guard', () => {
    // PR #131 (issue #71 PR-2) loosens the orphan gate on Delete and Unlink
    // so users can sweep orphans surfaced by the new amber-border row UI.
    // Add stays gated because there is no live source to point a new
    // symlink at. The original #127 hide-everything stance is gone.
    it('shows global delete button for orphan-only skill so user can sweep the row', () => {
      // Source removed, broken symlinks across two agents, no real folders.
      // Delete clears all dangling agent symlinks plus the now-empty source
      // tombstone in one shot — the bulk version of the Cleanup-per-agent
      // flow.
      const symlinks = [
        makeSymlink({ agentId: 'cursor', status: 'broken', isLocal: false }),
        makeSymlink({ agentId: 'codex', status: 'broken', isLocal: false }),
      ]
      const result = getSkillItemVisibility(null, makeSkill(symlinks))

      expect(result.showDeleteButton).toBe(true)
    })

    it('keeps global delete button visible when at least one agent has a valid copy', () => {
      const symlinks = [
        makeSymlink({ agentId: 'cursor', status: 'valid', isLocal: false }),
        makeSymlink({ agentId: 'codex', status: 'broken', isLocal: false }),
      ]
      const result = getSkillItemVisibility(null, makeSkill(symlinks))

      expect(result.showDeleteButton).toBe(true)
    })

    it('keeps global delete button visible when at least one agent has a local copy', () => {
      const symlinks = [
        makeSymlink({ agentId: 'cursor', status: 'broken', isLocal: false }),
        makeSymlink({ agentId: 'codex', status: 'valid', isLocal: true }),
      ]
      const result = getSkillItemVisibility(null, makeSkill(symlinks))

      expect(result.showDeleteButton).toBe(true)
    })

    it('global Delete is shown regardless of explicit isOrphan override', () => {
      // After the loosen, Delete is purely a global-view concern (`!selectedAgentId`).
      // The explicit isOrphan override no longer suppresses it — the override
      // only steers Add visibility now.
      const symlinks = [
        makeSymlink({ agentId: 'cursor', status: 'valid', isLocal: false }),
      ]
      const result = getSkillItemVisibility(
        null,
        makeSkill(symlinks, { isOrphan: true }),
      )
      expect(result.showDeleteButton).toBe(true)
      // …and the orphan override DOES still gate Add as designed.
      expect(result.showAddButton).toBe(false)
    })

    it('hides Add button for orphan skill in global view', () => {
      // Add (AddSymlinkModal / CopyToAgentsModal) requires a live source
      // dir to symlink _to_; for orphans the source is gone.
      const symlinks = [
        makeSymlink({ agentId: 'cursor', status: 'broken', isLocal: false }),
        makeSymlink({ agentId: 'codex', status: 'broken', isLocal: false }),
      ]
      const result = getSkillItemVisibility(null, makeSkill(symlinks))

      expect(result.showAddButton).toBe(false)
    })

    it('hides Add but shows Unlink for orphan skill in agent view', () => {
      const symlinks = [
        makeSymlink({ agentId: 'cursor', status: 'broken', isLocal: false }),
        makeSymlink({ agentId: 'codex', status: 'broken', isLocal: false }),
      ]
      const result = getSkillItemVisibility('cursor', makeSkill(symlinks))

      // Add stays gated: even though the broken cursor entry passes the
      // `valid|broken` filter, there is no live source to symlink TO.
      expect(result.showAddButton).toBe(false)
      // Unlink is the per-agent cleanup affordance for orphan rows.
      expect(result.showUnlinkButton).toBe(true)
      // Copy fans out from the live source skill — same reason Add is
      // hidden, this must be hidden too. Without this assertion the
      // context-menu Copy entry leaks through and lands the user in
      // CopyToAgentsModal with no source to copy from.
      expect(result.showCopyButton).toBe(false)
    })

    it('keeps Add button visible when isOrphan is false (non-orphan, valid symlinks)', () => {
      // Sanity check: the && !isOrphan term must NOT regress the
      // happy path where Add was always available.
      const symlinks = [
        makeSymlink({ agentId: 'cursor', status: 'valid', isLocal: false }),
      ]
      const globalResult = getSkillItemVisibility(null, makeSkill(symlinks))
      expect(globalResult.showAddButton).toBe(true)

      const agentResult = getSkillItemVisibility('cursor', makeSkill(symlinks))
      expect(agentResult.showAddButton).toBe(true)
    })
  })

  describe('regression: dual delete buttons', () => {
    it('never shows both delete button and unlink button simultaneously', () => {
      // This was the bug: both X (delete) and Trash (unlink) showed in agent view
      const symlinks = [
        makeSymlink({ agentId: 'cursor', status: 'valid', isLocal: false }),
      ]
      const result = getSkillItemVisibility('cursor', makeSkill(symlinks))

      // When agent is selected, delete must be hidden
      expect(result.showDeleteButton).toBe(false)
      expect(result.showUnlinkButton).toBe(true)
    })

    it('delete and unlink are mutually exclusive for all agent ids', () => {
      const symlinks = [
        makeSymlink({
          agentId: 'claude-code',
          status: 'valid',
          isLocal: false,
        }),
      ]

      // With agent selected
      const agentView = getSkillItemVisibility(
        'claude-code',
        makeSkill(symlinks),
      )
      expect(agentView.showDeleteButton && agentView.showUnlinkButton).toBe(
        false,
      )

      // Without agent selected
      const globalView = getSkillItemVisibility(null, makeSkill(symlinks))
      expect(globalView.showDeleteButton && globalView.showUnlinkButton).toBe(
        false,
      )
    })
  })
})
