import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Create a minimal Dirent-like object for readdir mocks.
 * @param name - Entry name
 * @param options - Directory/symlink flags
 * @returns Dirent-compatible object used by scan logic
 * @example
 * createDirent('my-skill', { isDirectory: true, isSymbolicLink: true })
 */
function createDirent(
  name: string,
  options: { isDirectory: boolean; isSymbolicLink: boolean },
): {
  name: string
  isDirectory: () => boolean
  isSymbolicLink: () => boolean
} {
  return {
    name,
    isDirectory: () => options.isDirectory,
    isSymbolicLink: () => options.isSymbolicLink,
  }
}

const readdirMock = vi.fn()
const accessMock = vi.fn()

vi.mock('fs/promises', () => ({
  readdir: readdirMock,
  access: accessMock,
}))

const checkSymlinkStatusMock = vi.fn()

vi.mock('./symlinkChecker', () => ({
  checkSymlinkStatus: checkSymlinkStatusMock,
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

describe('scanAgents', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('counts only valid symlinks, excluding broken ones', async () => {
    // Both agent dirs exist
    accessMock.mockResolvedValue(undefined)

    readdirMock.mockImplementation(async (path: string) => {
      if (path === '/mock/agents/claude/skills') {
        return [
          createDirent('skill-a', { isDirectory: false, isSymbolicLink: true }),
          createDirent('skill-b', { isDirectory: false, isSymbolicLink: true }),
          createDirent('skill-c', { isDirectory: false, isSymbolicLink: true }),
          createDirent('skill-d', { isDirectory: false, isSymbolicLink: true }),
          createDirent('skill-e', { isDirectory: false, isSymbolicLink: true }),
        ]
      }
      return []
    })

    checkSymlinkStatusMock.mockImplementation(async (linkPath: string) => {
      // 3 valid, 2 broken
      if (
        linkPath.includes('skill-a') ||
        linkPath.includes('skill-b') ||
        linkPath.includes('skill-c')
      ) {
        return 'valid'
      }
      return 'broken'
    })

    const { scanAgents } = await import('./agentScanner')
    const agents = await scanAgents()

    const claude = agents.find((a) => a.id === 'claude-code')!
    expect(claude.exists).toBe(true)
    expect(claude.skillCount).toBe(3)
    expect(claude.localSkillCount).toBe(0)
  })

  it('returns skillCount 0 when all symlinks are broken', async () => {
    accessMock.mockResolvedValue(undefined)

    readdirMock.mockImplementation(async (path: string) => {
      if (path === '/mock/agents/claude/skills') {
        return [
          createDirent('broken-a', {
            isDirectory: false,
            isSymbolicLink: true,
          }),
          createDirent('broken-b', {
            isDirectory: false,
            isSymbolicLink: true,
          }),
        ]
      }
      return []
    })

    checkSymlinkStatusMock.mockResolvedValue('broken')

    const { scanAgents } = await import('./agentScanner')
    const agents = await scanAgents()

    const claude = agents.find((a) => a.id === 'claude-code')!
    expect(claude.skillCount).toBe(0)
  })

  it('counts local skills independently from symlinked skills', async () => {
    accessMock.mockImplementation(async (path: string) => {
      // Agent dirs exist
      if (path === '/mock/agents/claude/skills') return
      if (path === '/mock/agents/cursor/skills') return
      // SKILL.md exists for local-skill
      if (
        path === join('/mock/agents/claude/skills', 'local-skill', 'SKILL.md')
      )
        return
      throw new Error(`ENOENT: ${path}`)
    })

    readdirMock.mockImplementation(async (path: string) => {
      if (path === '/mock/agents/claude/skills') {
        return [
          createDirent('symlink-skill', {
            isDirectory: false,
            isSymbolicLink: true,
          }),
          createDirent('local-skill', {
            isDirectory: true,
            isSymbolicLink: false,
          }),
        ]
      }
      return []
    })

    checkSymlinkStatusMock.mockResolvedValue('valid')

    const { scanAgents } = await import('./agentScanner')
    const agents = await scanAgents()

    const claude = agents.find((a) => a.id === 'claude-code')!
    expect(claude.skillCount).toBe(1)
    expect(claude.localSkillCount).toBe(1)
  })

  it('returns exists: false with zero counts when agent dir is missing', async () => {
    accessMock.mockImplementation(async (path: string) => {
      if (path === '/mock/agents/claude/skills') {
        throw new Error('ENOENT')
      }
      // Cursor exists but empty
      return
    })

    readdirMock.mockResolvedValue([])

    const { scanAgents } = await import('./agentScanner')
    const agents = await scanAgents()

    const claude = agents.find((a) => a.id === 'claude-code')!
    expect(claude.exists).toBe(false)
    expect(claude.skillCount).toBe(0)
    expect(claude.localSkillCount).toBe(0)
  })

  it('sorts existing agents before non-existing agents', async () => {
    accessMock.mockImplementation(async (path: string) => {
      // Claude doesn't exist, Cursor does
      if (path === '/mock/agents/claude/skills') {
        throw new Error('ENOENT')
      }
      return
    })

    readdirMock.mockResolvedValue([])

    const { scanAgents } = await import('./agentScanner')
    const agents = await scanAgents()

    // Cursor exists -> sorted first
    expect(agents[0].id).toBe('cursor')
    expect(agents[0].exists).toBe(true)
    expect(agents[1].id).toBe('claude-code')
    expect(agents[1].exists).toBe(false)
  })

  it('excludes dot-prefixed directories from local skill count', async () => {
    accessMock.mockResolvedValue(undefined)

    readdirMock.mockImplementation(async (path: string) => {
      if (path === '/mock/agents/claude/skills') {
        return [
          createDirent('.hidden-dir', {
            isDirectory: true,
            isSymbolicLink: false,
          }),
          createDirent('visible-skill', {
            isDirectory: true,
            isSymbolicLink: false,
          }),
        ]
      }
      return []
    })

    const { scanAgents } = await import('./agentScanner')
    const agents = await scanAgents()

    const claude = agents.find((a) => a.id === 'claude-code')!
    // .hidden-dir is excluded, visible-skill has SKILL.md (access resolves)
    expect(claude.localSkillCount).toBe(1)
  })

  it('does not count local dirs without SKILL.md', async () => {
    accessMock.mockImplementation(async (path: string) => {
      // Agent dirs exist
      if (path === '/mock/agents/claude/skills') return
      if (path === '/mock/agents/cursor/skills') return
      // No SKILL.md in any local dir
      throw new Error(`ENOENT: ${path}`)
    })

    readdirMock.mockImplementation(async (path: string) => {
      if (path === '/mock/agents/claude/skills') {
        return [
          createDirent('no-skillmd', {
            isDirectory: true,
            isSymbolicLink: false,
          }),
        ]
      }
      return []
    })

    const { scanAgents } = await import('./agentScanner')
    const agents = await scanAgents()

    const claude = agents.find((a) => a.id === 'claude-code')!
    expect(claude.localSkillCount).toBe(0)
  })
})
