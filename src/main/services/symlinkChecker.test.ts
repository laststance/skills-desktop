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

  it('reports a skill as valid when its symlink resolves to a reachable target', async () => {
    // Arrange
    lstatMock.mockResolvedValue(
      createStats({ isSymbolicLink: true, isDirectory: false }),
    )
    readlinkMock.mockResolvedValue('/mock/source/skills/my-skill')
    accessMock.mockResolvedValue(undefined)

    // Act
    const { checkSymlinkStatus } = await import('./symlinkChecker')
    const result = await checkSymlinkStatus(
      '/mock/agents/claude/skills/my-skill',
    )

    // Assert
    expect(result).toBe('valid')
    expect(lstatMock).toHaveBeenCalledWith(
      '/mock/agents/claude/skills/my-skill',
    )
    expect(readlinkMock).toHaveBeenCalledWith(
      '/mock/agents/claude/skills/my-skill',
    )
  })

  it('flags a skill as broken when its symlink target was deleted', async () => {
    // Arrange
    lstatMock.mockResolvedValue(
      createStats({ isSymbolicLink: true, isDirectory: false }),
    )
    readlinkMock.mockResolvedValue('/mock/source/skills/deleted-skill')
    accessMock.mockRejectedValue(makeFsError('ENOENT'))

    // Act
    const { checkSymlinkStatus } = await import('./symlinkChecker')
    const result = await checkSymlinkStatus(
      '/mock/agents/claude/skills/deleted-skill',
    )

    // Assert
    expect(result).toBe('broken')
  })

  it('marks a skill inaccessible when permission denial blocks probing its target', async () => {
    // Arrange
    lstatMock.mockResolvedValue(
      createStats({ isSymbolicLink: true, isDirectory: false }),
    )
    readlinkMock.mockResolvedValue('/mock/source/skills/locked-skill')
    accessMock.mockRejectedValue(
      Object.assign(new Error('EPERM'), { code: 'EPERM' }),
    )

    // Act
    const { checkSymlinkStatus } = await import('./symlinkChecker')
    const result = await checkSymlinkStatus(
      '/mock/agents/claude/skills/locked-skill',
    )

    // Assert
    expect(result).toBe('inaccessible')
  })

  it('reports a skill as missing when nothing exists at the agent path', async () => {
    // Arrange
    lstatMock.mockRejectedValue(makeFsError('ENOENT'))

    // Act
    const { checkSymlinkStatus } = await import('./symlinkChecker')
    const result = await checkSymlinkStatus(
      '/mock/agents/claude/skills/nonexistent',
    )

    // Assert
    expect(result).toBe('missing')
  })

  it('treats a real directory at the agent path as missing instead of reading it as a link', async () => {
    // Arrange
    lstatMock.mockResolvedValue(
      createStats({ isSymbolicLink: false, isDirectory: true }),
    )

    // Act
    const { checkSymlinkStatus } = await import('./symlinkChecker')
    const result = await checkSymlinkStatus(
      '/mock/agents/claude/skills/local-folder',
    )

    // Assert
    expect(result).toBe('missing')
    expect(readlinkMock).not.toHaveBeenCalled()
  })

  it('keeps a relative-target symlink valid by probing the resolved absolute path', async () => {
    // Arrange
    const linkPath = '/mock/agents/claude/skills/my-skill'
    const relativeTarget = '../../../.agents/skills/my-skill'
    const expectedResolved = resolve(dirname(linkPath), relativeTarget)

    lstatMock.mockResolvedValue(
      createStats({ isSymbolicLink: true, isDirectory: false }),
    )
    readlinkMock.mockResolvedValue(relativeTarget)
    accessMock.mockResolvedValue(undefined)

    // Act
    const { checkSymlinkStatus } = await import('./symlinkChecker')
    const result = await checkSymlinkStatus(linkPath)

    // Assert
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

  it('marks every agent broken when they all symlink to the same deleted source', async () => {
    // Arrange
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

    // Act
    const { checkSkillSymlinks } = await import('./symlinkChecker')
    const results = await checkSkillSymlinks('my-skill')

    // Assert
    expect(results).toHaveLength(2)
    // Both symlinks point to missing target -> broken
    expect(results[0]).toMatchObject({
      agentId: 'claude-code',
      status: 'broken',
    })
    expect(results[1]).toMatchObject({ agentId: 'cursor', status: 'broken' })
  })

  it('marks an agent inaccessible when a permission denial blocks probing the symlink target', async () => {
    // Arrange
    // Symlink resolves, but access() is denied (EACCES, not a missing-path
    // code). checkLinkOrLocal's catch must map this to 'inaccessible', NOT
    // 'broken' — a locked target is not the same as a deleted one.
    lstatMock.mockResolvedValue(
      createStats({ isSymbolicLink: true, isDirectory: false }),
    )
    readlinkMock.mockResolvedValue('/mock/source/skills/locked-skill')
    accessMock.mockRejectedValue(makeFsError('EACCES'))

    // Act
    const { checkSkillSymlinks } = await import('./symlinkChecker')
    const results = await checkSkillSymlinks('locked-skill')

    // Assert
    const claude = results.find((r) => r.agentId === 'claude-code')!
    const cursor = results.find((r) => r.agentId === 'cursor')!
    expect(results).toHaveLength(2)
    expect(claude.status).toBe('inaccessible')
    expect(claude.isLocal).toBe(false)
    expect(cursor.status).toBe('inaccessible')
    expect(cursor.isLocal).toBe(false)
  })

  it('distinguishes a broken installed link from an agent that never had the skill', async () => {
    // Arrange
    lstatMock.mockImplementation(async (path: string) => {
      if (path === join('/mock/agents/claude/skills', 'partial-skill')) {
        return createStats({ isSymbolicLink: true, isDirectory: false })
      }
      // Cursor has no entry
      throw makeFsError('ENOENT')
    })

    readlinkMock.mockResolvedValue('/mock/source/skills/deleted-target')
    accessMock.mockRejectedValue(makeFsError('ENOENT'))

    // Act
    const { checkSkillSymlinks } = await import('./symlinkChecker')
    const results = await checkSkillSymlinks('partial-skill')

    // Assert
    const claude = results.find((r) => r.agentId === 'claude-code')!
    const cursor = results.find((r) => r.agentId === 'cursor')!

    expect(claude.status).toBe('broken')
    expect(claude.targetPath).toBe('/mock/source/skills/deleted-target')
    expect(cursor.status).toBe('missing')
    expect(cursor.targetPath).toBeUndefined()
  })

  it('surfaces the resolved source path on every agent that has a healthy link', async () => {
    // Arrange
    lstatMock.mockResolvedValue(
      createStats({ isSymbolicLink: true, isDirectory: false }),
    )
    readlinkMock.mockResolvedValue('/mock/source/skills/good-skill')
    accessMock.mockResolvedValue(undefined)

    // Act
    const { checkSkillSymlinks } = await import('./symlinkChecker')
    const results = await checkSkillSymlinks('good-skill')

    // Assert
    const claude = results.find((r) => r.agentId === 'claude-code')!
    const cursor = results.find((r) => r.agentId === 'cursor')!
    expect(results).toHaveLength(2)
    expect(claude.status).toBe('valid')
    expect(claude.targetPath).toBe('/mock/source/skills/good-skill')
    expect(claude.isLocal).toBe(false)
    expect(cursor.status).toBe('valid')
    expect(cursor.targetPath).toBe('/mock/source/skills/good-skill')
    expect(cursor.isLocal).toBe(false)
  })

  it('treats a real folder living inside an agent dir as a valid local-only skill', async () => {
    // Arrange
    lstatMock.mockResolvedValue(
      createStats({ isSymbolicLink: false, isDirectory: true }),
    )

    // Act
    const { checkSkillSymlinks } = await import('./symlinkChecker')
    const results = await checkSkillSymlinks('local-skill')

    // Assert
    const claude = results.find((r) => r.agentId === 'claude-code')!
    const cursor = results.find((r) => r.agentId === 'cursor')!
    expect(results).toHaveLength(2)
    expect(claude.status).toBe('valid')
    expect(claude.isLocal).toBe(true)
    expect(claude.targetPath).toBeUndefined()
    expect(claude.filesystemIdentity).toEqual({
      kind: 'directory',
      dev: 1,
      ino: 2,
      size: 96,
      ctimeMs: 3,
      mtimeMs: 4,
    })
    expect(cursor.status).toBe('valid')
    expect(cursor.isLocal).toBe(true)
    expect(cursor.targetPath).toBeUndefined()
    expect(cursor.filesystemIdentity).toEqual({
      kind: 'directory',
      dev: 1,
      ino: 2,
      size: 96,
      ctimeMs: 3,
      mtimeMs: 4,
    })
  })

  it('reports the skill as missing on every agent when no agent has it installed', async () => {
    // Arrange
    lstatMock.mockRejectedValue(makeFsError('ENOENT'))

    // Act
    const { checkSkillSymlinks } = await import('./symlinkChecker')
    const results = await checkSkillSymlinks('nonexistent-skill')

    // Assert
    const claude = results.find((r) => r.agentId === 'claude-code')!
    const cursor = results.find((r) => r.agentId === 'cursor')!
    expect(results).toHaveLength(2)
    expect(claude.status).toBe('missing')
    expect(claude.isLocal).toBe(false)
    expect(claude.targetPath).toBeUndefined()
    expect(cursor.status).toBe('missing')
    expect(cursor.isLocal).toBe(false)
    expect(cursor.targetPath).toBeUndefined()
  })

  it('never leaks a raw relative target into targetPath or the access probe', async () => {
    // Arrange
    const relativeTarget = '../../../.agents/skills/good-skill'

    lstatMock.mockResolvedValue(
      createStats({ isSymbolicLink: true, isDirectory: false }),
    )
    readlinkMock.mockResolvedValue(relativeTarget)
    accessMock.mockResolvedValue(undefined)

    // Act
    const { checkSkillSymlinks } = await import('./symlinkChecker')
    const results = await checkSkillSymlinks('good-skill')

    // Assert
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

  it('points each agent result at that agent own skills directory link path', async () => {
    // Arrange
    lstatMock.mockRejectedValue(makeFsError('ENOENT'))

    // Act
    const { checkSkillSymlinks } = await import('./symlinkChecker')
    const results = await checkSkillSymlinks('any-skill')

    // Assert
    const claude = results.find((r) => r.agentId === 'claude-code')!
    const cursor = results.find((r) => r.agentId === 'cursor')!

    expect(claude.linkPath).toBe(
      join('/mock/agents/claude/skills', 'any-skill'),
    )
    expect(cursor.linkPath).toBe(
      join('/mock/agents/cursor/skills', 'any-skill'),
    )
  })

  it('treats a plain file sitting in an agent dir as a missing skill, not a link', async () => {
    // Arrange
    // A regular file (not a symlink, not a directory) parked at the skill path:
    // checkLinkOrLocal's ts-pattern falls through to the .otherwise branch, so
    // the agent must show no installed skill rather than a half-read link.
    lstatMock.mockResolvedValue(
      createStats({ isSymbolicLink: false, isDirectory: false }),
    )

    // Act
    const { checkSkillSymlinks } = await import('./symlinkChecker')
    const results = await checkSkillSymlinks('stray-file-skill')

    // Assert
    const claude = results.find((r) => r.agentId === 'claude-code')!
    const cursor = results.find((r) => r.agentId === 'cursor')!
    expect(results).toHaveLength(2)
    expect(claude.status).toBe('missing')
    expect(claude.isLocal).toBe(false)
    expect(claude.targetPath).toBeUndefined()
    expect(cursor.status).toBe('missing')
    expect(cursor.isLocal).toBe(false)
    expect(cursor.targetPath).toBeUndefined()
    // .otherwise short-circuits before any link read
    expect(readlinkMock).not.toHaveBeenCalled()
  })

  it('still reports a local skill valid when its directory identity cannot be read mid-scan', async () => {
    // Arrange
    // Local-folder slot: the first lstat (inside checkLinkOrLocal) sees a real
    // directory, but the follow-up lstat used to capture filesystem identity
    // races with deletion and rejects. The .catch(() => undefined) must swallow
    // that so the slot still reports valid+local, just without identity data.
    const lstatCallsByPath = new Map<string, number>()
    lstatMock.mockImplementation(async (path: string) => {
      // No gstack SKILL.md symlink inside the folder
      if (path.endsWith('SKILL.md')) {
        throw makeFsError('ENOENT')
      }
      const previousCalls = lstatCallsByPath.get(path) ?? 0
      const currentCall = previousCalls + 1
      lstatCallsByPath.set(path, currentCall)
      // 1st call per path: checkLinkOrLocal sees a directory -> isLocal
      if (currentCall === 1) {
        return createStats({ isSymbolicLink: false, isDirectory: true })
      }
      // 2nd call per path: identity-capturing lstat races with deletion
      throw makeFsError('ENOENT')
    })

    // Act
    const { checkSkillSymlinks } = await import('./symlinkChecker')
    const results = await checkSkillSymlinks('vanishing-local-skill')

    // Assert
    const claude = results.find((r) => r.agentId === 'claude-code')!
    const cursor = results.find((r) => r.agentId === 'cursor')!
    expect(results).toHaveLength(2)
    expect(claude.status).toBe('valid')
    expect(claude.isLocal).toBe(true)
    expect(claude.filesystemIdentity).toBeUndefined()
    expect(cursor.status).toBe('valid')
    expect(cursor.isLocal).toBe(true)
    expect(cursor.filesystemIdentity).toBeUndefined()
  })
})

describe('checkSymlinkTargetFromKnownLink', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    realpathMock.mockImplementation(async (path: string) => path)
  })

  it('reports a known link as valid when its target is reachable', async () => {
    // Arrange
    // The caller already proved this is a symlink (via Dirent.isSymbolicLink),
    // so the fast path skips lstat and goes straight to the target probe.
    readlinkMock.mockResolvedValue('/mock/source/skills/orphan-skill')
    accessMock.mockResolvedValue(undefined)

    // Act
    const { checkSymlinkTargetFromKnownLink } = await import('./symlinkChecker')
    const result = await checkSymlinkTargetFromKnownLink(
      '/mock/agents/claude/skills/orphan-skill',
    )

    // Assert
    expect(result).toBe('valid')
    expect(lstatMock).not.toHaveBeenCalled() // Fast path skips the redundant lstat
  })

  it('reports the known link as missing when it disappears before its target can be read', async () => {
    // Arrange
    // readlink throws (link deleted mid-scan), so resolveSymlinkTarget bubbles
    // the error out and the fast path falls back to 'missing' rather than crash.
    readlinkMock.mockRejectedValue(makeFsError('ENOENT'))

    // Act
    const { checkSymlinkTargetFromKnownLink } = await import('./symlinkChecker')
    const result = await checkSymlinkTargetFromKnownLink(
      '/mock/agents/claude/skills/vanished-link',
    )

    // Assert
    expect(result).toBe('missing')
  })
})

describe('readSymlinkTargetIfPresent', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    realpathMock.mockImplementation(async (path: string) => path)
  })

  it('surfaces a gstack absolute symlink target so the renderer can match the gstack segment', async () => {
    // Arrange
    // gstack creates symlinks with absolute targets (verified on a real machine
    // via `readlink ~/.claude/skills/ship/SKILL.md`). This is the production case.
    lstatMock.mockResolvedValue(
      createStats({ isSymbolicLink: true, isDirectory: false }),
    )
    readlinkMock.mockResolvedValue('/mock/.claude/skills/gstack/ship/SKILL.md')

    // Act
    const { readSymlinkTargetIfPresent } = await import('./symlinkChecker')
    const result = await readSymlinkTargetIfPresent(
      '/mock/.claude/skills/ship/SKILL.md',
    )

    // Assert
    expect(result).toBe('/mock/.claude/skills/gstack/ship/SKILL.md')
  })

  it('absolutizes a relative symlink target so the renderer gstack-segment check still works', async () => {
    // Arrange
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

    // Act
    const { readSymlinkTargetIfPresent } = await import('./symlinkChecker')
    const result = await readSymlinkTargetIfPresent(linkPath)

    // Assert
    expect(result).toBe(expectedResolved)
    expect(result).toMatch(/^\//) // Must be absolute
  })

  it('still surfaces the target of a broken symlink without probing the target existence', async () => {
    // Arrange
    // The helper does NOT call access() — it only needs the target string for
    // the renderer's path-segment match. Broken symlinks still surface a target.
    lstatMock.mockResolvedValue(
      createStats({ isSymbolicLink: true, isDirectory: false }),
    )
    readlinkMock.mockResolvedValue(
      '/mock/.claude/skills/gstack/dangling/SKILL.md',
    )

    // Act
    const { readSymlinkTargetIfPresent } = await import('./symlinkChecker')
    const result = await readSymlinkTargetIfPresent(
      '/mock/.claude/skills/dangling/SKILL.md',
    )

    // Assert
    expect(result).toBe('/mock/.claude/skills/gstack/dangling/SKILL.md')
    expect(accessMock).not.toHaveBeenCalled() // No existence probe
  })

  it('reports no symlink target for a regular file and skips reading it as a link', async () => {
    // Arrange
    lstatMock.mockResolvedValue(
      createStats({ isSymbolicLink: false, isDirectory: false }),
    )

    // Act
    const { readSymlinkTargetIfPresent } = await import('./symlinkChecker')
    const result = await readSymlinkTargetIfPresent(
      '/mock/.agents/skills/foo/SKILL.md',
    )

    // Assert
    expect(result).toBeUndefined()
    expect(readlinkMock).not.toHaveBeenCalled() // Skipped: not a symlink
    expect(accessMock).not.toHaveBeenCalled() // No existence probe
  })

  it('reports no symlink target for a directory and skips reading it as a link', async () => {
    // Arrange
    lstatMock.mockResolvedValue(
      createStats({ isSymbolicLink: false, isDirectory: true }),
    )

    // Act
    const { readSymlinkTargetIfPresent } = await import('./symlinkChecker')
    const result = await readSymlinkTargetIfPresent('/mock/some/dir')

    // Assert
    expect(result).toBeUndefined()
    expect(readlinkMock).not.toHaveBeenCalled() // Skipped: not a symlink
    expect(accessMock).not.toHaveBeenCalled() // No existence probe
  })

  it('reports no symlink target when nothing exists at the path', async () => {
    // Arrange
    lstatMock.mockRejectedValue(makeFsError('ENOENT'))

    // Act
    const { readSymlinkTargetIfPresent } = await import('./symlinkChecker')
    const result = await readSymlinkTargetIfPresent('/mock/missing/SKILL.md')

    // Assert
    expect(result).toBeUndefined()
  })

  it('reports no symlink target when the link is deleted between lstat and readlink', async () => {
    // Arrange
    lstatMock.mockResolvedValue(
      createStats({ isSymbolicLink: true, isDirectory: false }),
    )
    readlinkMock.mockRejectedValue(makeFsError('ENOENT'))

    // Act
    const { readSymlinkTargetIfPresent } = await import('./symlinkChecker')
    const result = await readSymlinkTargetIfPresent(
      '/mock/race-condition/SKILL.md',
    )

    // Assert
    expect(result).toBeUndefined()
  })
})

describe('countValidSymlinks', () => {
  it('counts only the healthy links when a skill has a mix of valid, broken, and missing slots', async () => {
    // Arrange
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

    // Act + Assert
    expect(countValidSymlinks(symlinks as any)).toBe(2)
  })

  it('counts zero healthy links when every slot for the skill is broken', async () => {
    // Arrange
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

    // Act + Assert
    expect(countValidSymlinks(symlinks as any)).toBe(0)
  })

  it('counts zero healthy links for a skill that is installed nowhere', async () => {
    // Arrange
    const { countValidSymlinks } = await import('./symlinkChecker')
    // Act + Assert
    expect(countValidSymlinks([])).toBe(0)
  })
})
