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
  isFile: () => boolean
  dev: number
  ino: number
  size: number
  ctimeMs: number
  mtimeMs: number
} {
  return {
    isSymbolicLink: () => options.isSymbolicLink,
    isDirectory: () => options.isDirectory,
    isFile: () => false,
    dev: 1,
    ino: 2,
    size: 96,
    ctimeMs: 3,
    mtimeMs: 4,
  }
}

/**
 * Build a Node-style filesystem error with a stable `code` field.
 * @param code - Errno code the production helper branches on.
 * @returns Error object shaped like fs/promises rejections.
 * @example makeFsError('ENOENT').code // => 'ENOENT'
 */
function makeFsError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code })
}

const lstatMock = vi.fn()
const readlinkMock = vi.fn()
const accessMock = vi.fn()
const realpathMock = vi.fn()

vi.mock('fs/promises', () => ({
  lstat: lstatMock,
  readlink: readlinkMock,
  access: accessMock,
  realpath: realpathMock,
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
    realpathMock.mockImplementation(async (path: string) => path)
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
    accessMock.mockRejectedValue(makeFsError('ENOENT'))

    const { checkSymlinkStatus } = await import('./symlinkChecker')
    const result = await checkSymlinkStatus(
      '/mock/agents/claude/skills/deleted-skill',
    )

    expect(result).toBe('broken')
  })

  it('returns inaccessible when symlink target cannot be probed safely', async () => {
    lstatMock.mockResolvedValue(
      createStats({ isSymbolicLink: true, isDirectory: false }),
    )
    readlinkMock.mockResolvedValue('/mock/source/skills/locked-skill')
    accessMock.mockRejectedValue(
      Object.assign(new Error('EPERM'), { code: 'EPERM' }),
    )

    const { checkSymlinkStatus } = await import('./symlinkChecker')
    const result = await checkSymlinkStatus(
      '/mock/agents/claude/skills/locked-skill',
    )

    expect(result).toBe('inaccessible')
  })

  it('returns missing when path does not exist (lstat throws ENOENT)', async () => {
    lstatMock.mockRejectedValue(makeFsError('ENOENT'))

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

  it('keeps relative symlink valid when parent directory is itself symlinked', async () => {
    // Arrange
    const linkPath = '/Users/raphtalia/.config/devin/skills/analyze-app'
    const relativeTarget = '../../../../.agents/skills/analyze-app'
    const physicalParent = '/Users/raphtalia/dotfiles/.config/devin/skills'
    const expectedPhysicalTarget = '/Users/raphtalia/.agents/skills/analyze-app'

    lstatMock.mockResolvedValue(
      createStats({ isSymbolicLink: true, isDirectory: false }),
    )
    readlinkMock.mockResolvedValue(relativeTarget)
    realpathMock.mockResolvedValue(physicalParent)
    accessMock.mockResolvedValue(undefined)

    // Act
    const { checkSymlinkStatus } = await import('./symlinkChecker')
    const result = await checkSymlinkStatus(linkPath)

    // Assert
    expect(result).toBe('valid')
    expect(realpathMock).toHaveBeenCalledWith(dirname(linkPath))
    expect(accessMock).toHaveBeenCalledWith(expectedPhysicalTarget)
    expect(accessMock).not.toHaveBeenCalledWith(
      '/Users/.agents/skills/analyze-app',
    )
  })
})

describe('checkSkillSymlinks', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    realpathMock.mockImplementation(async (path: string) => path)
  })

  it('returns correct status for each agent with broken symlink', async () => {
    lstatMock.mockImplementation(async (path: string) => {
      if (path === join('/mock/agents/claude/skills', 'my-skill')) {
        return createStats({ isSymbolicLink: true, isDirectory: false })
      }
      if (path === join('/mock/agents/cursor/skills', 'my-skill')) {
        return createStats({ isSymbolicLink: true, isDirectory: false })
      }
      throw makeFsError('ENOENT')
    })

    readlinkMock.mockResolvedValue('/mock/source/skills/my-skill')

    accessMock.mockImplementation(async (path: string) => {
      if (path === '/mock/source/skills/my-skill') {
        throw makeFsError('ENOENT')
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
      throw makeFsError('ENOENT')
    })

    readlinkMock.mockResolvedValue('/mock/source/skills/deleted-target')
    accessMock.mockRejectedValue(makeFsError('ENOENT'))

    const { checkSkillSymlinks } = await import('./symlinkChecker')
    const results = await checkSkillSymlinks('partial-skill')

    const claude = results.find((r) => r.agentId === 'claude-code')!
    const cursor = results.find((r) => r.agentId === 'cursor')!

    expect(claude.status).toBe('broken')
    expect(claude.targetPath).toBe('/mock/source/skills/deleted-target')
    expect(cursor.status).toBe('missing')
    expect(cursor.targetPath).toBeUndefined()
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
      expect(r.targetPath).toBeUndefined()
      expect(r.filesystemIdentity).toEqual({
        kind: 'directory',
        dev: 1,
        ino: 2,
        size: 96,
        ctimeMs: 3,
        mtimeMs: 4,
      })
    }
  })

  it('returns missing for all agents when no entries exist', async () => {
    lstatMock.mockRejectedValue(makeFsError('ENOENT'))

    const { checkSkillSymlinks } = await import('./symlinkChecker')
    const results = await checkSkillSymlinks('nonexistent-skill')

    expect(results).toHaveLength(2)
    for (const r of results) {
      expect(r.status).toBe('missing')
      expect(r.isLocal).toBe(false)
      expect(r.targetPath).toBeUndefined()
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
      // targetPath must be the absolute-resolved string, not the raw readlink
      // value. AbsolutePath is a branded string type; leaking the relative
      // form here would silently violate the type contract for callers.
      expect(r.targetPath).not.toBe(relativeTarget)
      expect(r.targetPath).toMatch(/^\//)
    }

    // Verify access was called with resolved absolute paths, not raw relative
    const accessCalls = accessMock.mock.calls.map((c: string[]) => c[0])
    for (const call of accessCalls) {
      expect(call).not.toBe(relativeTarget)
      expect(call).toMatch(/^\//) // Must be absolute
    }
  })

  it('reports physical targetPath for relative symlinks under a symlinked parent directory', async () => {
    // Arrange
    const relativeTarget = '../../../../.agents/skills/good-skill'
    const physicalParent = '/Users/raphtalia/dotfiles/.config/devin/skills'
    const expectedPhysicalTarget = '/Users/raphtalia/.agents/skills/good-skill'

    lstatMock.mockResolvedValue(
      createStats({ isSymbolicLink: true, isDirectory: false }),
    )
    readlinkMock.mockResolvedValue(relativeTarget)
    realpathMock.mockResolvedValue(physicalParent)
    accessMock.mockResolvedValue(undefined)

    // Act
    const { checkSkillSymlinks } = await import('./symlinkChecker')
    const results = await checkSkillSymlinks('good-skill')

    // Assert
    expect(results).toHaveLength(2)
    for (const result of results) {
      expect(result.status).toBe('valid')
      expect(result.isLocal).toBe(false)
      expect(result.targetPath).toBe(expectedPhysicalTarget)
    }
    expect(accessMock).not.toHaveBeenCalledWith(
      '/Users/.agents/skills/good-skill',
    )
  })

  it('populates linkPath for each agent correctly', async () => {
    lstatMock.mockRejectedValue(makeFsError('ENOENT'))

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

describe('readSymlinkTargetIfPresent', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    realpathMock.mockImplementation(async (path: string) => path)
  })

  it('returns resolved absolute target when path is a symlink with absolute target', async () => {
    // gstack creates symlinks with absolute targets (verified on a real machine
    // via `readlink ~/.claude/skills/ship/SKILL.md`). This is the production case.
    lstatMock.mockResolvedValue(
      createStats({ isSymbolicLink: true, isDirectory: false }),
    )
    readlinkMock.mockResolvedValue('/mock/.claude/skills/gstack/ship/SKILL.md')

    const { readSymlinkTargetIfPresent } = await import('./symlinkChecker')
    const result = await readSymlinkTargetIfPresent(
      '/mock/.claude/skills/ship/SKILL.md',
    )

    expect(result).toBe('/mock/.claude/skills/gstack/ship/SKILL.md')
  })

  it('returns resolved absolute target when path is a symlink with relative target', async () => {
    // Defensive case: if a user (or a future gstack version) creates the
    // symlink with a relative target, the helper must still return an
    // absolute path so the renderer's regex check on the gstack segment works.
    const linkPath = '/mock/.claude/skills/ship/SKILL.md'
    const relativeTarget = '../gstack/ship/SKILL.md'
    const expectedResolved = resolve(dirname(linkPath), relativeTarget)

    lstatMock.mockResolvedValue(
      createStats({ isSymbolicLink: true, isDirectory: false }),
    )
    readlinkMock.mockResolvedValue(relativeTarget)

    const { readSymlinkTargetIfPresent } = await import('./symlinkChecker')
    const result = await readSymlinkTargetIfPresent(linkPath)

    expect(result).toBe(expectedResolved)
    expect(result).toMatch(/^\//) // Must be absolute
  })

  it('returns resolved target even when symlink is broken (target does not exist)', async () => {
    // The helper does NOT call access() — it only needs the target string for
    // the renderer's path-segment match. Broken symlinks still surface a target.
    lstatMock.mockResolvedValue(
      createStats({ isSymbolicLink: true, isDirectory: false }),
    )
    readlinkMock.mockResolvedValue(
      '/mock/.claude/skills/gstack/dangling/SKILL.md',
    )

    const { readSymlinkTargetIfPresent } = await import('./symlinkChecker')
    const result = await readSymlinkTargetIfPresent(
      '/mock/.claude/skills/dangling/SKILL.md',
    )

    expect(result).toBe('/mock/.claude/skills/gstack/dangling/SKILL.md')
    expect(accessMock).not.toHaveBeenCalled() // No existence probe
  })

  it('returns undefined when path is a regular file (not a symlink)', async () => {
    lstatMock.mockResolvedValue(
      createStats({ isSymbolicLink: false, isDirectory: false }),
    )

    const { readSymlinkTargetIfPresent } = await import('./symlinkChecker')
    const result = await readSymlinkTargetIfPresent(
      '/mock/.agents/skills/foo/SKILL.md',
    )

    expect(result).toBeUndefined()
    expect(readlinkMock).not.toHaveBeenCalled() // Skipped: not a symlink
    expect(accessMock).not.toHaveBeenCalled() // No existence probe
  })

  it('returns undefined when path is a directory', async () => {
    lstatMock.mockResolvedValue(
      createStats({ isSymbolicLink: false, isDirectory: true }),
    )

    const { readSymlinkTargetIfPresent } = await import('./symlinkChecker')
    const result = await readSymlinkTargetIfPresent('/mock/some/dir')

    expect(result).toBeUndefined()
    expect(readlinkMock).not.toHaveBeenCalled() // Skipped: not a symlink
    expect(accessMock).not.toHaveBeenCalled() // No existence probe
  })

  it('returns undefined when path does not exist (lstat throws)', async () => {
    lstatMock.mockRejectedValue(makeFsError('ENOENT'))

    const { readSymlinkTargetIfPresent } = await import('./symlinkChecker')
    const result = await readSymlinkTargetIfPresent('/mock/missing/SKILL.md')

    expect(result).toBeUndefined()
  })

  it('returns undefined when readlink races with deletion (lstat ok, readlink fails)', async () => {
    lstatMock.mockResolvedValue(
      createStats({ isSymbolicLink: true, isDirectory: false }),
    )
    readlinkMock.mockRejectedValue(makeFsError('ENOENT'))

    const { readSymlinkTargetIfPresent } = await import('./symlinkChecker')
    const result = await readSymlinkTargetIfPresent(
      '/mock/race-condition/SKILL.md',
    )

    expect(result).toBeUndefined()
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
