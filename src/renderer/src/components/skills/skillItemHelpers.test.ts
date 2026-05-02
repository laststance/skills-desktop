import { describe, expect, it } from 'vitest'

import type {
  AbsolutePath,
  AgentId,
  Skill,
  SymlinkInfo,
} from '../../../../shared/types'

import { getSkillItemVisibility } from './skillItemHelpers'

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
 * needs to assert the inverse.
 */
function makeSkill(
  symlinks: SymlinkInfo[],
  overrides?: Partial<Pick<Skill, 'isOrphan'>>,
): Pick<Skill, 'symlinks' | 'isOrphan'> {
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

    it('hides unlink button for orphan-only broken symlink (no usable copy anywhere)', () => {
      // A skill whose every entry is broken/missing has no source — issue #127
      // Option B fix routes orphans to a separate cleanup flow (#71), so the
      // existing X button must not surface (its IPC handlers don't support
      // orphan removal cleanly).
      const symlinks = [
        makeSymlink({ agentId: 'cursor', status: 'broken', isLocal: false }),
      ]
      const result = getSkillItemVisibility('cursor', makeSkill(symlinks))

      expect(result.showUnlinkButton).toBe(false)
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

    it('shows badge for relative gstack symlink targets', () => {
      const symlinks = [
        makeSymlink({
          agentId: 'codex',
          targetPath: '../gstack/task',
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
  })

  describe('orphan skill guard (issue #127)', () => {
    it('hides global delete button for orphan-only skill', () => {
      // Source removed, broken symlinks across two agents, no real folders.
      const symlinks = [
        makeSymlink({ agentId: 'cursor', status: 'broken', isLocal: false }),
        makeSymlink({ agentId: 'codex', status: 'broken', isLocal: false }),
      ]
      const result = getSkillItemVisibility(null, makeSkill(symlinks))

      expect(result.showDeleteButton).toBe(false)
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
