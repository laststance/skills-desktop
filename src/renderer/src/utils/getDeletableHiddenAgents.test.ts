import { describe, expect, it } from 'vitest'

import type { Agent } from '@/shared/types'

import { getDeletableHiddenAgents } from './getDeletableHiddenAgents'

const hiddenAgent: Agent = {
  id: 'cursor',
  name: 'Cursor',
  path: '/Users/test/.cursor/skills',
  exists: true,
  skillCount: 0,
  localSkillCount: 0,
  filesystemIdentity: {
    kind: 'directory',
    dev: 1,
    ino: 2,
    size: 96,
    ctimeMs: 3,
    mtimeMs: 4,
  },
}

describe('hidden-agent bulk-delete eligibility', () => {
  it('includes an empty dedicated folder and skips an absent folder', () => {
    // Arrange
    const hiddenAgents: Agent[] = [
      hiddenAgent,
      { ...hiddenAgent, id: 'codex', exists: false },
    ]

    // Act
    const agents = getDeletableHiddenAgents(hiddenAgents)

    // Assert
    expect(agents.map((agent) => agent.id)).toEqual(['cursor'])
  })

  it('keeps the Amp and Replit shared skills directory out of bulk deletion', () => {
    // Arrange
    const hiddenAgents: Agent[] = [
      { ...hiddenAgent, id: 'amp', path: '/Users/test/.config/agents/skills' },
      {
        ...hiddenAgent,
        id: 'replit',
        path: '/Users/test/.config/agents/skills',
      },
    ]

    // Act
    const agents = getDeletableHiddenAgents(hiddenAgents)

    // Assert
    expect(agents).toEqual([])
    expect(getDeletableHiddenAgents([hiddenAgents[0]])).toEqual([])
  })

  it('includes Cline and Warp own folders despite their universal install destination', () => {
    // Arrange
    const hiddenAgents: Agent[] = [
      { ...hiddenAgent, id: 'cline', path: '/Users/test/.cline/skills' },
      { ...hiddenAgent, id: 'warp', path: '/Users/test/.warp/skills' },
    ]

    // Act
    const agents = getDeletableHiddenAgents(hiddenAgents)

    // Assert
    expect(agents.map((agent) => agent.id)).toEqual(['cline', 'warp'])
  })

  it('skips symlinked folders and folders without a reviewed directory identity', () => {
    // Arrange
    const hiddenAgents: Agent[] = [
      {
        ...hiddenAgent,
        filesystemIdentity: {
          kind: 'symlink',
          dev: 1,
          ino: 2,
          size: 20,
          ctimeMs: 3,
          mtimeMs: 4,
        },
      },
      { ...hiddenAgent, id: 'codex', filesystemIdentity: undefined },
    ]

    // Act
    const agents = getDeletableHiddenAgents(hiddenAgents)

    // Assert
    expect(agents).toEqual([])
  })
})
