import { describe, expect, it } from 'vitest'

import type { AgentId, Skill, SymlinkInfo } from '../../../shared/types'

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
})

describe('getLocationViewModel', () => {
  it('omits symlinkPath when no agent is selected', () => {
    const skill = makeSkill('/u/me/.agents/skills/foo', [
      makeSymlink(
        'opencode',
        '/u/me/.opencode/skills/foo',
        '/u/me/.agents/skills/foo',
      ),
    ])

    expect(getLocationViewModel(skill, null)).toEqual({
      sourcePath: '/u/me/.agents/skills/foo',
      symlinkPath: undefined,
    })
  })

  it('omits symlinkPath when the selected agent has no symlink for this skill', () => {
    const skill = makeSkill('/u/me/.agents/skills/foo', [
      makeSymlink(
        'opencode',
        '/u/me/.opencode/skills/foo',
        '/u/me/.agents/skills/foo',
      ),
    ])

    expect(getLocationViewModel(skill, 'cursor')).toEqual({
      sourcePath: '/u/me/.agents/skills/foo',
      symlinkPath: undefined,
    })
  })

  it('omits symlinkPath for a local skill where linkPath equals skill.path', () => {
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

    expect(getLocationViewModel(skill, 'cursor')).toEqual({
      sourcePath: '/u/me/.cursor/skills/foo',
      symlinkPath: undefined,
    })
  })

  it('returns symlinkPath when the selected agent links to a different path', () => {
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

    expect(getLocationViewModel(skill, 'opencode')).toEqual({
      sourcePath: '/u/me/.agents/skills/foo',
      symlinkPath: '/u/me/.opencode/skills/foo',
    })
  })
})
