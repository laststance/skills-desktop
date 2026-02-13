import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Create a mock Stats-like object for lstat results.
 * @param options - Whether the entry is a symbolic link
 * @returns Object compatible with fs.Stats used by syncService
 * @example
 * createStats({ isSymbolicLink: true })
 * // => { isSymbolicLink: () => true }
 */
function createStats(options: { isSymbolicLink: boolean }): {
  isSymbolicLink: () => boolean
} {
  return {
    isSymbolicLink: () => options.isSymbolicLink,
  }
}

const lstatMock = vi.fn()
const readdirMock = vi.fn()
const accessMock = vi.fn()
const rmMock = vi.fn()
const symlinkMock = vi.fn()
const mkdirMock = vi.fn()

vi.mock('fs/promises', () => ({
  lstat: lstatMock,
  readdir: readdirMock,
  access: accessMock,
  rm: rmMock,
  symlink: symlinkMock,
  mkdir: mkdirMock,
}))

vi.mock('../constants', () => ({
  SOURCE_DIR: '/mock/source/skills',
  AGENTS: [
    {
      id: 'claude-code',
      name: 'Claude Code',
      path: '/mock/agents/claude/skills',
    },
    { id: 'cursor', name: 'Cursor', path: '/mock/agents/cursor/skills' },
  ],
}))

describe('syncPreview', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    // Default: agent parent dirs exist
    accessMock.mockResolvedValue(undefined)
  })

  it('returns zero counts when no source skills exist', async () => {
    readdirMock.mockResolvedValue([])

    const { syncPreview } = await import('./syncService')
    const result = await syncPreview()

    expect(result.totalSkills).toBe(0)
    expect(result.totalAgents).toBe(2)
    expect(result.toCreate).toBe(0)
    expect(result.alreadySynced).toBe(0)
    expect(result.conflicts).toHaveLength(0)
  })

  it('counts already-synced symlinks', async () => {
    readdirMock.mockImplementation(async (dir: string) => {
      if (dir === '/mock/source/skills') {
        return [{ name: 'my-skill', isDirectory: () => true }]
      }
      return []
    })
    accessMock.mockResolvedValue(undefined)
    lstatMock.mockResolvedValue(createStats({ isSymbolicLink: true }))

    const { syncPreview } = await import('./syncService')
    const result = await syncPreview()

    expect(result.totalSkills).toBe(1)
    expect(result.alreadySynced).toBe(2) // 1 skill × 2 agents
    expect(result.toCreate).toBe(0)
    expect(result.conflicts).toHaveLength(0)
  })

  it('counts paths that need creation when not existing', async () => {
    readdirMock.mockImplementation(async (dir: string) => {
      if (dir === '/mock/source/skills') {
        return [{ name: 'new-skill', isDirectory: () => true }]
      }
      return []
    })
    accessMock.mockImplementation(async (path: string) => {
      // Source skill has SKILL.md
      if (path === join('/mock/source/skills', 'new-skill', 'SKILL.md')) return
      // Agent parent dirs exist
      if (path === '/mock/agents/claude' || path === '/mock/agents/cursor')
        return
      throw new Error(`ENOENT: ${path}`)
    })
    lstatMock.mockRejectedValue(new Error('ENOENT'))

    const { syncPreview } = await import('./syncService')
    const result = await syncPreview()

    expect(result.toCreate).toBe(2) // 1 skill × 2 agents
    expect(result.alreadySynced).toBe(0)
    expect(result.conflicts).toHaveLength(0)
  })

  it('detects conflicts when local folders exist', async () => {
    readdirMock.mockImplementation(async (dir: string) => {
      if (dir === '/mock/source/skills') {
        return [{ name: 'local-skill', isDirectory: () => true }]
      }
      return []
    })
    accessMock.mockResolvedValue(undefined)
    // Local folder (not a symlink)
    lstatMock.mockResolvedValue(createStats({ isSymbolicLink: false }))

    const { syncPreview } = await import('./syncService')
    const result = await syncPreview()

    expect(result.conflicts).toHaveLength(2) // 1 skill × 2 agents
    expect(result.conflicts[0]).toMatchObject({
      skillName: 'local-skill',
      agentId: 'claude-code',
      agentName: 'Claude Code',
      agentSkillPath: join('/mock/agents/claude/skills', 'local-skill'),
    })
    expect(result.conflicts[1]).toMatchObject({
      skillName: 'local-skill',
      agentId: 'cursor',
      agentName: 'Cursor',
    })
    expect(result.toCreate).toBe(0)
    expect(result.alreadySynced).toBe(0)
  })

  it('handles mixed states correctly', async () => {
    readdirMock.mockImplementation(async (dir: string) => {
      if (dir === '/mock/source/skills') {
        return [
          { name: 'synced-skill', isDirectory: () => true },
          { name: 'conflict-skill', isDirectory: () => true },
        ]
      }
      return []
    })
    accessMock.mockResolvedValue(undefined)
    lstatMock.mockImplementation(async (path: string) => {
      if (path.includes('synced-skill')) {
        return createStats({ isSymbolicLink: true })
      }
      if (path.includes('conflict-skill')) {
        // Claude: conflict, Cursor: missing
        if (path.includes('claude')) {
          return createStats({ isSymbolicLink: false })
        }
        throw new Error('ENOENT')
      }
      throw new Error('ENOENT')
    })

    const { syncPreview } = await import('./syncService')
    const result = await syncPreview()

    expect(result.alreadySynced).toBe(2) // synced-skill in both agents
    expect(result.conflicts).toHaveLength(1) // conflict-skill in claude
    expect(result.toCreate).toBe(1) // conflict-skill in cursor
  })

  it('returns empty result when source dir is inaccessible', async () => {
    readdirMock.mockRejectedValue(new Error('EACCES'))

    const { syncPreview } = await import('./syncService')
    const result = await syncPreview()

    expect(result.totalSkills).toBe(0)
    expect(result.conflicts).toHaveLength(0)
  })
})

describe('syncExecute', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    accessMock.mockResolvedValue(undefined)
    mkdirMock.mockResolvedValue(undefined)
    symlinkMock.mockResolvedValue(undefined)
    rmMock.mockResolvedValue(undefined)
  })

  it('creates symlinks for non-existing paths', async () => {
    readdirMock.mockImplementation(async (dir: string) => {
      if (dir === '/mock/source/skills') {
        return [{ name: 'new-skill', isDirectory: () => true }]
      }
      return []
    })
    accessMock.mockResolvedValue(undefined)
    lstatMock.mockRejectedValue(new Error('ENOENT'))

    const { syncExecute } = await import('./syncService')
    const result = await syncExecute({ replaceConflicts: [] })

    expect(result.created).toBe(2) // 1 skill × 2 agents
    expect(result.replaced).toBe(0)
    expect(result.success).toBe(true)
    expect(symlinkMock).toHaveBeenCalledTimes(2)
    expect(symlinkMock).toHaveBeenCalledWith(
      join('/mock/source/skills', 'new-skill'),
      join('/mock/agents/claude/skills', 'new-skill'),
    )
  })

  it('skips existing symlinks', async () => {
    readdirMock.mockImplementation(async (dir: string) => {
      if (dir === '/mock/source/skills') {
        return [{ name: 'linked-skill', isDirectory: () => true }]
      }
      return []
    })
    accessMock.mockResolvedValue(undefined)
    lstatMock.mockResolvedValue(createStats({ isSymbolicLink: true }))

    const { syncExecute } = await import('./syncService')
    const result = await syncExecute({ replaceConflicts: [] })

    expect(result.created).toBe(0)
    expect(result.replaced).toBe(0)
    expect(symlinkMock).not.toHaveBeenCalled()
    expect(rmMock).not.toHaveBeenCalled()
  })

  it('replaces approved conflicts with symlinks', async () => {
    const conflictPath = join('/mock/agents/claude/skills', 'local-skill')

    readdirMock.mockImplementation(async (dir: string) => {
      if (dir === '/mock/source/skills') {
        return [{ name: 'local-skill', isDirectory: () => true }]
      }
      return []
    })
    accessMock.mockResolvedValue(undefined)
    lstatMock.mockImplementation(async (path: string) => {
      if (path === conflictPath) {
        return createStats({ isSymbolicLink: false })
      }
      throw new Error('ENOENT')
    })

    const { syncExecute } = await import('./syncService')
    const result = await syncExecute({ replaceConflicts: [conflictPath] })

    expect(result.replaced).toBe(1)
    expect(rmMock).toHaveBeenCalledWith(conflictPath, {
      recursive: true,
      force: true,
    })
    expect(symlinkMock).toHaveBeenCalledWith(
      join('/mock/source/skills', 'local-skill'),
      conflictPath,
    )
    // Cursor path doesn't exist → created
    expect(result.created).toBe(1)
  })

  it('skips unapproved conflicts', async () => {
    const conflictPath = join('/mock/agents/claude/skills', 'local-skill')

    readdirMock.mockImplementation(async (dir: string) => {
      if (dir === '/mock/source/skills') {
        return [{ name: 'local-skill', isDirectory: () => true }]
      }
      return []
    })
    accessMock.mockResolvedValue(undefined)
    lstatMock.mockImplementation(async (path: string) => {
      if (path === conflictPath) {
        return createStats({ isSymbolicLink: false })
      }
      throw new Error('ENOENT')
    })

    const { syncExecute } = await import('./syncService')
    const result = await syncExecute({ replaceConflicts: [] }) // Not approved

    expect(result.replaced).toBe(0)
    expect(rmMock).not.toHaveBeenCalled()
    // Cursor path: created
    expect(result.created).toBe(1)
  })

  it('records errors when symlink creation fails', async () => {
    readdirMock.mockImplementation(async (dir: string) => {
      if (dir === '/mock/source/skills') {
        return [{ name: 'fail-skill', isDirectory: () => true }]
      }
      return []
    })
    accessMock.mockResolvedValue(undefined)
    lstatMock.mockRejectedValue(new Error('ENOENT'))
    symlinkMock.mockRejectedValue(new Error('EPERM: operation not permitted'))

    const { syncExecute } = await import('./syncService')
    const result = await syncExecute({ replaceConflicts: [] })

    expect(result.success).toBe(false)
    expect(result.errors).toHaveLength(2)
    expect(result.errors[0]).toMatchObject({
      path: join('/mock/agents/claude/skills', 'fail-skill'),
      error: 'EPERM: operation not permitted',
    })
  })

  it('creates agent skills directory via mkdir', async () => {
    readdirMock.mockImplementation(async (dir: string) => {
      if (dir === '/mock/source/skills') {
        return [{ name: 'any-skill', isDirectory: () => true }]
      }
      return []
    })
    accessMock.mockResolvedValue(undefined)
    lstatMock.mockRejectedValue(new Error('ENOENT'))

    const { syncExecute } = await import('./syncService')
    await syncExecute({ replaceConflicts: [] })

    expect(mkdirMock).toHaveBeenCalledWith('/mock/agents/claude/skills', {
      recursive: true,
    })
    expect(mkdirMock).toHaveBeenCalledWith('/mock/agents/cursor/skills', {
      recursive: true,
    })
  })
})
