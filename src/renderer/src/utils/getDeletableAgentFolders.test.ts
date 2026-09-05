import { describe, expect, it } from 'vitest'

import type { Agent } from '@/shared/types'

import { getDeletableAgentFolders } from './getDeletableAgentFolders'

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
    const agents = getDeletableAgentFolders(hiddenAgents)

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
    const agents = getDeletableAgentFolders(hiddenAgents)

    // Assert
    expect(agents).toEqual([])
    expect(getDeletableAgentFolders([hiddenAgents[0]])).toEqual([])
  })

  it('includes Cline and Warp own folders despite their universal install destination', () => {
    // Arrange
    const hiddenAgents: Agent[] = [
      { ...hiddenAgent, id: 'cline', path: '/Users/test/.cline/skills' },
      { ...hiddenAgent, id: 'warp', path: '/Users/test/.warp/skills' },
    ]

    // Act
    const agents = getDeletableAgentFolders(hiddenAgents)

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
    const agents = getDeletableAgentFolders(hiddenAgents)

    // Assert
    expect(agents).toEqual([])
  })
})

describe('not-installed agent empty-parent eligibility', () => {
  const emptyParentFolder: NonNullable<Agent['emptyParentFolder']> = {
    path: '/Users/test/.cline',
    filesystemIdentity: {
      kind: 'directory',
      dev: 1,
      ino: 2,
      size: 96,
      ctimeMs: 3,
      mtimeMs: 4,
    },
  }
  const unusedAgent: Agent = {
    ...hiddenAgent,
    id: 'cline',
    name: 'Cline',
    path: '/Users/test/.cline/skills',
    exists: false,
    filesystemIdentity: undefined,
    emptyParentFolder,
  }

  it('includes only a reviewed empty parent whose skills folder is absent', () => {
    // Arrange
    const candidates = [
      unusedAgent,
      { ...unusedAgent, id: 'cursor' as const, exists: true },
      { ...unusedAgent, id: 'codex' as const, emptyParentFolder: undefined },
    ]

    // Act
    const agents = getDeletableAgentFolders(candidates, 'unused')

    // Assert
    expect(agents.map((agent) => agent.id)).toEqual(['cline'])
  })

  it.each(['symlink', 'file'] as const)(
    'keeps a reviewed %s out of empty-parent deletion',
    (kind) => {
      // Arrange
      const candidate: Agent = {
        ...unusedAgent,
        emptyParentFolder: {
          ...emptyParentFolder,
          filesystemIdentity: { ...emptyParentFolder.filesystemIdentity, kind },
        },
      }

      // Act
      const agents = getDeletableAgentFolders([candidate], 'unused')

      // Assert
      expect(agents).toEqual([])
    },
  )

  it('keeps shared Amp and Replit parents out of empty-parent deletion', () => {
    // Arrange
    const candidates: Agent[] = [
      { ...unusedAgent, id: 'amp' },
      { ...unusedAgent, id: 'replit' },
    ]

    // Act
    const agents = getDeletableAgentFolders(candidates, 'unused')

    // Assert
    expect(agents).toEqual([])
  })
})
