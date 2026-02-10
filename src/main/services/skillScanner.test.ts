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

vi.mock('fs/promises', () => ({
  readdir: readdirMock,
  access: accessMock,
  stat: vi.fn(),
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

vi.mock('./symlinkChecker', () => ({
  checkSkillSymlinks: vi.fn(async () => []),
  countValidSymlinks: vi.fn(() => 0),
}))

describe('scanSkills local skill aggregation', () => {
  beforeEach(() => {
    readdirMock.mockReset()
    accessMock.mockReset()

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
