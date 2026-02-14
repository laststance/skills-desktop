import { dirname, join, resolve } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Create a mock Stats-like object for lstat results.
 * @param options - Whether the entry is a symbolic link or directory
 * @returns Object compatible with fs.Stats used by symlinkChecker
 * @example
 * createStats({ isSymbolicLink: true, isDirectory: false })
 * // => { isSymbolicLink: () => true, isDirectory: () => false }
 */
function createStats(options: {
  isSymbolicLink: boolean
  isDirectory: boolean
}): {
  isSymbolicLink: () => boolean
  isDirectory: () => boolean
} {
  return {
    isSymbolicLink: () => options.isSymbolicLink,
    isDirectory: () => options.isDirectory,
  }
}

const lstatMock = vi.fn()
const readlinkMock = vi.fn()
const accessMock = vi.fn()

vi.mock('fs/promises', () => ({
  lstat: lstatMock,
  readlink: readlinkMock,
  access: accessMock,
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

describe('checkSymlinkStatus', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns valid when symlink exists and target is accessible', async () => {
    lstatMock.mockResolvedValue(
      createStats({ isSymbolicLink: true, isDirectory: false }),
    )
    readlinkMock.mockResolvedValue('/mock/source/skills/my-skill')
    accessMock.mockResolvedValue(undefined)

    const { checkSymlinkStatus } = await import('./symlinkChecker')
    const result = await checkSymlinkStatus(
      '/mock/agents/claude/skills/my-skill',
    )

    expect(result).toBe('valid')
    expect(lstatMock).toHaveBeenCalledWith(
      '/mock/agents/claude/skills/my-skill',
    )
    expect(readlinkMock).toHaveBeenCalledWith(
      '/mock/agents/claude/skills/my-skill',
    )
  })

  it('returns broken when symlink exists but target is missing', async () => {
    lstatMock.mockResolvedValue(
      createStats({ isSymbolicLink: true, isDirectory: false }),
    )
    readlinkMock.mockResolvedValue('/mock/source/skills/deleted-skill')
    accessMock.mockRejectedValue(new Error('ENOENT'))

    const { checkSymlinkStatus } = await import('./symlinkChecker')
    const result = await checkSymlinkStatus(
      '/mock/agents/claude/skills/deleted-skill',
    )

    expect(result).toBe('broken')
  })

  it('returns missing when path does not exist (lstat throws ENOENT)', async () => {
    lstatMock.mockRejectedValue(new Error('ENOENT'))

    const { checkSymlinkStatus } = await import('./symlinkChecker')
    const result = await checkSymlinkStatus(
      '/mock/agents/claude/skills/nonexistent',
    )

    expect(result).toBe('missing')
  })

  it('returns missing when path is a real directory (not a symlink)', async () => {
    lstatMock.mockResolvedValue(
      createStats({ isSymbolicLink: false, isDirectory: true }),
    )

    const { checkSymlinkStatus } = await import('./symlinkChecker')
    const result = await checkSymlinkStatus(
      '/mock/agents/claude/skills/local-folder',
    )

    expect(result).toBe('missing')
    expect(readlinkMock).not.toHaveBeenCalled()
  })

  it('returns valid when symlink has relative target (production fix)', async () => {
    const linkPath = '/mock/agents/claude/skills/my-skill'
    const relativeTarget = '../../../.agents/skills/my-skill'
    const expectedResolved = resolve(dirname(linkPath), relativeTarget)

    lstatMock.mockResolvedValue(
      createStats({ isSymbolicLink: true, isDirectory: false }),
    )
    readlinkMock.mockResolvedValue(relativeTarget)
    accessMock.mockResolvedValue(undefined)

    const { checkSymlinkStatus } = await import('./symlinkChecker')
    const result = await checkSymlinkStatus(linkPath)

    expect(result).toBe('valid')
    expect(accessMock).toHaveBeenCalledWith(expectedResolved)
  })
})

describe('checkSkillSymlinks', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns correct status for each agent with broken symlink', async () => {
    lstatMock.mockImplementation(async (path: string) => {
      if (path === join('/mock/agents/claude/skills', 'my-skill')) {
        return createStats({ isSymbolicLink: true, isDirectory: false })
      }
      if (path === join('/mock/agents/cursor/skills', 'my-skill')) {
        return createStats({ isSymbolicLink: true, isDirectory: false })
      }
      throw new Error('ENOENT')
    })

    readlinkMock.mockResolvedValue('/mock/source/skills/my-skill')

    accessMock.mockImplementation(async (path: string) => {
      if (path === '/mock/source/skills/my-skill') {
        throw new Error('ENOENT')
      }
    })

    const { checkSkillSymlinks } = await import('./symlinkChecker')
    const results = await checkSkillSymlinks('my-skill')

    expect(results).toHaveLength(2)
    // Both symlinks point to missing target -> broken
    expect(results[0]).toMatchObject({
      agentId: 'claude-code',
      status: 'broken',
    })
    expect(results[1]).toMatchObject({ agentId: 'cursor', status: 'broken' })
  })

  it('returns broken for one agent and missing for another', async () => {
    lstatMock.mockImplementation(async (path: string) => {
      if (path === join('/mock/agents/claude/skills', 'partial-skill')) {
        return createStats({ isSymbolicLink: true, isDirectory: false })
      }
      // Cursor has no entry
      throw new Error('ENOENT')
    })

    readlinkMock.mockResolvedValue('/mock/source/skills/deleted-target')
    accessMock.mockRejectedValue(new Error('ENOENT'))

    const { checkSkillSymlinks } = await import('./symlinkChecker')
    const results = await checkSkillSymlinks('partial-skill')

    const claude = results.find((r) => r.agentId === 'claude-code')!
    const cursor = results.find((r) => r.agentId === 'cursor')!

    expect(claude.status).toBe('broken')
    expect(claude.targetPath).toBe('/mock/source/skills/deleted-target')
    expect(cursor.status).toBe('missing')
    expect(cursor.targetPath).toBe('')
  })

  it('returns valid with populated targetPath for valid symlinks', async () => {
    lstatMock.mockResolvedValue(
      createStats({ isSymbolicLink: true, isDirectory: false }),
    )
    readlinkMock.mockResolvedValue('/mock/source/skills/good-skill')
    accessMock.mockResolvedValue(undefined)

    const { checkSkillSymlinks } = await import('./symlinkChecker')
    const results = await checkSkillSymlinks('good-skill')

    expect(results).toHaveLength(2)
    for (const r of results) {
      expect(r.status).toBe('valid')
      expect(r.targetPath).toBe('/mock/source/skills/good-skill')
      expect(r.isLocal).toBe(false)
    }
  })

  it('detects local folder as isLocal: true with valid status', async () => {
    lstatMock.mockResolvedValue(
      createStats({ isSymbolicLink: false, isDirectory: true }),
    )

    const { checkSkillSymlinks } = await import('./symlinkChecker')
    const results = await checkSkillSymlinks('local-skill')

    expect(results).toHaveLength(2)
    for (const r of results) {
      expect(r.status).toBe('valid')
      expect(r.isLocal).toBe(true)
      expect(r.targetPath).toBe('')
    }
  })

  it('returns missing for all agents when no entries exist', async () => {
    lstatMock.mockRejectedValue(new Error('ENOENT'))

    const { checkSkillSymlinks } = await import('./symlinkChecker')
    const results = await checkSkillSymlinks('nonexistent-skill')

    expect(results).toHaveLength(2)
    for (const r of results) {
      expect(r.status).toBe('missing')
      expect(r.isLocal).toBe(false)
      expect(r.targetPath).toBe('')
    }
  })

  it('resolves relative symlink targets correctly (production fix)', async () => {
    const relativeTarget = '../../../.agents/skills/good-skill'

    lstatMock.mockResolvedValue(
      createStats({ isSymbolicLink: true, isDirectory: false }),
    )
    readlinkMock.mockResolvedValue(relativeTarget)
    accessMock.mockResolvedValue(undefined)

    const { checkSkillSymlinks } = await import('./symlinkChecker')
    const results = await checkSkillSymlinks('good-skill')

    expect(results).toHaveLength(2)
    for (const r of results) {
      expect(r.status).toBe('valid')
      expect(r.isLocal).toBe(false)
    }

    // Verify access was called with resolved absolute paths, not raw relative
    const accessCalls = accessMock.mock.calls.map((c: string[]) => c[0])
    for (const call of accessCalls) {
      expect(call).not.toBe(relativeTarget)
      expect(call).toMatch(/^\//) // Must be absolute
    }
  })

  it('populates linkPath for each agent correctly', async () => {
    lstatMock.mockRejectedValue(new Error('ENOENT'))

    const { checkSkillSymlinks } = await import('./symlinkChecker')
    const results = await checkSkillSymlinks('any-skill')

    const claude = results.find((r) => r.agentId === 'claude-code')!
    const cursor = results.find((r) => r.agentId === 'cursor')!

    expect(claude.linkPath).toBe(
      join('/mock/agents/claude/skills', 'any-skill'),
    )
    expect(cursor.linkPath).toBe(
      join('/mock/agents/cursor/skills', 'any-skill'),
    )
  })
})

describe('countValidSymlinks', () => {
  it('counts only valid symlinks from mixed array', async () => {
    const { countValidSymlinks } = await import('./symlinkChecker')

    const symlinks = [
      {
        agentId: 'claude-code',
        agentName: 'Claude Code',
        status: 'valid' as const,
        targetPath: '',
        linkPath: '',
        isLocal: false,
      },
      {
        agentId: 'cursor',
        agentName: 'Cursor',
        status: 'broken' as const,
        targetPath: '',
        linkPath: '',
        isLocal: false,
      },
      {
        agentId: 'codex',
        agentName: 'Codex',
        status: 'valid' as const,
        targetPath: '',
        linkPath: '',
        isLocal: false,
      },
      {
        agentId: 'copilot',
        agentName: 'Copilot',
        status: 'missing' as const,
        targetPath: '',
        linkPath: '',
        isLocal: false,
      },
    ]

    expect(countValidSymlinks(symlinks as any)).toBe(2)
  })

  it('returns 0 when all symlinks are broken', async () => {
    const { countValidSymlinks } = await import('./symlinkChecker')

    const symlinks = [
      {
        agentId: 'claude-code',
        agentName: 'Claude Code',
        status: 'broken' as const,
        targetPath: '',
        linkPath: '',
        isLocal: false,
      },
      {
        agentId: 'cursor',
        agentName: 'Cursor',
        status: 'broken' as const,
        targetPath: '',
        linkPath: '',
        isLocal: false,
      },
    ]

    expect(countValidSymlinks(symlinks as any)).toBe(0)
  })

  it('returns 0 for empty array', async () => {
    const { countValidSymlinks } = await import('./symlinkChecker')
    expect(countValidSymlinks([])).toBe(0)
  })
})
