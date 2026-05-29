import { describe, expect, it } from 'vitest'

import type { AgentId, Skill, SymlinkInfo } from '@/shared/types'

import { getLocationViewModel } from './getLocationViewModel'

const makeSymlink = (
  agentId: AgentId,
  linkPath: SymlinkInfo['linkPath'],
  targetPath: SymlinkInfo['targetPath'],
  isLocal = false,
): SymlinkInfo => ({
  agentId,
  agentName: agentId as SymlinkInfo['agentName'],
  status: 'valid',
  targetPath,
  linkPath,
  isLocal,
})

const makeSkill = (
  path: Skill['path'],
  symlinks: SymlinkInfo[],
  isSource = true,
): Skill => ({
  name: 'foo',
  description: 'foo skill',
  path,
  symlinkCount: symlinks.filter((s) => s.status === 'valid').length,
  symlinks,
  isSource,
  isOrphan: false,
})

describe('getLocationViewModel', () => {
  it('shows only the source path when no agent is selected', () => {
    // Arrange — a sourced skill linked into opencode, but nothing selected
    const skill = makeSkill('/u/me/.agents/skills/foo', [
      makeSymlink(
        'opencode',
        '/u/me/.opencode/skills/foo',
        '/u/me/.agents/skills/foo',
      ),
    ])

    // Act
    const viewModel = getLocationViewModel(skill, null)

    // Assert — with no selection there is no agent symlink to surface
    expect(viewModel).toEqual({
      sourcePath: '/u/me/.agents/skills/foo',
      symlinkPath: undefined,
    })
  })

  it('shows only the source path when the selected agent has no symlink for this skill', () => {
    // Arrange — skill is linked into opencode but the selected agent is cursor
    const skill = makeSkill('/u/me/.agents/skills/foo', [
      makeSymlink(
        'opencode',
        '/u/me/.opencode/skills/foo',
        '/u/me/.agents/skills/foo',
      ),
    ])

    // Act
    const viewModel = getLocationViewModel(skill, 'cursor')

    // Assert — cursor has no link here, so no symlink path is shown
    expect(viewModel).toEqual({
      sourcePath: '/u/me/.agents/skills/foo',
      symlinkPath: undefined,
    })
  })

  it('hides the symlink path for a local skill whose link path equals its own path', () => {
    // Arrange — a local (non-sourced) cursor skill that links to itself
    const skill = makeSkill(
      '/u/me/.cursor/skills/foo',
      [
        makeSymlink(
          'cursor',
          '/u/me/.cursor/skills/foo',
          '/u/me/.cursor/skills/foo',
          true,
        ),
      ],
      false,
    )

    // Act
    const viewModel = getLocationViewModel(skill, 'cursor')

    // Assert — a self-referential local link is not shown as a separate path
    expect(viewModel).toEqual({
      sourcePath: '/u/me/.cursor/skills/foo',
      symlinkPath: undefined,
    })
  })

  it('shows the symlink path when the selected agent links to a different path', () => {
    // Arrange — skill sourced in .agents and linked into both opencode and claude
    const skill = makeSkill('/u/me/.agents/skills/foo', [
      makeSymlink(
        'opencode',
        '/u/me/.opencode/skills/foo',
        '/u/me/.agents/skills/foo',
      ),
      makeSymlink(
        'claude-code',
        '/u/me/.claude/skills/foo',
        '/u/me/.agents/skills/foo',
      ),
    ])

    // Act
    const viewModel = getLocationViewModel(skill, 'opencode')

    // Assert — opencode's distinct link path surfaces alongside the source
    expect(viewModel).toEqual({
      sourcePath: '/u/me/.agents/skills/foo',
      symlinkPath: '/u/me/.opencode/skills/foo',
    })
  })
})
