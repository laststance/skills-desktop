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
const lstatMock = vi.fn()

vi.mock('fs/promises', () => ({
  readdir: readdirMock,
  access: accessMock,
  lstat: lstatMock,
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
    // cline + warp both alias SOURCE_DIR — the v0.13.0 shape that must
    // never render as individual sidebar rows
    { id: 'cline', name: 'Cline', path: '/mock/source/skills' },
    { id: 'warp', name: 'Warp', path: '/mock/source/skills' },
  ],
  SHARED_AGENT_PATHS: new Set(['/mock/source/skills']),
}))

describe('scanAgents', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    lstatMock.mockResolvedValue({
      isSymbolicLink: () => false,
      isDirectory: () => true,
      isFile: () => false,
      dev: 1,
      ino: 2,
      size: 96,
      ctimeMs: 3,
      mtimeMs: 4,
    })
  })

  it('counts a skill toward an agent only when its symlink resolves, ignoring broken links', async () => {
    // Arrange
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

    // Act
    const { scanAgents } = await import('./agentScanner')
    const agents = await scanAgents()

    // Assert
    const claude = agents.find((a) => a.id === 'claude-code')!
    expect(claude.exists).toBe(true)
    expect(claude.skillCount).toBe(3)
    expect(claude.localSkillCount).toBe(0)
  })

  it('counts zero skills when every symlink is broken', async () => {
    // Arrange
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

    // Act
    const { scanAgents } = await import('./agentScanner')
    const agents = await scanAgents()

    // Assert
    const claude = agents.find((a) => a.id === 'claude-code')!
    expect(claude.skillCount).toBe(0)
  })

  it('tallies local folder skills separately from symlinked skills', async () => {
    // Arrange
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

    // Act
    const { scanAgents } = await import('./agentScanner')
    const agents = await scanAgents()

    // Assert
    const claude = agents.find((a) => a.id === 'claude-code')!
    expect(claude.skillCount).toBe(1)
    expect(claude.localSkillCount).toBe(1)
  })

  it('marks an agent as not existing with zero counts when its skills dir is absent', async () => {
    // Arrange
    accessMock.mockImplementation(async (path: string) => {
      if (path === '/mock/agents/claude/skills') {
        throw new Error('ENOENT')
      }
      // Cursor exists but empty
      return
    })

    readdirMock.mockResolvedValue([])

    // Act
    const { scanAgents } = await import('./agentScanner')
    const agents = await scanAgents()

    // Assert
    const claude = agents.find((a) => a.id === 'claude-code')!
    expect(claude.exists).toBe(false)
    expect(claude.skillCount).toBe(0)
    expect(claude.localSkillCount).toBe(0)
  })

  it('lists existing agents ahead of missing ones, then alphabetically by name', async () => {
    // Arrange
    accessMock.mockImplementation(async (path: string) => {
      // Claude doesn't exist; cursor + the universal-resolving rows (cline,
      // warp both point at /mock/source/skills in the mock) do.
      if (path === '/mock/agents/claude/skills') {
        throw new Error('ENOENT')
      }
      return
    })

    readdirMock.mockResolvedValue([])

    // Act
    const { scanAgents } = await import('./agentScanner')
    const agents = await scanAgents()

    // Assert
    // Existing rows sort first, then alphabetically by name:
    //   Cline, Cursor, Warp (exists=true) → Claude Code (exists=false)
    expect(agents.map((a) => a.id)).toEqual([
      'cline',
      'cursor',
      'warp',
      'claude-code',
    ])
    expect(agents[agents.length - 1].exists).toBe(false)
  })

  it('keeps every agent visible even when its CLI dir resolves to the Universal source', async () => {
    // Arrange
    accessMock.mockResolvedValue(undefined)
    readdirMock.mockResolvedValue([])

    // Act
    const { scanAgents } = await import('./agentScanner')
    const agents = await scanAgents()

    // Assert
    // Cline + Warp currently resolve to the Universal source in the mock.
    // We still render them AND pin `exists: true` — the dedicated/universal
    // relationship is a dual-source READ, not an alias. Hiding rows or
    // silently marking them non-existent would break direct-file workflows
    // (e.g. Cursor autocomplete needs file copies, not symlinks, inside
    // the agent-specific dir). Data safety lives at the IPC layer:
    // SKILLS_REMOVE_ALL_FROM_AGENT rejects SHARED_AGENT_PATHS targets.
    const cline = agents.find((a) => a.id === 'cline')!
    const warp = agents.find((a) => a.id === 'warp')!
    expect(cline.exists).toBe(true)
    expect(warp.exists).toBe(true)
    expect(agents.find((a) => a.id === 'claude-code')).toBeDefined()
    expect(agents.find((a) => a.id === 'cursor')).toBeDefined()
  })

  it('skips dot-prefixed directories when counting local skills', async () => {
    // Arrange
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

    // Act
    const { scanAgents } = await import('./agentScanner')
    const agents = await scanAgents()

    // Assert
    const claude = agents.find((a) => a.id === 'claude-code')!
    // .hidden-dir is excluded, visible-skill has SKILL.md (access resolves)
    expect(claude.localSkillCount).toBe(1)
  })

  it('ignores a local directory that has no SKILL.md when counting local skills', async () => {
    // Arrange
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

    // Act
    const { scanAgents } = await import('./agentScanner')
    const agents = await scanAgents()

    // Assert
    const claude = agents.find((a) => a.id === 'claude-code')!
    expect(claude.localSkillCount).toBe(0)
  })
})
