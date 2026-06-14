import { basename, join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Create a minimal Dirent-like object for readdir mocks.
 * @param name - Entry name
 * @param options - Directory/symlink flags
 * @returns Dirent-compatible object used by scan logic
 */
function createDirent(
  skillName: string,
  options: { isDirectory: boolean; isSymbolicLink: boolean },
): {
  name: string
  isDirectory: () => boolean
  isSymbolicLink: () => boolean
} {
  return {
    name: skillName,
    isDirectory: () => options.isDirectory,
    isSymbolicLink: () => options.isSymbolicLink,
  }
}

const readdirMock = vi.fn()
const accessMock = vi.fn()
const statMock = vi.fn()
const lstatMock = vi.fn()
const readFileMock = vi.fn()

/**
 * Build the subset of fs.Stats consumed by filesystem identity guards.
 * @param seed - Stable number that makes mocked inodes distinct enough for tests.
 * @returns Directory-shaped stats object with identity fields.
 * @example createDirectoryStats(7).isDirectory() // => true
 */
function createDirectoryStats(seed: number): {
  isDirectory: () => boolean
  isSymbolicLink: () => boolean
  isFile: () => boolean
  dev: number
  ino: number
  size: number
  ctimeMs: number
  mtimeMs: number
} {
  return {
    isDirectory: () => true,
    isSymbolicLink: () => false,
    isFile: () => false,
    dev: 1,
    ino: seed,
    size: 96,
    ctimeMs: seed,
    mtimeMs: seed,
  }
}

/**
 * Build an fs-like error with a Node `code` field for branch-specific scanner tests.
 * @param message - Human-readable failure message.
 * @param code - Node-style errno code.
 * @returns Error object carrying the requested code.
 * @example createFsError('missing', 'ENOENT')
 */
function createFsError(
  message: string,
  code: string,
): Error & { code: string } {
  return Object.assign(new Error(message), { code })
}

/**
 * Mock lstat for reviewed skill directories that the scanner should accept.
 * @param paths - Directory paths expected to survive scanner identity capture.
 * @returns void after configuring the shared lstat mock.
 * @example mockLstatDirectories(['/mock/agents/codex/skills/task'])
 */
function mockLstatDirectories(paths: readonly string[]): void {
  const validPaths = new Set(paths)
  lstatMock.mockImplementation(async (path: string) => {
    if (validPaths.has(path)) return createDirectoryStats(path.length)
    throw new Error(`ENOENT: ${path}`)
  })
}

vi.mock('fs/promises', () => ({
  readdir: readdirMock,
  access: accessMock,
  stat: statMock,
  lstat: lstatMock,
  readFile: readFileMock,
}))

vi.mock('../constants', () => ({
  SOURCE_DIR: '/mock/source/skills',
  AGENTS: [
    { id: 'codex', name: 'Codex', path: '/mock/agents/codex/skills' },
    { id: 'cursor', name: 'Cursor', path: '/mock/agents/cursor/skills' },
  ],
}))

/**
 * Configurable parseSkillMetadata mock. Default mirrors the original inline
 * stub (name from basename, static description); individual tests override it
 * to simulate corrupt frontmatter or readable sibling targets.
 */
const parseSkillMetadataMock = vi.fn(async (path: string) => ({
  name: basename(path),
  description: 'mock description',
}))

vi.mock('./metadataParser', () => ({
  parseSkillMetadata: parseSkillMetadataMock,
}))

const checkSymlinkTargetFromKnownLinkMock = vi.fn()
const readSymlinkTargetIfPresentMock = vi.fn()
const countValidSymlinksMock = vi.fn(
  (symlinks: Array<{ status: string }>): number =>
    symlinks.filter((s) => s.status === 'valid').length,
)

vi.mock('./symlinkChecker', () => ({
  checkSkillSymlinks: vi.fn(async () => []),
  countValidSymlinks: countValidSymlinksMock,
  checkSymlinkTargetFromKnownLink: checkSymlinkTargetFromKnownLinkMock,
  readSymlinkTargetIfPresent: readSymlinkTargetIfPresentMock,
}))

describe('scanSkills local skill aggregation', () => {
  beforeEach(() => {
    readdirMock.mockReset()
    accessMock.mockReset()
    lstatMock.mockReset()
    readFileMock.mockReset()
    readFileMock.mockRejectedValue(new Error('ENOENT'))
    checkSymlinkTargetFromKnownLinkMock.mockReset()
    checkSymlinkTargetFromKnownLinkMock.mockResolvedValue('missing')
    readSymlinkTargetIfPresentMock.mockReset()
    readSymlinkTargetIfPresentMock.mockResolvedValue(undefined)
    countValidSymlinksMock.mockClear()

    readdirMock.mockImplementation(async (path: string) => {
      if (path === '/mock/source/skills') {
        return []
      }
      if (path === '/mock/agents/codex/skills') {
        return [
          createDirent('frontend-design', {
            isDirectory: true,
            isSymbolicLink: false,
          }),
        ]
      }
      if (path === '/mock/agents/cursor/skills') {
        return [
          createDirent('frontend-design', {
            isDirectory: true,
            isSymbolicLink: false,
          }),
        ]
      }
      return []
    })

    accessMock.mockImplementation(async (path: string) => {
      const validSkillMdPaths = new Set([
        join('/mock/agents/codex/skills', 'frontend-design', 'SKILL.md'),
        join('/mock/agents/cursor/skills', 'frontend-design', 'SKILL.md'),
      ])

      if (validSkillMdPaths.has(path)) {
        return
      }

      throw new Error(`ENOENT: ${path}`)
    })

    // isValidSkillDir uses stat().isFile() to check SKILL.md existence
    statMock.mockImplementation(async (path: string) => {
      const validSkillMdPaths = new Set([
        join('/mock/agents/codex/skills', 'frontend-design', 'SKILL.md'),
        join('/mock/agents/cursor/skills', 'frontend-design', 'SKILL.md'),
      ])

      if (validSkillMdPaths.has(path)) {
        return { isFile: () => true }
      }

      throw new Error(`ENOENT: ${path}`)
    })
    mockLstatDirectories([
      join('/mock/agents/codex/skills', 'frontend-design'),
      join('/mock/agents/cursor/skills', 'frontend-design'),
    ])
  })

  it('keeps same local skill as valid for multiple agents', async () => {
    // Arrange
    const { scanSkills } = await import('./skillScanner')

    // Act
    const skills = await scanSkills()

    // Assert
    expect(skills).toHaveLength(1)

    const localSkill = skills[0]
    expect(localSkill.name).toBe('frontend-design')

    const codex = localSkill.symlinks.find((s) => s.agentId === 'codex')
    const cursor = localSkill.symlinks.find((s) => s.agentId === 'cursor')

    expect(codex).toMatchObject({ status: 'valid', isLocal: true })
    expect(cursor).toMatchObject({ status: 'valid', isLocal: true })
  })

  it('populates skillMdSymlinkTarget on the agent slot when SKILL.md is a symlink (gstack-managed sibling)', async () => {
    // gstack creates real folders like ~/.claude/skills/ship/ whose only entry
    // is a SKILL.md symlink into the gstack source tree. The scanner must
    // surface that target ON THE PER-AGENT SLOT so the renderer can show the
    // G-Stack badge for the agent that holds the gstack twin, without
    // bleeding to sibling agents that share the skill name.
    // Arrange
    readSymlinkTargetIfPresentMock.mockImplementation(async (path: string) => {
      if (
        path ===
        join('/mock/agents/codex/skills', 'frontend-design', 'SKILL.md')
      ) {
        return '/mock/.claude/skills/gstack/frontend-design/SKILL.md'
      }
      return undefined
    })
    const { scanSkills } = await import('./skillScanner')

    // Act
    const skills = await scanSkills()

    // Assert
    expect(skills).toHaveLength(1)
    const codex = skills[0].symlinks.find((s) => s.agentId === 'codex')
    expect(codex?.skillMdSymlinkTarget).toBe(
      '/mock/.claude/skills/gstack/frontend-design/SKILL.md',
    )
  })

  it('leaves skillMdSymlinkTarget undefined on every slot when SKILL.md is a regular file', async () => {
    // Arrange: default mock returns undefined — explicit assertion guards
    // against someone later changing the default and silently flipping the
    // badge on.
    const { scanSkills } = await import('./skillScanner')

    // Act
    const skills = await scanSkills()

    // Assert
    expect(skills).toHaveLength(1)
    for (const slot of skills[0].symlinks) {
      expect(slot.skillMdSymlinkTarget).toBeUndefined()
    }
  })

  it('binds skillMdSymlinkTarget to the slot that detected it without bleeding to sibling agents', async () => {
    // Arrange: codex slot is a gstack-managed twin (SKILL.md symlinks into
    // gstack); cursor slot is a plain local folder. Per-agent attribution:
    // codex's slot must carry the target, cursor's slot must NOT — otherwise
    // the badge would falsely appear on cursor's unrelated copy.
    readSymlinkTargetIfPresentMock.mockImplementation(async (path: string) => {
      if (
        path ===
        join('/mock/agents/codex/skills', 'frontend-design', 'SKILL.md')
      ) {
        return '/mock/.claude/skills/gstack/frontend-design/SKILL.md'
      }
      return undefined
    })
    const { scanSkills } = await import('./skillScanner')

    // Act
    const skills = await scanSkills()

    // Assert
    expect(skills).toHaveLength(1)
    const codex = skills[0].symlinks.find((s) => s.agentId === 'codex')
    const cursor = skills[0].symlinks.find((s) => s.agentId === 'cursor')
    expect(codex?.skillMdSymlinkTarget).toBe(
      '/mock/.claude/skills/gstack/frontend-design/SKILL.md',
    )
    expect(cursor?.skillMdSymlinkTarget).toBeUndefined()
  })

  it('ignores an agent directory that is not a valid skill', async () => {
    // Arrange: codex has a real folder "not-a-skill" with NO SKILL.md inside,
    // so isValidSkillDir rejects it. A directory without a SKILL.md is not a
    // skill and must never enter the inventory.
    readdirMock.mockImplementation(async (path: string) => {
      if (path === '/mock/source/skills') return []
      if (path === '/mock/agents/codex/skills') {
        return [
          createDirent('not-a-skill', {
            isDirectory: true,
            isSymbolicLink: false,
          }),
        ]
      }
      return []
    })
    // No SKILL.md exists anywhere → stat throws for every probe, so
    // isValidSkillDir returns false for the candidate directory.
    statMock.mockRejectedValue(new Error('ENOENT'))
    lstatMock.mockRejectedValue(new Error('ENOENT'))
    const { scanSkills } = await import('./skillScanner')

    // Act
    const skills = await scanSkills()

    // Assert: the SKILL.md-less directory is excluded from the inventory.
    expect(skills).toHaveLength(0)
  })

  it('skips directories without SKILL.md when listing valid source skills', async () => {
    // Arrange: SOURCE_DIR holds one real folder "no-skill-md" that contains no
    // SKILL.md file, so isValidSkillDir returns false for it. The source-dir
    // lister must drop such a directory — a folder without SKILL.md is not a
    // skill and must never be reported as an installable source.
    readdirMock.mockImplementation(async (path: string) => {
      if (path === '/mock/source/skills') {
        return [
          createDirent('no-skill-md', {
            isDirectory: true,
            isSymbolicLink: false,
          }),
        ]
      }
      return []
    })
    // No SKILL.md exists, so the stat probe for "no-skill-md/SKILL.md" throws
    // ENOENT and isValidSkillDir resolves false for the candidate directory.
    statMock.mockRejectedValue(new Error('ENOENT'))
    const { listValidSourceSkillDirs } = await import('./dirScanner')

    // Act
    const sourceSkillDirs = await listValidSourceSkillDirs()

    // Assert: the SKILL.md-less directory yields an empty source-skill list.
    expect(sourceSkillDirs).toEqual([])
  })
})

describe('scanSkills agent-only linked symlink surfacing', () => {
  beforeEach(() => {
    readdirMock.mockReset()
    accessMock.mockReset()
    statMock.mockReset()
    lstatMock.mockReset()
    lstatMock.mockRejectedValue(new Error('ENOENT'))
    readFileMock.mockReset()
    readFileMock.mockRejectedValue(new Error('ENOENT'))
    checkSymlinkTargetFromKnownLinkMock.mockReset()
    readSymlinkTargetIfPresentMock.mockReset()
    readSymlinkTargetIfPresentMock.mockResolvedValue(undefined)
    countValidSymlinksMock.mockClear()
  })

  it('surfaces valid agent symlinks whose names are not in the source directory', async () => {
    // Arrange: Codex has a valid gstack-managed symlink, but ~/.agents/skills
    // has no matching source directory. The sidebar count includes this link,
    // so the central agent view must include a linked card for the same
    // on-disk entry.
    readdirMock.mockImplementation(async (path: string) => {
      if (path === '/mock/source/skills') return []
      if (path === '/mock/agents/codex/skills') {
        return [
          createDirent('gstack-browse', {
            isDirectory: false,
            isSymbolicLink: true,
          }),
        ]
      }
      return []
    })
    accessMock.mockRejectedValue(new Error('ENOENT'))
    statMock.mockRejectedValue(new Error('ENOENT'))
    checkSymlinkTargetFromKnownLinkMock.mockImplementation(
      async (linkPath: string) => {
        if (linkPath === '/mock/agents/codex/skills/gstack-browse') {
          return 'valid'
        }
        return 'missing'
      },
    )
    readSymlinkTargetIfPresentMock.mockImplementation(
      async (linkPath: string) => {
        if (linkPath === '/mock/agents/codex/skills/gstack-browse') {
          return '/mock/external/gstack-browse'
        }
        return undefined
      },
    )
    const { scanSkills } = await import('./skillScanner')

    // Act
    const skills = await scanSkills()

    // Assert
    expect(skills).toHaveLength(1)
    const linked = skills[0]
    expect(linked.name).toBe('gstack-browse')
    expect(linked.path).toBe('/mock/external/gstack-browse')
    expect(linked.symlinkCount).toBe(1)
    expect(linked.isSource).toBe(false)
    expect(linked.isOrphan).toBe(false)

    const codex = linked.symlinks.find((s) => s.agentId === 'codex')
    const cursor = linked.symlinks.find((s) => s.agentId === 'cursor')
    expect(codex).toMatchObject({
      status: 'valid',
      isLocal: false,
      linkPath: '/mock/agents/codex/skills/gstack-browse',
      targetPath: '/mock/external/gstack-browse',
    })
    expect(cursor).toMatchObject({ status: 'missing', isLocal: false })
  })

  it('surfaces inaccessible agent-only symlinks for manual review instead of dropping them', async () => {
    // Arrange: Codex has a symlink whose target can be read but not safely
    // probed. It has no source skill, so it must still appear in the inventory.
    readdirMock.mockImplementation(async (path: string) => {
      if (path === '/mock/source/skills') return []
      if (path === '/mock/agents/codex/skills') {
        return [
          createDirent('secure-review', {
            isDirectory: false,
            isSymbolicLink: true,
          }),
        ]
      }
      return []
    })
    accessMock.mockRejectedValue(new Error('ENOENT'))
    statMock.mockRejectedValue(new Error('ENOENT'))
    checkSymlinkTargetFromKnownLinkMock.mockImplementation(
      async (linkPath: string) => {
        if (linkPath === '/mock/agents/codex/skills/secure-review') {
          return 'inaccessible'
        }
        return 'missing'
      },
    )
    readSymlinkTargetIfPresentMock.mockImplementation(
      async (linkPath: string) => {
        if (linkPath === '/mock/agents/codex/skills/secure-review') {
          return '/mock/secure/skills/secure-review'
        }
        return undefined
      },
    )
    const { scanSkills } = await import('./skillScanner')

    // Act
    const skills = await scanSkills()

    // Assert
    expect(skills).toHaveLength(1)
    const manualReview = skills[0]
    expect(manualReview.name).toBe('secure-review')
    expect(manualReview.description).toBe(
      'Inaccessible symlink — target cannot be verified',
    )
    expect(manualReview.path).toBe('/mock/secure/skills/secure-review')
    expect(manualReview.symlinkCount).toBe(0)
    expect(manualReview.isSource).toBe(false)
    expect(manualReview.isOrphan).toBe(false)

    const codex = manualReview.symlinks.find((s) => s.agentId === 'codex')
    const cursor = manualReview.symlinks.find((s) => s.agentId === 'cursor')
    expect(codex).toMatchObject({
      status: 'inaccessible',
      isLocal: false,
      linkPath: '/mock/agents/codex/skills/secure-review',
      targetPath: '/mock/secure/skills/secure-review',
    })
    expect(cursor).toMatchObject({ status: 'missing', isLocal: false })
  })

  it('keeps the readable description when an inaccessible sibling is seen after a valid one', async () => {
    // Arrange: two agents link the SAME skill name "shared-skill". Codex's link
    // is valid with parseable metadata (seen first → builds the record), cursor's
    // link is inaccessible (seen second → carries null metadata). The grouped
    // record must NOT downgrade to the inaccessible placeholder; the readable
    // description and target path from the valid codex link must survive.
    readdirMock.mockImplementation(async (path: string) => {
      if (path === '/mock/source/skills') return []
      if (path === '/mock/agents/codex/skills') {
        return [
          createDirent('shared-skill', {
            isDirectory: false,
            isSymbolicLink: true,
          }),
        ]
      }
      if (path === '/mock/agents/cursor/skills') {
        return [
          createDirent('shared-skill', {
            isDirectory: false,
            isSymbolicLink: true,
          }),
        ]
      }
      return []
    })
    accessMock.mockRejectedValue(new Error('ENOENT'))
    statMock.mockRejectedValue(new Error('ENOENT'))
    checkSymlinkTargetFromKnownLinkMock.mockImplementation(
      async (linkPath: string) => {
        if (linkPath === '/mock/agents/codex/skills/shared-skill') {
          return 'valid'
        }
        if (linkPath === '/mock/agents/cursor/skills/shared-skill') {
          return 'inaccessible'
        }
        return 'missing'
      },
    )
    readSymlinkTargetIfPresentMock.mockImplementation(
      async (linkPath: string) => {
        if (linkPath === '/mock/agents/codex/skills/shared-skill') {
          return '/mock/external/shared-skill'
        }
        return undefined
      },
    )
    parseSkillMetadataMock.mockImplementation(async (path: string) => {
      if (path === '/mock/external/shared-skill') {
        return { name: 'shared-skill', description: 'readable description' }
      }
      return { name: basename(path), description: 'mock description' }
    })
    const { scanSkills } = await import('./skillScanner')

    // Act
    const skills = await scanSkills()

    // Assert
    expect(skills).toHaveLength(1)
    const merged = skills[0]
    expect(merged.name).toBe('shared-skill')
    expect(merged.description).toBe('readable description')
    expect(merged.path).toBe('/mock/external/shared-skill')

    const cursor = merged.symlinks.find((s) => s.agentId === 'cursor')
    expect(cursor?.status).toBe('inaccessible')
  })
})

describe('scanSkills orphan symlink surfacing (issue #127)', () => {
  beforeEach(() => {
    readdirMock.mockReset()
    accessMock.mockReset()
    statMock.mockReset()
    lstatMock.mockReset()
    lstatMock.mockRejectedValue(new Error('ENOENT'))
    readFileMock.mockReset()
    readFileMock.mockRejectedValue(new Error('ENOENT'))
    checkSymlinkTargetFromKnownLinkMock.mockReset()
    readSymlinkTargetIfPresentMock.mockReset()
    readSymlinkTargetIfPresentMock.mockResolvedValue(undefined)
    countValidSymlinksMock.mockClear()
  })

  it('surfaces broken symlinks whose source is missing as orphan Skill records', async () => {
    // Arrange: source dir empty; codex has 1 broken symlink "connect-chrome".
    readdirMock.mockImplementation(async (path: string) => {
      if (path === '/mock/source/skills') return []
      if (path === '/mock/agents/codex/skills') {
        return [
          createDirent('connect-chrome', {
            isDirectory: false,
            isSymbolicLink: true,
          }),
        ]
      }
      return []
    })
    accessMock.mockRejectedValue(new Error('ENOENT'))
    statMock.mockRejectedValue(new Error('ENOENT'))
    checkSymlinkTargetFromKnownLinkMock.mockImplementation(
      async (linkPath: string) => {
        if (linkPath === '/mock/agents/codex/skills/connect-chrome')
          return 'broken'
        return 'missing'
      },
    )
    readSymlinkTargetIfPresentMock.mockImplementation(
      async (linkPath: string) => {
        if (linkPath === '/mock/agents/codex/skills/connect-chrome') {
          return '/mock/source/skills/connect-chrome'
        }
        return undefined
      },
    )
    const { scanSkills } = await import('./skillScanner')

    // Act
    const skills = await scanSkills()

    // Assert
    expect(skills).toHaveLength(1)
    const orphan = skills[0]
    expect(orphan.name).toBe('connect-chrome')
    expect(orphan.isSource).toBe(false)
    expect(orphan.description).toBe(
      'Orphan symlink — source skill no longer exists',
    )

    const codex = orphan.symlinks.find((s) => s.agentId === 'codex')
    const cursor = orphan.symlinks.find((s) => s.agentId === 'cursor')
    expect(codex).toMatchObject({
      status: 'broken',
      isLocal: false,
      targetPath: '/mock/source/skills/connect-chrome',
    })
    expect(cursor).toMatchObject({ status: 'missing', isLocal: false })
  })

  it('collapses the same broken name across multiple agents into one orphan record', async () => {
    // Arrange
    readdirMock.mockImplementation(async (path: string) => {
      if (path === '/mock/source/skills') return []
      if (
        path === '/mock/agents/codex/skills' ||
        path === '/mock/agents/cursor/skills'
      ) {
        return [
          createDirent('connect-chrome', {
            isDirectory: false,
            isSymbolicLink: true,
          }),
        ]
      }
      return []
    })
    accessMock.mockRejectedValue(new Error('ENOENT'))
    statMock.mockRejectedValue(new Error('ENOENT'))
    checkSymlinkTargetFromKnownLinkMock.mockResolvedValue('broken')
    const { scanSkills } = await import('./skillScanner')

    // Act
    const skills = await scanSkills()

    // Assert
    expect(skills).toHaveLength(1)
    const orphan = skills[0]
    const codex = orphan.symlinks.find((s) => s.agentId === 'codex')
    const cursor = orphan.symlinks.find((s) => s.agentId === 'cursor')
    expect(codex?.status).toBe('broken')
    expect(cursor?.status).toBe('broken')
  })

  it('does NOT create orphan record when name matches a live source skill', async () => {
    // Arrange: source has "theme-generator". Codex has a broken
    // "theme-generator" symlink — broken status belongs in the source skill's
    // symlinks[], not in a separate orphan record.
    readdirMock.mockImplementation(async (path: string) => {
      if (path === '/mock/source/skills') {
        return [
          createDirent('theme-generator', {
            isDirectory: true,
            isSymbolicLink: false,
          }),
        ]
      }
      if (path === '/mock/agents/codex/skills') {
        return [
          createDirent('theme-generator', {
            isDirectory: false,
            isSymbolicLink: true,
          }),
        ]
      }
      return []
    })
    // SKILL.md exists for the live source skill.
    accessMock.mockImplementation(async (path: string) => {
      if (path === '/mock/source/skills/theme-generator/SKILL.md') return
      throw new Error(`ENOENT: ${path}`)
    })
    statMock.mockImplementation(async (path: string) => {
      if (path === '/mock/source/skills/theme-generator/SKILL.md') {
        return { isFile: () => true }
      }
      throw new Error(`ENOENT: ${path}`)
    })
    mockLstatDirectories(['/mock/source/skills/theme-generator'])
    checkSymlinkTargetFromKnownLinkMock.mockResolvedValue('broken')
    const { scanSkills } = await import('./skillScanner')

    // Act
    const skills = await scanSkills()

    // Assert: exactly one record — the live source skill, no separate orphan.
    expect(skills).toHaveLength(1)
    expect(skills[0].name).toBe('theme-generator')
    expect(skills[0].isSource).toBe(true)
  })

  it('skips a source skill directory that disappears after the directory listing', async () => {
    // Arrange: `listValidSourceSkillDirs()` sees two valid dirs because SKILL.md
    // stat succeeded, then the second dir vanishes before scanSourceSkills()
    // captures its reviewed filesystem identity.
    readdirMock.mockImplementation(async (path: string) => {
      if (path === '/mock/source/skills') {
        return [
          createDirent('live-source', {
            isDirectory: true,
            isSymbolicLink: false,
          }),
          createDirent('vanished-source', {
            isDirectory: true,
            isSymbolicLink: false,
          }),
        ]
      }
      return []
    })
    statMock.mockImplementation(async (path: string) => {
      if (
        path === '/mock/source/skills/live-source/SKILL.md' ||
        path === '/mock/source/skills/vanished-source/SKILL.md'
      ) {
        return { isFile: () => true }
      }
      throw createFsError(`ENOENT: ${path}`, 'ENOENT')
    })
    lstatMock.mockImplementation(async (path: string) => {
      if (path === '/mock/source/skills/live-source') {
        return createDirectoryStats(10)
      }
      if (path === '/mock/source/skills/vanished-source') {
        throw createFsError(`ENOENT: ${path}`, 'ENOENT')
      }
      throw createFsError(`ENOENT: ${path}`, 'ENOENT')
    })

    const { scanSkills } = await import('./skillScanner')

    // Act
    const skills = await scanSkills()

    // Assert: one stale source row is dropped instead of rejecting the whole scan.
    expect(skills).toHaveLength(1)
    expect(skills[0]).toMatchObject({
      name: 'live-source',
      path: '/mock/source/skills/live-source',
      isSource: true,
    })
  })

  it('merges orphan broken slots into a same-named local skill (regression for #127 follow-up)', async () => {
    // Arrange: Cursor has a real folder named "frontend-design" → local skill.
    // Codex has a broken symlink with the same name → source missing, orphan.
    // Naive first-wins (which the original merge used) would keep only the
    // local record and silently drop codex's broken status — recreating the
    // visibility hole this PR's main fix addressed.
    readdirMock.mockImplementation(async (path: string) => {
      if (path === '/mock/source/skills') return []
      if (path === '/mock/agents/cursor/skills') {
        return [
          createDirent('frontend-design', {
            isDirectory: true,
            isSymbolicLink: false,
          }),
        ]
      }
      if (path === '/mock/agents/codex/skills') {
        return [
          createDirent('frontend-design', {
            isDirectory: false,
            isSymbolicLink: true,
          }),
        ]
      }
      return []
    })
    accessMock.mockImplementation(async (path: string) => {
      if (path === '/mock/agents/cursor/skills/frontend-design/SKILL.md') return
      throw new Error(`ENOENT: ${path}`)
    })
    statMock.mockImplementation(async (path: string) => {
      if (path === '/mock/agents/cursor/skills/frontend-design/SKILL.md') {
        return { isFile: () => true }
      }
      throw new Error(`ENOENT: ${path}`)
    })
    mockLstatDirectories(['/mock/agents/cursor/skills/frontend-design'])
    checkSymlinkTargetFromKnownLinkMock.mockImplementation(
      async (linkPath: string) => {
        if (linkPath === '/mock/agents/codex/skills/frontend-design')
          return 'broken'
        return 'missing'
      },
    )
    const { scanSkills } = await import('./skillScanner')

    // Act
    const skills = await scanSkills()

    // Assert
    expect(skills).toHaveLength(1)
    const merged = skills[0]
    expect(merged.name).toBe('frontend-design')
    const cursor = merged.symlinks.find((s) => s.agentId === 'cursor')
    const codex = merged.symlinks.find((s) => s.agentId === 'codex')
    expect(cursor).toMatchObject({ status: 'valid', isLocal: true })
    expect(codex).toMatchObject({ status: 'broken', isLocal: false })
    // Once a real local folder is present, the merged record is no longer an
    // orphan — the UI delete button must remain reachable.
    expect(merged.isOrphan).toBe(false)
  })
})

describe('scanSkills result ordering', () => {
  beforeEach(() => {
    readdirMock.mockReset()
    accessMock.mockReset()
    statMock.mockReset()
    lstatMock.mockReset()
    readFileMock.mockReset()
    readFileMock.mockRejectedValue(new Error('ENOENT'))
    checkSymlinkTargetFromKnownLinkMock.mockReset()
    checkSymlinkTargetFromKnownLinkMock.mockResolvedValue('missing')
    readSymlinkTargetIfPresentMock.mockReset()
    readSymlinkTargetIfPresentMock.mockResolvedValue(undefined)
    countValidSymlinksMock.mockClear()
  })

  it('lists skills alphabetically by name regardless of on-disk directory order', async () => {
    // Arrange: source dir returns two valid skills in reverse-alphabetical
    // order on disk ("zeta-skill" before "alpha-skill"). The sidebar and the
    // central inventory both render this array as-is, so a stable A→Z order is
    // the contract — only the final name comparator can flip the disk order.
    readdirMock.mockImplementation(async (path: string) => {
      if (path === '/mock/source/skills') {
        return [
          createDirent('zeta-skill', {
            isDirectory: true,
            isSymbolicLink: false,
          }),
          createDirent('alpha-skill', {
            isDirectory: true,
            isSymbolicLink: false,
          }),
        ]
      }
      return []
    })
    statMock.mockImplementation(async (path: string) => {
      if (
        path === '/mock/source/skills/zeta-skill/SKILL.md' ||
        path === '/mock/source/skills/alpha-skill/SKILL.md'
      ) {
        return { isFile: () => true }
      }
      throw new Error(`ENOENT: ${path}`)
    })
    mockLstatDirectories([
      '/mock/source/skills/zeta-skill',
      '/mock/source/skills/alpha-skill',
    ])
    const { scanSkills } = await import('./skillScanner')

    // Act
    const skills = await scanSkills()

    // Assert: comparator sorted the reverse-order disk listing into A→Z.
    expect(skills).toHaveLength(2)
    expect(skills[0].name).toBe('alpha-skill')
    expect(skills[1].name).toBe('zeta-skill')
  })
})

describe('scanSkills source attribution from lock file', () => {
  beforeEach(() => {
    readdirMock.mockReset()
    accessMock.mockReset()
    statMock.mockReset()
    lstatMock.mockReset()
    readFileMock.mockReset()
    readFileMock.mockRejectedValue(new Error('ENOENT'))
    checkSymlinkTargetFromKnownLinkMock.mockReset()
    checkSymlinkTargetFromKnownLinkMock.mockResolvedValue('missing')
    readSymlinkTargetIfPresentMock.mockReset()
    readSymlinkTargetIfPresentMock.mockResolvedValue(undefined)
    countValidSymlinksMock.mockClear()
  })

  it('shows the GitHub source and clone URL on a skill listed in the lock file', async () => {
    // Arrange: one live source skill "frontend-design", and a lock file that
    // records where that skill was installed from. The marketplace badge and
    // "open source repo" link depend on these fields being copied onto the row.
    readdirMock.mockImplementation(async (path: string) => {
      if (path === '/mock/source/skills') {
        return [
          createDirent('frontend-design', {
            isDirectory: true,
            isSymbolicLink: false,
          }),
        ]
      }
      return []
    })
    statMock.mockImplementation(async (path: string) => {
      if (path === '/mock/source/skills/frontend-design/SKILL.md') {
        return { isFile: () => true }
      }
      throw new Error(`ENOENT: ${path}`)
    })
    mockLstatDirectories(['/mock/source/skills/frontend-design'])
    readFileMock.mockResolvedValue(
      JSON.stringify({
        skills: {
          'frontend-design': {
            source: 'pbakaus/impeccable',
            sourceType: 'github',
            sourceUrl: 'https://github.com/pbakaus/impeccable.git',
          },
        },
      }),
    )
    const { scanSkills } = await import('./skillScanner')

    // Act
    const skills = await scanSkills()

    // Assert
    expect(skills).toHaveLength(1)
    expect(skills[0].source).toBe('pbakaus/impeccable')
    expect(skills[0].sourceUrl).toBe(
      'https://github.com/pbakaus/impeccable.git',
    )
  })

  it('leaves source fields unset for a skill absent from the lock file', async () => {
    // Arrange: lock file has an unrelated entry, so the present skill must NOT
    // inherit a stale source/sourceUrl — guards against attaching the wrong
    // repo to a skill.
    readdirMock.mockImplementation(async (path: string) => {
      if (path === '/mock/source/skills') {
        return [
          createDirent('frontend-design', {
            isDirectory: true,
            isSymbolicLink: false,
          }),
        ]
      }
      return []
    })
    statMock.mockImplementation(async (path: string) => {
      if (path === '/mock/source/skills/frontend-design/SKILL.md') {
        return { isFile: () => true }
      }
      throw new Error(`ENOENT: ${path}`)
    })
    mockLstatDirectories(['/mock/source/skills/frontend-design'])
    readFileMock.mockResolvedValue(
      JSON.stringify({
        skills: {
          'some-other-skill': {
            source: 'other/repo',
            sourceType: 'github',
            sourceUrl: 'https://github.com/other/repo.git',
          },
        },
      }),
    )
    const { scanSkills } = await import('./skillScanner')

    // Act
    const skills = await scanSkills()

    // Assert
    expect(skills).toHaveLength(1)
    expect(skills[0].source).toBeUndefined()
    expect(skills[0].sourceUrl).toBeUndefined()
  })

  it('treats a lock file with no skills key as having no source data', async () => {
    // Arrange: an older / partially-initialized lock file omits the `skills`
    // key entirely. Parsing must still succeed and yield an empty source map
    // rather than crashing the whole scan.
    readdirMock.mockImplementation(async (path: string) => {
      if (path === '/mock/source/skills') {
        return [
          createDirent('frontend-design', {
            isDirectory: true,
            isSymbolicLink: false,
          }),
        ]
      }
      return []
    })
    statMock.mockImplementation(async (path: string) => {
      if (path === '/mock/source/skills/frontend-design/SKILL.md') {
        return { isFile: () => true }
      }
      throw new Error(`ENOENT: ${path}`)
    })
    mockLstatDirectories(['/mock/source/skills/frontend-design'])
    readFileMock.mockResolvedValue(JSON.stringify({ version: 1 }))
    const { scanSkills } = await import('./skillScanner')

    // Act
    const skills = await scanSkills()

    // Assert
    expect(skills).toHaveLength(1)
    expect(skills[0].source).toBeUndefined()
  })
})

describe('scanSkills resilience to per-agent and source failures', () => {
  beforeEach(() => {
    readdirMock.mockReset()
    accessMock.mockReset()
    statMock.mockReset()
    lstatMock.mockReset()
    readFileMock.mockReset()
    readFileMock.mockRejectedValue(new Error('ENOENT'))
    checkSymlinkTargetFromKnownLinkMock.mockReset()
    checkSymlinkTargetFromKnownLinkMock.mockResolvedValue('missing')
    readSymlinkTargetIfPresentMock.mockReset()
    readSymlinkTargetIfPresentMock.mockResolvedValue(undefined)
    // Restore the default metadata parser before tests that override it for
    // corrupt-frontmatter / readable-sibling scenarios.
    parseSkillMetadataMock.mockReset()
    parseSkillMetadataMock.mockImplementation(async (path: string) => ({
      name: basename(path),
      description: 'mock description',
    }))
    countValidSymlinksMock.mockClear()
  })

  it('keeps scanning when one agent directory cannot be read', async () => {
    // Arrange: codex's skills dir read fails outright (e.g. EACCES). Both the
    // local-folder scan and the symlink-status scan must swallow that agent's
    // failure and still return cursor's valid local skill instead of aborting.
    readdirMock.mockImplementation(async (path: string) => {
      if (path === '/mock/source/skills') return []
      if (path === '/mock/agents/codex/skills') {
        throw createFsError('EACCES: permission denied', 'EACCES')
      }
      if (path === '/mock/agents/cursor/skills') {
        return [
          createDirent('frontend-design', {
            isDirectory: true,
            isSymbolicLink: false,
          }),
        ]
      }
      return []
    })
    statMock.mockImplementation(async (path: string) => {
      if (path === '/mock/agents/cursor/skills/frontend-design/SKILL.md') {
        return { isFile: () => true }
      }
      throw new Error(`ENOENT: ${path}`)
    })
    mockLstatDirectories(['/mock/agents/cursor/skills/frontend-design'])
    const { scanSkills } = await import('./skillScanner')

    // Act
    const skills = await scanSkills()

    // Assert
    expect(skills).toHaveLength(1)
    expect(skills[0].name).toBe('frontend-design')
    const cursor = skills[0].symlinks.find((s) => s.agentId === 'cursor')
    expect(cursor).toMatchObject({ status: 'valid', isLocal: true })
  })

  it('aborts the whole scan when a source skill fails with a non-missing error', async () => {
    // Arrange: the source dir lists a skill that passes SKILL.md validation,
    // but capturing its filesystem identity fails with EACCES (not ENOENT).
    // A permission fault is not a benign race, so the scan must surface it
    // rather than silently dropping the row.
    readdirMock.mockImplementation(async (path: string) => {
      if (path === '/mock/source/skills') {
        return [
          createDirent('protected-skill', {
            isDirectory: true,
            isSymbolicLink: false,
          }),
        ]
      }
      return []
    })
    statMock.mockImplementation(async (path: string) => {
      if (path === '/mock/source/skills/protected-skill/SKILL.md') {
        return { isFile: () => true }
      }
      throw new Error(`ENOENT: ${path}`)
    })
    lstatMock.mockImplementation(async (path: string) => {
      if (path === '/mock/source/skills/protected-skill') {
        throw createFsError('EACCES: permission denied', 'EACCES')
      }
      throw createFsError(`ENOENT: ${path}`, 'ENOENT')
    })
    const { scanSkills } = await import('./skillScanner')

    // Act + Assert
    await expect(scanSkills()).rejects.toThrow('EACCES: permission denied')
  })

  it('drops a valid agent link whose target metadata cannot be parsed', async () => {
    // Arrange: codex has a "valid" symlink whose target exists but whose
    // SKILL.md cannot be parsed (corrupt frontmatter). That link must be
    // dropped from the linked list rather than surfacing a half-built row.
    readdirMock.mockImplementation(async (path: string) => {
      if (path === '/mock/source/skills') return []
      if (path === '/mock/agents/codex/skills') {
        return [
          createDirent('corrupt-link', {
            isDirectory: false,
            isSymbolicLink: true,
          }),
        ]
      }
      return []
    })
    statMock.mockRejectedValue(new Error('ENOENT'))
    checkSymlinkTargetFromKnownLinkMock.mockImplementation(
      async (linkPath: string) => {
        if (linkPath === '/mock/agents/codex/skills/corrupt-link')
          return 'valid'
        return 'missing'
      },
    )
    readSymlinkTargetIfPresentMock.mockImplementation(
      async (linkPath: string) => {
        if (linkPath === '/mock/agents/codex/skills/corrupt-link') {
          return '/mock/external/corrupt-link'
        }
        return undefined
      },
    )
    // parseSkillMetadata throws ONLY for the corrupt target path; the source
    // mock returns a benign description for everything else.
    parseSkillMetadataMock.mockImplementation(async (path: string) => {
      if (path === '/mock/external/corrupt-link') {
        throw new Error('invalid frontmatter')
      }
      return { name: basename(path), description: 'mock description' }
    })
    const { scanSkills } = await import('./skillScanner')

    // Act
    const skills = await scanSkills()

    // Assert: no row survives for the unparseable link.
    expect(skills).toHaveLength(0)
  })

  it('drops a valid agent link whose target path cannot be read', async () => {
    // Arrange: codex has a "valid" symlink, but readSymlinkTargetIfPresent
    // returns undefined for it (the link resolves as valid yet its target path
    // cannot be read back). With no target path there is no SKILL.md to parse,
    // so the link must be dropped rather than surfacing a row with no source.
    readdirMock.mockImplementation(async (path: string) => {
      if (path === '/mock/source/skills') return []
      if (path === '/mock/agents/codex/skills') {
        return [
          createDirent('unreadable-link', {
            isDirectory: false,
            isSymbolicLink: true,
          }),
        ]
      }
      return []
    })
    statMock.mockRejectedValue(new Error('ENOENT'))
    checkSymlinkTargetFromKnownLinkMock.mockImplementation(
      async (linkPath: string) => {
        if (linkPath === '/mock/agents/codex/skills/unreadable-link') {
          return 'valid'
        }
        return 'missing'
      },
    )
    // Target path is unreadable for the valid link — undefined for every path.
    readSymlinkTargetIfPresentMock.mockResolvedValue(undefined)
    const { scanSkills } = await import('./skillScanner')

    // Act
    const skills = await scanSkills()

    // Assert: no row survives for the link whose target path is unreadable.
    expect(skills).toHaveLength(0)
  })

  it('upgrades an inaccessible link record to readable metadata when a valid sibling link is found', async () => {
    // Arrange: two agents link the SAME skill name "shared-skill". Codex's link
    // is inaccessible (seen first), cursor's link is valid with parseable
    // metadata. The grouped record must adopt cursor's real description and
    // target path instead of staying on the inaccessible placeholder.
    readdirMock.mockImplementation(async (path: string) => {
      if (path === '/mock/source/skills') return []
      if (path === '/mock/agents/codex/skills') {
        return [
          createDirent('shared-skill', {
            isDirectory: false,
            isSymbolicLink: true,
          }),
        ]
      }
      if (path === '/mock/agents/cursor/skills') {
        return [
          createDirent('shared-skill', {
            isDirectory: false,
            isSymbolicLink: true,
          }),
        ]
      }
      return []
    })
    statMock.mockRejectedValue(new Error('ENOENT'))
    checkSymlinkTargetFromKnownLinkMock.mockImplementation(
      async (linkPath: string) => {
        if (linkPath === '/mock/agents/codex/skills/shared-skill') {
          return 'inaccessible'
        }
        if (linkPath === '/mock/agents/cursor/skills/shared-skill') {
          return 'valid'
        }
        return 'missing'
      },
    )
    readSymlinkTargetIfPresentMock.mockImplementation(
      async (linkPath: string) => {
        if (linkPath === '/mock/agents/cursor/skills/shared-skill') {
          return '/mock/external/shared-skill'
        }
        return undefined
      },
    )
    parseSkillMetadataMock.mockImplementation(async (path: string) => {
      if (path === '/mock/external/shared-skill') {
        return { name: 'shared-skill', description: 'readable description' }
      }
      return { name: basename(path), description: 'mock description' }
    })
    const { scanSkills } = await import('./skillScanner')

    // Act
    const skills = await scanSkills()

    // Assert
    expect(skills).toHaveLength(1)
    const upgraded = skills[0]
    expect(upgraded.name).toBe('shared-skill')
    expect(upgraded.description).toBe('readable description')
    expect(upgraded.path).toBe('/mock/external/shared-skill')
  })
})

describe('getSkill single-skill lookup', () => {
  beforeEach(() => {
    readdirMock.mockReset()
    accessMock.mockReset()
    statMock.mockReset()
    lstatMock.mockReset()
    checkSymlinkTargetFromKnownLinkMock.mockReset()
    readSymlinkTargetIfPresentMock.mockReset()
    parseSkillMetadataMock.mockReset()
    parseSkillMetadataMock.mockImplementation(async (path: string) => ({
      name: basename(path),
      description: 'mock description',
    }))
    countValidSymlinksMock.mockClear()
  })

  it('returns the full skill record when the named directory exists in the source dir', async () => {
    // Arrange: stat resolves to a directory for the requested skill path.
    statMock.mockImplementation(async (path: string) => {
      if (path === '/mock/source/skills/theme-generator') {
        return { isDirectory: () => true }
      }
      throw new Error(`ENOENT: ${path}`)
    })
    const { getSkill } = await import('./skillScanner')

    // Act
    const skill = await getSkill('theme-generator')

    // Assert
    expect(skill).not.toBeNull()
    expect(skill?.name).toBe('theme-generator')
    expect(skill?.path).toBe('/mock/source/skills/theme-generator')
    expect(skill?.isSource).toBe(true)
    expect(skill?.isOrphan).toBe(false)
    expect(skill?.symlinkCount).toBe(0)
  })

  it('returns null when the named path exists but is a file, not a directory', async () => {
    // Arrange: stat resolves but the path is a regular file — not a skill dir.
    statMock.mockImplementation(async (path: string) => {
      if (path === '/mock/source/skills/not-a-dir') {
        return { isDirectory: () => false }
      }
      throw new Error(`ENOENT: ${path}`)
    })
    const { getSkill } = await import('./skillScanner')

    // Act
    const skill = await getSkill('not-a-dir')

    // Assert
    expect(skill).toBeNull()
  })

  it('returns null when the named skill directory does not exist', async () => {
    // Arrange: stat rejects (ENOENT) for the requested path.
    statMock.mockRejectedValue(new Error('ENOENT'))
    const { getSkill } = await import('./skillScanner')

    // Act
    const skill = await getSkill('missing-skill')

    // Assert
    expect(skill).toBeNull()
  })
})

describe('getSourceStats source directory summary', () => {
  beforeEach(() => {
    readdirMock.mockReset()
    accessMock.mockReset()
    statMock.mockReset()
    lstatMock.mockReset()
    checkSymlinkTargetFromKnownLinkMock.mockReset()
    readSymlinkTargetIfPresentMock.mockReset()
    countValidSymlinksMock.mockClear()
  })

  it('reports skill count, human-readable total size, and last-modified time', async () => {
    // Arrange: source dir holds one valid skill folder containing a SKILL.md
    // (2048 bytes) plus a nested assets dir with one PNG (1024 bytes). The
    // summary must count the skill and sum the byte totals recursively.
    readdirMock.mockImplementation(async (path: string) => {
      if (path === '/mock/source/skills') {
        return [
          createDirent('demo-skill', {
            isDirectory: true,
            isSymbolicLink: false,
          }),
        ]
      }
      if (path === '/mock/source/skills/demo-skill') {
        return [
          {
            name: 'SKILL.md',
            isDirectory: () => false,
            isFile: () => true,
          },
          {
            name: 'assets',
            isDirectory: () => true,
            isFile: () => false,
          },
        ]
      }
      if (path === '/mock/source/skills/demo-skill/assets') {
        return [
          {
            name: 'logo.png',
            isDirectory: () => false,
            isFile: () => true,
          },
        ]
      }
      return []
    })
    statMock.mockImplementation(async (path: string) => {
      // listValidSourceSkillDirs validates SKILL.md via stat().isFile()
      if (path === '/mock/source/skills/demo-skill/SKILL.md') {
        return { isFile: () => true, isDirectory: () => false, size: 2048 }
      }
      if (path === '/mock/source/skills/demo-skill/assets/logo.png') {
        return { isFile: () => true, isDirectory: () => false, size: 1024 }
      }
      // stat(SOURCE_DIR) for lastModified
      if (path === '/mock/source/skills') {
        return {
          isDirectory: () => true,
          mtime: new Date('2026-06-14T00:00:00.000Z'),
        }
      }
      throw new Error(`ENOENT: ${path}`)
    })
    const { getSourceStats } = await import('./skillScanner')

    // Act
    const sourceStats = await getSourceStats()

    // Assert
    expect(sourceStats.path).toBe('/mock/source/skills')
    expect(sourceStats.skillCount).toBe(1)
    expect(sourceStats.totalSize).toBe('3.0 KB')
    expect(sourceStats.lastModified).toBe('2026-06-14T00:00:00.000Z')
  })

  it('excludes symlink entries from the recursive size total', async () => {
    // Arrange: source dir holds one valid skill folder with a SKILL.md (2048B)
    // and a nested assets dir containing a PNG (1024B) plus a symlink entry
    // (neither a directory nor a regular file). The size walk must count only
    // real files — symlinks (and other special entries) contribute 0 bytes, so
    // the reported total stays 3072B regardless of dangling links in the tree.
    readdirMock.mockImplementation(async (path: string) => {
      if (path === '/mock/source/skills') {
        return [
          createDirent('demo-skill', {
            isDirectory: true,
            isSymbolicLink: false,
          }),
        ]
      }
      if (path === '/mock/source/skills/demo-skill') {
        return [
          {
            name: 'SKILL.md',
            isDirectory: () => false,
            isFile: () => true,
          },
          {
            name: 'assets',
            isDirectory: () => true,
            isFile: () => false,
          },
        ]
      }
      if (path === '/mock/source/skills/demo-skill/assets') {
        return [
          {
            name: 'logo.png',
            isDirectory: () => false,
            isFile: () => true,
          },
          {
            name: 'broken-link',
            isDirectory: () => false,
            isFile: () => false,
          },
        ]
      }
      return []
    })
    statMock.mockImplementation(async (path: string) => {
      if (path === '/mock/source/skills/demo-skill/SKILL.md') {
        return { isFile: () => true, isDirectory: () => false, size: 2048 }
      }
      if (path === '/mock/source/skills/demo-skill/assets/logo.png') {
        return { isFile: () => true, isDirectory: () => false, size: 1024 }
      }
      if (path === '/mock/source/skills') {
        return {
          isDirectory: () => true,
          mtime: new Date('2026-06-14T00:00:00.000Z'),
        }
      }
      throw new Error(`ENOENT: ${path}`)
    })
    const { getSourceStats } = await import('./skillScanner')

    // Act
    const sourceStats = await getSourceStats()

    // Assert: the symlink entry is uncounted; only SKILL.md + logo.png sum.
    expect(sourceStats.totalSize).toBe('3.0 KB')
  })

  it('falls back to a zero-byte placeholder when the source dir cannot be stat-ed', async () => {
    // Arrange: listValidSourceSkillDirs succeeds (empty), but stat(SOURCE_DIR)
    // throws — getSourceStats must degrade gracefully instead of rejecting.
    readdirMock.mockResolvedValue([])
    statMock.mockRejectedValue(new Error('EACCES: permission denied'))
    const { getSourceStats } = await import('./skillScanner')

    // Act
    const sourceStats = await getSourceStats()

    // Assert
    expect(sourceStats.path).toBe('/mock/source/skills')
    expect(sourceStats.skillCount).toBe(0)
    expect(sourceStats.totalSize).toBe('0 B')
    expect(typeof sourceStats.lastModified).toBe('string')
  })
})
