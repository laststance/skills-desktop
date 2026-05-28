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
}))

vi.mock('../constants', () => ({
  SOURCE_DIR: '/mock/source/skills',
  AGENTS: [
    { id: 'codex', name: 'Codex', path: '/mock/agents/codex/skills' },
    { id: 'cursor', name: 'Cursor', path: '/mock/agents/cursor/skills' },
  ],
}))

vi.mock('./metadataParser', () => ({
  /**
   * Parse skill metadata from path.
   * @param path - Skill directory path
   * @returns Name and static description for tests
   */
  parseSkillMetadata: async (path: string) => ({
    name: basename(path),
    description: 'mock description',
  }),
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
    const { scanSkills } = await import('./skillScanner')

    const skills = await scanSkills()
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
    const skills = await scanSkills()

    expect(skills).toHaveLength(1)
    const codex = skills[0].symlinks.find((s) => s.agentId === 'codex')
    expect(codex?.skillMdSymlinkTarget).toBe(
      '/mock/.claude/skills/gstack/frontend-design/SKILL.md',
    )
  })

  it('leaves skillMdSymlinkTarget undefined on every slot when SKILL.md is a regular file', async () => {
    // Default mock returns undefined — explicit assertion guards against
    // someone later changing the default and silently flipping the badge on.
    const { scanSkills } = await import('./skillScanner')
    const skills = await scanSkills()

    expect(skills).toHaveLength(1)
    for (const slot of skills[0].symlinks) {
      expect(slot.skillMdSymlinkTarget).toBeUndefined()
    }
  })

  it('binds skillMdSymlinkTarget to the slot that detected it without bleeding to sibling agents', async () => {
    // codex slot is a gstack-managed twin (SKILL.md symlinks into gstack);
    // cursor slot is a plain local folder. Per-agent attribution: codex's
    // slot must carry the target, cursor's slot must NOT — otherwise the
    // badge would falsely appear on cursor's unrelated copy.
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
    const skills = await scanSkills()

    expect(skills).toHaveLength(1)
    const codex = skills[0].symlinks.find((s) => s.agentId === 'codex')
    const cursor = skills[0].symlinks.find((s) => s.agentId === 'cursor')
    expect(codex?.skillMdSymlinkTarget).toBe(
      '/mock/.claude/skills/gstack/frontend-design/SKILL.md',
    )
    expect(cursor?.skillMdSymlinkTarget).toBeUndefined()
  })
})

describe('scanSkills agent-only linked symlink surfacing', () => {
  beforeEach(() => {
    readdirMock.mockReset()
    accessMock.mockReset()
    statMock.mockReset()
    lstatMock.mockReset()
    lstatMock.mockRejectedValue(new Error('ENOENT'))
    checkSymlinkTargetFromKnownLinkMock.mockReset()
    readSymlinkTargetIfPresentMock.mockReset()
    readSymlinkTargetIfPresentMock.mockResolvedValue(undefined)
    countValidSymlinksMock.mockClear()
  })

  it('surfaces valid agent symlinks whose names are not in the source directory', async () => {
    // Codex has a valid gstack-managed symlink, but ~/.agents/skills has no
    // matching source directory. The sidebar count includes this link, so the
    // central agent view must include a linked card for the same on-disk entry.
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
    const skills = await scanSkills()

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
    const skills = await scanSkills()

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
})

describe('scanSkills orphan symlink surfacing (issue #127)', () => {
  beforeEach(() => {
    readdirMock.mockReset()
    accessMock.mockReset()
    statMock.mockReset()
    lstatMock.mockReset()
    lstatMock.mockRejectedValue(new Error('ENOENT'))
    checkSymlinkTargetFromKnownLinkMock.mockReset()
    readSymlinkTargetIfPresentMock.mockReset()
    readSymlinkTargetIfPresentMock.mockResolvedValue(undefined)
    countValidSymlinksMock.mockClear()
  })

  it('surfaces broken symlinks whose source is missing as orphan Skill records', async () => {
    // Source dir empty; codex has 1 broken symlink "connect-chrome".
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
    const skills = await scanSkills()

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
    const skills = await scanSkills()

    expect(skills).toHaveLength(1)
    const orphan = skills[0]
    const codex = orphan.symlinks.find((s) => s.agentId === 'codex')
    const cursor = orphan.symlinks.find((s) => s.agentId === 'cursor')
    expect(codex?.status).toBe('broken')
    expect(cursor?.status).toBe('broken')
  })

  it('does NOT create orphan record when name matches a live source skill', async () => {
    // Source has "theme-generator". Codex has a broken "theme-generator"
    // symlink — broken status belongs in the source skill's symlinks[], not
    // in a separate orphan record.
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
    const skills = await scanSkills()

    // Exactly one record — the live source skill, no separate orphan.
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
    // Cursor has a real folder named "frontend-design" → local skill.
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
    const skills = await scanSkills()

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
