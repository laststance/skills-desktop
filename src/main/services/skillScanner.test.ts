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

vi.mock('fs/promises', () => ({
  readdir: readdirMock,
  access: accessMock,
  stat: statMock,
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

vi.mock('./symlinkChecker', () => ({
  checkSkillSymlinks: vi.fn(async () => []),
  countValidSymlinks: vi.fn(() => 0),
  checkSymlinkTargetFromKnownLink: checkSymlinkTargetFromKnownLinkMock,
}))

describe('scanSkills local skill aggregation', () => {
  beforeEach(() => {
    readdirMock.mockReset()
    accessMock.mockReset()
    checkSymlinkTargetFromKnownLinkMock.mockReset()
    checkSymlinkTargetFromKnownLinkMock.mockResolvedValue('missing')

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
})

describe('scanSkills orphan symlink surfacing (issue #127)', () => {
  beforeEach(() => {
    readdirMock.mockReset()
    accessMock.mockReset()
    statMock.mockReset()
    checkSymlinkTargetFromKnownLinkMock.mockReset()
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
    expect(codex).toMatchObject({ status: 'broken', isLocal: false })
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
    checkSymlinkTargetFromKnownLinkMock.mockResolvedValue('broken')

    const { scanSkills } = await import('./skillScanner')
    const skills = await scanSkills()

    // Exactly one record — the live source skill, no separate orphan.
    expect(skills).toHaveLength(1)
    expect(skills[0].name).toBe('theme-generator')
    expect(skills[0].isSource).toBe(true)
  })
})
