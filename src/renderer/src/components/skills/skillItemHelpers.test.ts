import { describe, expect, it } from 'vitest'

import type { AgentId, SymlinkInfo } from '../../../../shared/types'

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
    targetPath: '/target',
    linkPath: '/link',
    isLocal: false,
    ...overrides,
  }
}

describe('getSkillItemVisibility', () => {
  describe('global view (no agent selected)', () => {
    it('shows delete and add buttons, hides unlink', () => {
      const result = getSkillItemVisibility(null, [])

      expect(result.showDeleteButton).toBe(true)
      expect(result.showAddButton).toBe(true)
      expect(result.showUnlinkButton).toBe(false)
      expect(result.isLinked).toBe(false)
      expect(result.selectedAgentSymlink).toBeNull()
    })

    it('shows delete and add even when symlinks exist', () => {
      const symlinks = [makeSymlink({ agentId: 'cursor' })]
      const result = getSkillItemVisibility(null, symlinks)

      expect(result.showDeleteButton).toBe(true)
      expect(result.showAddButton).toBe(true)
      expect(result.showUnlinkButton).toBe(false)
    })
  })

  describe('agent filtered view (agent selected)', () => {
    it('hides delete and add buttons when agent is selected', () => {
      const result = getSkillItemVisibility('cursor', [])

      expect(result.showDeleteButton).toBe(false)
      expect(result.showAddButton).toBe(false)
    })

    it('shows unlink button when valid symlink exists for selected agent', () => {
      const symlinks = [
        makeSymlink({ agentId: 'cursor', status: 'valid', isLocal: false }),
      ]
      const result = getSkillItemVisibility('cursor', symlinks)

      expect(result.showUnlinkButton).toBe(true)
      expect(result.isLinked).toBe(true)
      expect(result.selectedAgentSymlink).toBe(symlinks[0])
    })

    it('shows unlink button for broken symlink (but isLinked is false)', () => {
      const symlinks = [
        makeSymlink({ agentId: 'cursor', status: 'broken', isLocal: false }),
      ]
      const result = getSkillItemVisibility('cursor', symlinks)

      expect(result.showUnlinkButton).toBe(true)
      expect(result.isLinked).toBe(false)
    })

    it('hides unlink button when no symlink for selected agent', () => {
      const symlinks = [
        makeSymlink({ agentId: 'codex', status: 'valid', isLocal: false }),
      ]
      const result = getSkillItemVisibility('cursor', symlinks)

      expect(result.showUnlinkButton).toBe(false)
      expect(result.selectedAgentSymlink).toBeNull()
    })

    it('hides unlink button for local skills (isLocal=true)', () => {
      const symlinks = [
        makeSymlink({ agentId: 'cursor', status: 'valid', isLocal: true }),
      ]
      const result = getSkillItemVisibility('cursor', symlinks)

      expect(result.showUnlinkButton).toBe(false)
      expect(result.selectedAgentSymlink).toBeNull()
    })

    it('detects local skill when isLocal=true for selected agent', () => {
      const symlinks = [
        makeSymlink({ agentId: 'cursor', status: 'valid', isLocal: true }),
      ]
      const result = getSkillItemVisibility('cursor', symlinks)

      expect(result.isLocalSkill).toBe(true)
      expect(result.isLinked).toBe(false)
    })

    it('isLocalSkill is false for symlinked skills', () => {
      const symlinks = [
        makeSymlink({ agentId: 'cursor', status: 'valid', isLocal: false }),
      ]
      const result = getSkillItemVisibility('cursor', symlinks)

      expect(result.isLocalSkill).toBe(false)
      expect(result.isLinked).toBe(true)
    })

    it('isLocalSkill is false in global view', () => {
      const symlinks = [
        makeSymlink({ agentId: 'cursor', status: 'valid', isLocal: true }),
      ]
      const result = getSkillItemVisibility(null, symlinks)

      expect(result.isLocalSkill).toBe(false)
    })

    it('hides unlink button for missing symlinks', () => {
      const symlinks = [
        makeSymlink({ agentId: 'cursor', status: 'missing', isLocal: false }),
      ]
      const result = getSkillItemVisibility('cursor', symlinks)

      expect(result.showUnlinkButton).toBe(false)
    })
  })

  describe('regression: dual delete buttons', () => {
    it('never shows both delete button and unlink button simultaneously', () => {
      // This was the bug: both X (delete) and Trash (unlink) showed in agent view
      const symlinks = [
        makeSymlink({ agentId: 'cursor', status: 'valid', isLocal: false }),
      ]
      const result = getSkillItemVisibility('cursor', symlinks)

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
      const agentView = getSkillItemVisibility('claude-code', symlinks)
      expect(agentView.showDeleteButton && agentView.showUnlinkButton).toBe(
        false,
      )

      // Without agent selected
      const globalView = getSkillItemVisibility(null, symlinks)
      expect(globalView.showDeleteButton && globalView.showUnlinkButton).toBe(
        false,
      )
    })
  })
})
