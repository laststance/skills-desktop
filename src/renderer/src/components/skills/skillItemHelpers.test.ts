import { describe, expect, it } from 'vitest'

import type { AbsolutePath, AgentId, Skill, SymlinkInfo } from '@/shared/types'

import {
  getCardContentPaddingClass,
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
    it('offers Delete and Add but no Unlink in the global view of a skill with no symlinks', () => {
      // Arrange — global view (no agent selected), skill with no symlinks.
      // Act
      const result = getSkillItemVisibility(null, makeSkill([]))

      // Assert
      expect(result.showDeleteButton).toBe(true)
      expect(result.showAddButton).toBe(true)
      expect(result.showUnlinkButton).toBe(false)
      expect(result.isLinked).toBe(false)
      expect(result.selectedAgentSymlink).toBeNull()
      expect(result.selectedLocalSkillInfo).toBeNull()
    })

    it('keeps Delete and Add (still no Unlink) in the global view even when symlinks exist', () => {
      // Arrange — global view, skill with an existing symlink.
      const symlinks = [makeSymlink({ agentId: 'cursor' })]

      // Act
      const result = getSkillItemVisibility(null, makeSkill(symlinks))

      // Assert
      expect(result.showDeleteButton).toBe(true)
      expect(result.showAddButton).toBe(true)
      expect(result.showUnlinkButton).toBe(false)
    })
  })

  describe('agent filtered view (agent selected)', () => {
    it('hides both Delete and Add when the selected agent has no copy of the skill', () => {
      // Arrange — an agent is selected but the skill has no symlinks for it.
      // Act
      const result = getSkillItemVisibility('cursor', makeSkill([]))

      // Assert
      expect(result.showDeleteButton).toBe(false)
      expect(result.showAddButton).toBe(false)
    })

    it('offers Add when the selected agent already has a valid symlink', () => {
      // Arrange — selected agent has a valid (non-local) symlink.
      const symlinks = [
        makeSymlink({ agentId: 'cursor', status: 'valid', isLocal: false }),
      ]

      // Act
      const result = getSkillItemVisibility('cursor', makeSkill(symlinks))

      // Assert
      expect(result.showAddButton).toBe(true)
    })

    it('offers Add when the selected agent has a local copy of the skill', () => {
      // Arrange — selected agent has a local skill.
      const symlinks = [
        makeSymlink({ agentId: 'cursor', status: 'valid', isLocal: true }),
      ]

      // Act
      const result = getSkillItemVisibility('cursor', makeSkill(symlinks))

      // Assert
      expect(result.showAddButton).toBe(true)
    })

    it('offers Unlink and marks the skill linked when the selected agent has a valid symlink', () => {
      // Arrange — selected agent has a valid (non-local) symlink.
      const symlinks = [
        makeSymlink({ agentId: 'cursor', status: 'valid', isLocal: false }),
      ]

      // Act
      const result = getSkillItemVisibility('cursor', makeSkill(symlinks))

      // Assert
      expect(result.showUnlinkButton).toBe(true)
      expect(result.isLinked).toBe(true)
      expect(result.selectedAgentSymlink).toBe(symlinks[0])
    })

    it('hides normal unlink for orphan-only broken symlink so reviewed cleanup owns it', () => {
      // Broken rows can become live after scan. The normal per-row unlink
      // lacks reviewed target revalidation, so cleanup must route through the
      // exact broken-slot IPC instead of this generic affordance.
      // Arrange — selected agent has only a broken symlink.
      const symlinks = [
        makeSymlink({ agentId: 'cursor', status: 'broken', isLocal: false }),
      ]

      // Act
      const result = getSkillItemVisibility('cursor', makeSkill(symlinks))

      // Assert
      expect(result.showUnlinkButton).toBe(false)
      // isLinked still requires status==='valid'; broken does NOT count as
      // linked.
      expect(result.isLinked).toBe(false)
    })

    it('hides normal unlink for broken symlink even when another agent has a valid copy', () => {
      // Live source skill with one healthy and one broken agent link — the
      // source exists, but the reviewed link path can still be stale by the
      // time the user clicks. The cleanup IPC owns the safe path.
      // Arrange — selected agent broken, another agent valid.
      const symlinks = [
        makeSymlink({ agentId: 'cursor', status: 'broken', isLocal: false }),
        makeSymlink({ agentId: 'codex', status: 'valid', isLocal: false }),
      ]

      // Act
      const result = getSkillItemVisibility('cursor', makeSkill(symlinks))

      // Assert
      expect(result.showUnlinkButton).toBe(false)
      expect(result.isLinked).toBe(false)
    })

    it('hides Add and Copy when the selected agent row is broken', () => {
      // The source exists through another agent, but Cursor's visible row is a
      // broken slot. Add/Copy would route through a generic source-copy flow
      // instead of the reviewed cleanup path for this exact broken link.
      // Arrange — selected agent broken, another agent valid.
      const symlinks = [
        makeSymlink({ agentId: 'cursor', status: 'broken', isLocal: false }),
        makeSymlink({ agentId: 'codex', status: 'valid', isLocal: false }),
      ]

      // Act
      const result = getSkillItemVisibility('cursor', makeSkill(symlinks))

      // Assert
      expect(result.showAddButton).toBe(false)
      expect(result.showCopyButton).toBe(false)
    })

    it('hides Unlink and exposes no selected symlink when the skill has none for the selected agent', () => {
      // Arrange — the skill is symlinked for a different agent, not the selected one.
      const symlinks = [
        makeSymlink({ agentId: 'codex', status: 'valid', isLocal: false }),
      ]

      // Act
      const result = getSkillItemVisibility('cursor', makeSkill(symlinks))

      // Assert
      expect(result.showUnlinkButton).toBe(false)
      expect(result.selectedAgentSymlink).toBeNull()
    })

    it('offers Unlink for a local skill and routes it through the local-skill slot, not the symlink slot', () => {
      // Arrange — selected agent has a local skill.
      const symlinks = [
        makeSymlink({ agentId: 'cursor', status: 'valid', isLocal: true }),
      ]

      // Act
      const result = getSkillItemVisibility('cursor', makeSkill(symlinks))

      // Assert
      expect(result.showUnlinkButton).toBe(true)
      expect(result.selectedAgentSymlink).toBeNull()
      expect(result.selectedLocalSkillInfo).toBe(symlinks[0])
    })

    it('flags a local skill as local (not linked) and surfaces its local-skill info for the selected agent', () => {
      // Arrange — selected agent has a local skill.
      const symlinks = [
        makeSymlink({ agentId: 'cursor', status: 'valid', isLocal: true }),
      ]

      // Act
      const result = getSkillItemVisibility('cursor', makeSkill(symlinks))

      // Assert
      expect(result.isLocalSkill).toBe(true)
      expect(result.isLinked).toBe(false)
      expect(result.selectedLocalSkillInfo).toBe(symlinks[0])
    })

    it('treats a symlinked skill as linked rather than local for the selected agent', () => {
      // Arrange — selected agent has a valid (non-local) symlink.
      const symlinks = [
        makeSymlink({ agentId: 'cursor', status: 'valid', isLocal: false }),
      ]

      // Act
      const result = getSkillItemVisibility('cursor', makeSkill(symlinks))

      // Assert
      expect(result.isLocalSkill).toBe(false)
      expect(result.isLinked).toBe(true)
      expect(result.selectedLocalSkillInfo).toBeNull()
    })

    it('never reports a local skill in the global view (local-skill state needs a selected agent)', () => {
      // Arrange — global view (no agent selected) over a local skill.
      const symlinks = [
        makeSymlink({ agentId: 'cursor', status: 'valid', isLocal: true }),
      ]

      // Act
      const result = getSkillItemVisibility(null, makeSkill(symlinks))

      // Assert
      expect(result.isLocalSkill).toBe(false)
      expect(result.selectedLocalSkillInfo).toBeNull()
    })

    it('hides Unlink for a missing symlink on the selected agent', () => {
      // Arrange — selected agent has a missing symlink.
      const symlinks = [
        makeSymlink({ agentId: 'cursor', status: 'missing', isLocal: false }),
      ]

      // Act
      const result = getSkillItemVisibility('cursor', makeSkill(symlinks))

      // Assert
      expect(result.showUnlinkButton).toBe(false)
    })

    it('hides normal unlink for inaccessible symlinks while keeping manual-review state visible', () => {
      // Arrange — selected agent has an inaccessible symlink.
      const symlinks = [
        makeSymlink({
          agentId: 'cursor',
          status: 'inaccessible',
          isLocal: false,
        }),
      ]

      // Act
      const result = getSkillItemVisibility('cursor', makeSkill(symlinks))

      // Assert
      expect(result.showUnlinkButton).toBe(false)
      expect(result.isInaccessibleSkill).toBe(true)
      expect(result.selectedAgentSymlink).toBe(symlinks[0])
    })

    it('hides Add and Copy for inaccessible symlinks so unverifiable targets cannot fan out', () => {
      // Arrange — selected agent has an inaccessible symlink.
      const symlinks = [
        makeSymlink({
          agentId: 'cursor',
          status: 'inaccessible',
          isLocal: false,
        }),
      ]

      // Act
      const result = getSkillItemVisibility('cursor', makeSkill(symlinks))

      // Assert
      expect(result.showAddButton).toBe(false)
      expect(result.showCopyButton).toBe(false)
      expect(result.isInaccessibleSkill).toBe(true)
    })
  })

  describe('showCopyButton', () => {
    it('hides Copy in the global view since there is no single agent to copy from', () => {
      // Arrange — global view (no agent selected) over a valid symlink.
      const symlinks = [
        makeSymlink({ agentId: 'cursor', status: 'valid', isLocal: false }),
      ]

      // Act
      const result = getSkillItemVisibility(null, makeSkill(symlinks))

      // Assert
      expect(result.showCopyButton).toBe(false)
    })

    it('hides Copy when the skill is symlinked for a different agent than the selected one', () => {
      // Arrange — skill is valid for cursor, but codex is selected.
      const symlinks = [
        makeSymlink({ agentId: 'cursor', status: 'valid', isLocal: false }),
      ]

      // Act
      const result = getSkillItemVisibility('codex', makeSkill(symlinks))

      // Assert
      expect(result.showCopyButton).toBe(false)
    })

    it('offers Copy when the selected agent has a valid symlink to copy from', () => {
      // Arrange — selected agent has a valid (non-local) symlink.
      const symlinks = [
        makeSymlink({ agentId: 'cursor', status: 'valid', isLocal: false }),
      ]

      // Act
      const result = getSkillItemVisibility('cursor', makeSkill(symlinks))

      // Assert
      expect(result.showCopyButton).toBe(true)
    })

    it('offers Copy when the selected agent has a local skill to copy from', () => {
      // Arrange — selected agent has a local skill.
      const symlinks = [
        makeSymlink({ agentId: 'cursor', status: 'valid', isLocal: true }),
      ]

      // Act
      const result = getSkillItemVisibility('cursor', makeSkill(symlinks))

      // Assert
      expect(result.showCopyButton).toBe(true)
    })

    it('hides Copy when the selected agent has no copy of the skill at all', () => {
      // Arrange — skill is valid for codex, but cursor is selected.
      const symlinks = [
        makeSymlink({ agentId: 'codex', status: 'valid', isLocal: false }),
      ]

      // Act
      const result = getSkillItemVisibility('cursor', makeSkill(symlinks))

      // Assert
      expect(result.showCopyButton).toBe(false)
    })
  })

  describe('showGStackBadge', () => {
    it('shows the G-Stack badge for a gstack-backed symlink in a supported agent view', () => {
      // Arrange — claude-code symlink whose target lives under a gstack tree.
      const symlinks = [
        makeSymlink({
          agentId: 'claude-code',
          targetPath: '/Users/me/.claude/skills/gstack/task',
          linkPath: '/Users/me/.claude/skills/task',
          isLocal: false,
          status: 'valid',
        }),
      ]

      // Act
      const result = getSkillItemVisibility('claude-code', makeSkill(symlinks))

      // Assert
      expect(result.showGStackBadge).toBe(true)
    })

    it('shows the G-Stack badge for codex-managed gstack symlinks too, not only claude-code', () => {
      // symlinkChecker resolves relative readlink results to absolute paths
      // before populating `targetPath`, so the renderer always sees the
      // resolved form (e.g. `/Users/me/.codex/skills/gstack/task`). This
      // guards multi-agent coverage of GSTACK_BADGE_AGENT_IDS — earlier
      // versions only matched on `claude-code`.
      // Arrange — codex symlink whose target lives under a gstack tree.
      const symlinks = [
        makeSymlink({
          agentId: 'codex',
          targetPath: '/Users/me/.codex/skills/gstack/task',
          linkPath: '/Users/me/.codex/skills/task',
          isLocal: false,
          status: 'valid',
        }),
      ]

      // Act
      const result = getSkillItemVisibility('codex', makeSkill(symlinks))

      // Assert
      expect(result.showGStackBadge).toBe(true)
    })

    it('hides the G-Stack badge in the global view even when a gstack path exists', () => {
      // Arrange — global view (no agent) over a gstack-backed symlink.
      const symlinks = [
        makeSymlink({
          agentId: 'claude-code',
          targetPath: '/Users/me/.claude/skills/gstack/task',
          isLocal: false,
          status: 'valid',
        }),
      ]

      // Act
      const result = getSkillItemVisibility(null, makeSkill(symlinks))

      // Assert
      expect(result.showGStackBadge).toBe(false)
    })

    it('hides the G-Stack badge for an agent that does not support gstack', () => {
      // Arrange — gemini-cli (unsupported) symlink under a gstack tree.
      const symlinks = [
        makeSymlink({
          agentId: 'gemini-cli',
          targetPath: '/Users/me/.gemini/skills/gstack/task',
          linkPath: '/Users/me/.gemini/skills/task',
          isLocal: false,
          status: 'valid',
        }),
      ]

      // Act
      const result = getSkillItemVisibility('gemini-cli', makeSkill(symlinks))

      // Assert
      expect(result.showGStackBadge).toBe(false)
    })

    it('shows the G-Stack badge for a local skill whose SKILL.md symlinks into the gstack tree', () => {
      // Real production case: ~/.claude/skills/ship/ is a real folder whose
      // only entry is a SKILL.md symlink into ~/.claude/skills/gstack/ship/.
      // Neither the linkPath (the real folder) nor any agent symlink contains
      // the "gstack" segment — only the resolved SKILL.md target does.
      // Without the fourth candidate, the badge would be hidden.
      // Arrange — local claude-code skill whose SKILL.md points into gstack.
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

      // Act
      const result = getSkillItemVisibility('claude-code', makeSkill(symlinks))

      // Assert
      expect(result.showGStackBadge).toBe(true)
    })

    it('hides the G-Stack badge when the SKILL.md target points somewhere other than the gstack tree', () => {
      // A user-installed local skill whose SKILL.md happens to be a symlink
      // into a different location (not gstack) — no badge should show.
      // Arrange — local claude-code skill whose SKILL.md points outside gstack.
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

      // Act
      const result = getSkillItemVisibility('claude-code', makeSkill(symlinks))

      // Assert
      expect(result.showGStackBadge).toBe(false)
    })

    it('still shows the G-Stack badge from the agent symlink target when skillMdSymlinkTarget is absent (legacy records)', () => {
      // Guards the existing 3-candidate path — agent symlink whose targetPath
      // contains "gstack" must still flip the badge on, exactly as before.
      // skillMdSymlinkTarget defaults to undefined via makeSkill(), simulating
      // a Skill record produced before the new field landed.
      // Arrange — claude-code gstack symlink with no skillMdSymlinkTarget.
      const symlinks = [
        makeSymlink({
          agentId: 'claude-code',
          targetPath: '/Users/me/.claude/skills/gstack/task' as AbsolutePath,
          linkPath: '/Users/me/.claude/skills/task' as AbsolutePath,
          isLocal: false,
          status: 'valid',
        }),
      ]

      // Act
      const result = getSkillItemVisibility('claude-code', makeSkill(symlinks))

      // Assert
      expect(result.showGStackBadge).toBe(true)
    })
  })

  describe('orphan skill guard', () => {
    // PR #131 (issue #71 PR-2) loosens the orphan gate on Delete and Unlink
    // so users can sweep orphans surfaced by the new amber-border row UI.
    // Add stays gated because there is no live source to point a new
    // symlink at. The original #127 hide-everything stance is gone.
    it('shows global Delete for an orphan-only skill so the user can sweep the dangling row', () => {
      // Source removed, broken symlinks across two agents, no real folders.
      // Delete clears all dangling agent symlinks plus the now-empty source
      // tombstone in one shot — the bulk version of the Cleanup-per-agent
      // flow.
      // Arrange — orphan skill: broken symlinks on two agents, no live source.
      const symlinks = [
        makeSymlink({ agentId: 'cursor', status: 'broken', isLocal: false }),
        makeSymlink({ agentId: 'codex', status: 'broken', isLocal: false }),
      ]

      // Act
      const result = getSkillItemVisibility(null, makeSkill(symlinks))

      // Assert
      expect(result.showDeleteButton).toBe(true)
    })

    it('keeps global Delete when at least one agent still holds a valid copy', () => {
      // Arrange — one valid and one broken agent symlink (not an orphan).
      const symlinks = [
        makeSymlink({ agentId: 'cursor', status: 'valid', isLocal: false }),
        makeSymlink({ agentId: 'codex', status: 'broken', isLocal: false }),
      ]

      // Act
      const result = getSkillItemVisibility(null, makeSkill(symlinks))

      // Assert
      expect(result.showDeleteButton).toBe(true)
    })

    it('keeps global Delete when at least one agent still holds a local copy', () => {
      // Arrange — one broken symlink and one local copy (not an orphan).
      const symlinks = [
        makeSymlink({ agentId: 'cursor', status: 'broken', isLocal: false }),
        makeSymlink({ agentId: 'codex', status: 'valid', isLocal: true }),
      ]

      // Act
      const result = getSkillItemVisibility(null, makeSkill(symlinks))

      // Assert
      expect(result.showDeleteButton).toBe(true)
    })

    it('keeps global Delete but still gates Add when a skill is explicitly marked orphan', () => {
      // After the loosen, Delete is purely a global-view concern (`!selectedAgentId`).
      // The explicit isOrphan override no longer suppresses it — the override
      // only steers Add visibility now.
      // Arrange — valid symlink but the skill is force-flagged isOrphan: true.
      const symlinks = [
        makeSymlink({ agentId: 'cursor', status: 'valid', isLocal: false }),
      ]

      // Act
      const result = getSkillItemVisibility(
        null,
        makeSkill(symlinks, { isOrphan: true }),
      )

      // Assert
      expect(result.showDeleteButton).toBe(true)
      // …and the orphan override DOES still gate Add as designed.
      expect(result.showAddButton).toBe(false)
    })

    it('hides Add for an orphan skill in the global view since there is no live source to link to', () => {
      // Add (AddSymlinkModal / CopyToAgentsModal) requires a live source
      // dir to symlink _to_; for orphans the source is gone.
      // Arrange — orphan skill: broken symlinks on two agents, no live source.
      const symlinks = [
        makeSymlink({ agentId: 'cursor', status: 'broken', isLocal: false }),
        makeSymlink({ agentId: 'codex', status: 'broken', isLocal: false }),
      ]

      // Act
      const result = getSkillItemVisibility(null, makeSkill(symlinks))

      // Assert
      expect(result.showAddButton).toBe(false)
    })

    it('hides Add, Unlink, and Copy for an orphan skill in the agent view', () => {
      // Arrange — orphan skill: broken symlinks on two agents, no live source.
      const symlinks = [
        makeSymlink({ agentId: 'cursor', status: 'broken', isLocal: false }),
        makeSymlink({ agentId: 'codex', status: 'broken', isLocal: false }),
      ]

      // Act
      const result = getSkillItemVisibility('cursor', makeSkill(symlinks))

      // Assert
      // Add stays gated: even though the broken cursor entry passes the
      // `valid|broken` filter, there is no live source to symlink TO.
      expect(result.showAddButton).toBe(false)
      // Reviewed cleanup owns broken symlink removal.
      expect(result.showUnlinkButton).toBe(false)
      // Copy fans out from the live source skill — same reason Add is
      // hidden, this must be hidden too. Without this assertion the
      // context-menu Copy entry leaks through and lands the user in
      // CopyToAgentsModal with no source to copy from.
      expect(result.showCopyButton).toBe(false)
    })

    it('keeps Add available in both views for a non-orphan skill with valid symlinks', () => {
      // Sanity check: the && !isOrphan term must NOT regress the
      // happy path where Add was always available.
      // Arrange — non-orphan skill with a single valid symlink.
      const symlinks = [
        makeSymlink({ agentId: 'cursor', status: 'valid', isLocal: false }),
      ]

      // Act
      const globalResult = getSkillItemVisibility(null, makeSkill(symlinks))
      const agentResult = getSkillItemVisibility('cursor', makeSkill(symlinks))

      // Assert
      expect(globalResult.showAddButton).toBe(true)
      expect(agentResult.showAddButton).toBe(true)
    })
  })

  describe('regression: dual delete buttons', () => {
    it('shows Unlink but not Delete in the agent view, never both X and Trash at once', () => {
      // This was the bug: both X (delete) and Trash (unlink) showed in agent view
      // Arrange — agent selected over a valid symlink.
      const symlinks = [
        makeSymlink({ agentId: 'cursor', status: 'valid', isLocal: false }),
      ]

      // Act
      const result = getSkillItemVisibility('cursor', makeSkill(symlinks))

      // Assert
      // When agent is selected, delete must be hidden
      expect(result.showDeleteButton).toBe(false)
      expect(result.showUnlinkButton).toBe(true)
    })

    it('never shows Delete and Unlink together, whether or not an agent is selected', () => {
      // Arrange — a valid symlink for claude-code.
      const symlinks = [
        makeSymlink({
          agentId: 'claude-code',
          status: 'valid',
          isLocal: false,
        }),
      ]

      // Act
      const agentView = getSkillItemVisibility(
        'claude-code',
        makeSkill(symlinks),
      )
      const globalView = getSkillItemVisibility(null, makeSkill(symlinks))

      // Assert
      expect(agentView.showDeleteButton && agentView.showUnlinkButton).toBe(
        false,
      )
      expect(globalView.showDeleteButton && globalView.showUnlinkButton).toBe(
        false,
      )
    })
  })
})

describe('getCardContentPaddingClass', () => {
  it('reserves the wide gutter so the Add control never overlaps a stacked bookmark + delete pair', () => {
    // Arrange — global-view repo skill: bookmark slides to right-11 (44px) and
    // the delete X sits at right-0 (44px), forming an 88px stack. This is the
    // exact state from the reported hover bug where "+ Add" slid under the
    // bookmark.
    const flags = {
      showBookmark: true,
      showUnlinkButton: false,
      showDeleteButton: true,
    }

    // Act
    const paddingClass = getCardContentPaddingClass(flags)

    // Assert — pr-24 (96px) clears the 88px stack with an 8px gap.
    expect(paddingClass).toBe('pr-24')
  })

  it('reserves the wide gutter when a bookmark stacks with the unlink button in agent view', () => {
    // Arrange — agent view, valid symlink: bookmark + unlink X also stack to 88px.
    const flags = {
      showBookmark: true,
      showUnlinkButton: true,
      showDeleteButton: false,
    }

    // Act
    const paddingClass = getCardContentPaddingClass(flags)

    // Assert
    expect(paddingClass).toBe('pr-24')
  })

  it('reserves a single-button gutter when only the bookmark shows', () => {
    // Arrange — bookmarkable skill whose agent row is broken: no X button, so
    // the bookmark sits alone at right-0 (one 44px overlay).
    const flags = {
      showBookmark: true,
      showUnlinkButton: false,
      showDeleteButton: false,
    }

    // Act
    const paddingClass = getCardContentPaddingClass(flags)

    // Assert — pr-14 (56px) clears one 44px button.
    expect(paddingClass).toBe('pr-14')
  })

  it('reserves a single-button gutter when only an X button shows (non-bookmarkable skill)', () => {
    // Arrange — local skill (no repo source → not bookmarkable) with an unlink X.
    const flags = {
      showBookmark: false,
      showUnlinkButton: true,
      showDeleteButton: false,
    }

    // Act
    const paddingClass = getCardContentPaddingClass(flags)

    // Assert
    expect(paddingClass).toBe('pr-14')
  })

  it('uses normal padding when no overlay buttons render', () => {
    // Arrange — no bookmark, no X (e.g. orphan row in agent view).
    const flags = {
      showBookmark: false,
      showUnlinkButton: false,
      showDeleteButton: false,
    }

    // Act
    const paddingClass = getCardContentPaddingClass(flags)

    // Assert — falls back to the default p-4 right padding.
    expect(paddingClass).toBe('pr-4')
  })
})
