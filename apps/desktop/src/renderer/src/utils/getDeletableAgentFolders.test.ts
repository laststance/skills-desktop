import { describe, expect, test } from 'vitest'

import type { Agent } from '@/shared/types'
import { toAbsolutePath, toFileSizeBytes, toSkillCount } from '@/shared/types'

import { getDeletableAgentFolders } from './getDeletableAgentFolders'

const hiddenAgent: Agent = {
  id: 'cursor',
  name: 'Cursor',
  path: toAbsolutePath('/Users/test/.cursor/skills'),
  exists: true,
  skillCount: toSkillCount(0),
  localSkillCount: toSkillCount(0),
  filesystemIdentity: {
    kind: 'directory',
    dev: 1,
    ino: 2,
    size: toFileSizeBytes(96),
    ctimeMs: 3,
    mtimeMs: 4,
  },
}

describe('hidden-agent bulk-delete eligibility', () => {
  test('includes an empty dedicated folder and skips an absent folder', () => {
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

  test('keeps the Amp and Replit shared skills directory out of bulk deletion', () => {
    // Arrange
    const hiddenAgents: Agent[] = [
      {
        ...hiddenAgent,
        id: 'amp',
        path: toAbsolutePath('/Users/test/.config/agents/skills'),
      },
      {
        ...hiddenAgent,
        id: 'replit',
        path: toAbsolutePath('/Users/test/.config/agents/skills'),
      },
    ]

    // Act
    const agents = getDeletableAgentFolders(hiddenAgents)

    // Assert
    expect(agents).toEqual([])
    expect(getDeletableAgentFolders([hiddenAgents[0]])).toEqual([])
  })

  test('includes Cline and Warp own folders despite their universal install destination', () => {
    // Arrange
    const hiddenAgents: Agent[] = [
      {
        ...hiddenAgent,
        id: 'cline',
        path: toAbsolutePath('/Users/test/.cline/skills'),
      },
      {
        ...hiddenAgent,
        id: 'warp',
        path: toAbsolutePath('/Users/test/.warp/skills'),
      },
    ]

    // Act
    const agents = getDeletableAgentFolders(hiddenAgents)

    // Assert
    expect(agents.map((agent) => agent.id)).toEqual(['cline', 'warp'])
  })

  test('skips symlinked folders and folders without a reviewed directory identity', () => {
    // Arrange
    const hiddenAgents: Agent[] = [
      {
        ...hiddenAgent,
        filesystemIdentity: {
          kind: 'symlink',
          dev: 1,
          ino: 2,
          size: toFileSizeBytes(20),
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
    path: toAbsolutePath('/Users/test/.cline'),
    filesystemIdentity: {
      kind: 'directory',
      dev: 1,
      ino: 2,
      size: toFileSizeBytes(96),
      ctimeMs: 3,
      mtimeMs: 4,
    },
  }
  const unusedAgent: Agent = {
    ...hiddenAgent,
    id: 'cline',
    name: 'Cline',
    path: toAbsolutePath('/Users/test/.cline/skills'),
    exists: false,
    filesystemIdentity: undefined,
    emptyParentFolder,
  }

  test('includes only a reviewed empty parent whose skills folder is absent', () => {
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

  test.each(['symlink', 'file'] as const)(
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

  test('keeps shared Amp and Replit parents out of empty-parent deletion', () => {
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
