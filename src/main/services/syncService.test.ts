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
const statMock = vi.fn()
const rmMock = vi.fn()
const symlinkMock = vi.fn()
const mkdirMock = vi.fn()

vi.mock('fs/promises', () => ({
  lstat: lstatMock,
  readdir: readdirMock,
  access: accessMock,
  stat: statMock,
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
    // Default: SKILL.md exists as a regular file (used by isValidSkillDir)
    statMock.mockResolvedValue({ isFile: () => true })
  })

  it('reports nothing to sync when there are no source skills', async () => {
    // Arrange
    readdirMock.mockResolvedValue([])
    const { syncPreview } = await import('./syncService')

    // Act
    const result = await syncPreview()

    // Assert
    expect(result.totalSkills).toBe(0)
    expect(result.totalAgents).toBe(2)
    expect(result.toCreate).toBe(0)
    expect(result.alreadySynced).toBe(0)
    expect(result.conflicts).toHaveLength(0)
  })

  it('reports an existing symlink in every agent as already synced', async () => {
    // Arrange
    readdirMock.mockImplementation(async (dir: string) => {
      if (dir === '/mock/source/skills') {
        return [{ name: 'my-skill', isDirectory: () => true }]
      }
      return []
    })
    accessMock.mockResolvedValue(undefined)
    lstatMock.mockResolvedValue(createStats({ isSymbolicLink: true }))
    const { syncPreview } = await import('./syncService')

    // Act
    const result = await syncPreview()

    // Assert
    expect(result.totalSkills).toBe(1)
    expect(result.alreadySynced).toBe(2) // 1 skill × 2 agents
    expect(result.toCreate).toBe(0)
    expect(result.conflicts).toHaveLength(0)
  })

  it('reports a missing skill link in every agent as needing creation', async () => {
    // Arrange
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

    // Act
    const result = await syncPreview()

    // Assert
    expect(result.toCreate).toBe(2) // 1 skill × 2 agents
    expect(result.alreadySynced).toBe(0)
    expect(result.conflicts).toHaveLength(0)
  })

  it('flags a real local folder that shadows a source skill as a conflict', async () => {
    // Arrange
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

    // Act
    const result = await syncPreview()

    // Assert
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

  it('tallies synced, conflict, and create states per agent across a mix of skills', async () => {
    // Arrange
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

    // Act
    const result = await syncPreview()

    // Assert
    expect(result.alreadySynced).toBe(2) // synced-skill in both agents
    expect(result.conflicts).toHaveLength(1) // conflict-skill in claude
    expect(result.toCreate).toBe(1) // conflict-skill in cursor
  })

  it('reports an empty preview when the source dir cannot be read', async () => {
    // Arrange
    readdirMock.mockRejectedValue(new Error('EACCES'))
    const { syncPreview } = await import('./syncService')

    // Act
    const result = await syncPreview()

    // Assert
    expect(result.totalSkills).toBe(0)
    expect(result.conflicts).toHaveLength(0)
  })
})

describe('syncExecute', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    accessMock.mockResolvedValue(undefined)
    // Default: SKILL.md exists as a regular file (used by isValidSkillDir)
    statMock.mockResolvedValue({ isFile: () => true })
    mkdirMock.mockResolvedValue(undefined)
    symlinkMock.mockResolvedValue(undefined)
    rmMock.mockResolvedValue(undefined)
  })

  it('creates a symlink for every agent missing the skill', async () => {
    // Arrange
    readdirMock.mockImplementation(async (dir: string) => {
      if (dir === '/mock/source/skills') {
        return [{ name: 'new-skill', isDirectory: () => true }]
      }
      return []
    })
    accessMock.mockResolvedValue(undefined)
    lstatMock.mockRejectedValue(new Error('ENOENT'))
    const { syncExecute } = await import('./syncService')

    // Act
    const result = await syncExecute({ replaceConflicts: [] })

    // Assert
    expect(result.created).toBe(2) // 1 skill × 2 agents
    expect(result.replaced).toBe(0)
    expect(result.skipped).toBe(0)
    expect(result.success).toBe(true)
    expect(result.details).toHaveLength(2)
    expect(result.details[0]).toMatchObject({
      skillName: 'new-skill',
      agentName: 'Claude Code',
      action: 'created',
    })
    expect(symlinkMock).toHaveBeenCalledTimes(2)
    expect(symlinkMock).toHaveBeenCalledWith(
      join('/mock/source/skills', 'new-skill'),
      join('/mock/agents/claude/skills', 'new-skill'),
    )
  })

  it('leaves an already-linked skill untouched instead of recreating it', async () => {
    // Arrange
    readdirMock.mockImplementation(async (dir: string) => {
      if (dir === '/mock/source/skills') {
        return [{ name: 'linked-skill', isDirectory: () => true }]
      }
      return []
    })
    accessMock.mockResolvedValue(undefined)
    lstatMock.mockResolvedValue(createStats({ isSymbolicLink: true }))
    const { syncExecute } = await import('./syncService')

    // Act
    const result = await syncExecute({ replaceConflicts: [] })

    // Assert
    expect(result.created).toBe(0)
    expect(result.replaced).toBe(0)
    expect(result.skipped).toBe(2) // 1 skill × 2 agents, all already symlinked
    // Skipped items now appear per-item in details so the dialog can show them
    expect(result.details).toHaveLength(2)
    expect(result.details.every((item) => item.action === 'skipped')).toBe(true)
    expect(symlinkMock).not.toHaveBeenCalled()
    expect(rmMock).not.toHaveBeenCalled()
  })

  it('replaces a conflicting local folder with a symlink once the user approves it', async () => {
    // Arrange
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

    // Act
    const result = await syncExecute({ replaceConflicts: [conflictPath] })

    // Assert
    expect(result.replaced).toBe(1)
    expect(result.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          skillName: 'local-skill',
          agentName: 'Claude Code',
          action: 'replaced',
        }),
        expect.objectContaining({
          skillName: 'local-skill',
          agentName: 'Cursor',
          action: 'created',
        }),
      ]),
    )
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

  it('leaves a conflicting local folder in place when the user declines to replace it', async () => {
    // Arrange
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

    // Act
    const result = await syncExecute({ replaceConflicts: [] }) // Not approved

    // Assert
    expect(result.replaced).toBe(0)
    expect(result.skipped).toBe(1) // unapproved conflict skipped
    expect(rmMock).not.toHaveBeenCalled()
    // Cursor path: created
    expect(result.created).toBe(1)
    // Declined conflict is now surfaced as a skipped detail row (not folded into aggregate)
    expect(result.details).toHaveLength(2)
    expect(result.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          skillName: 'local-skill',
          agentName: 'Claude Code',
          action: 'skipped',
        }),
        expect.objectContaining({
          skillName: 'local-skill',
          agentName: 'Cursor',
          action: 'created',
        }),
      ]),
    )
  })

  it('reports a failed sync with per-agent errors when symlink creation is denied', async () => {
    // Arrange
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

    // Act
    const result = await syncExecute({ replaceConflicts: [] })

    // Assert
    expect(result.success).toBe(false)
    expect(result.errors).toHaveLength(2)
    expect(result.errors[0]).toMatchObject({
      path: join('/mock/agents/claude/skills', 'fail-skill'),
      error: 'EPERM: operation not permitted',
    })
    // Error items tracked in details with action='error'
    expect(result.details).toHaveLength(2)
    expect(result.details[0]).toMatchObject({
      skillName: 'fail-skill',
      agentName: 'Claude Code',
      action: 'error',
      error: 'EPERM: operation not permitted',
    })
  })

  it('creates each agent skills directory before linking into it', async () => {
    // Arrange
    readdirMock.mockImplementation(async (dir: string) => {
      if (dir === '/mock/source/skills') {
        return [{ name: 'any-skill', isDirectory: () => true }]
      }
      return []
    })
    accessMock.mockResolvedValue(undefined)
    lstatMock.mockRejectedValue(new Error('ENOENT'))
    const { syncExecute } = await import('./syncService')

    // Act
    await syncExecute({ replaceConflicts: [] })

    // Assert
    expect(mkdirMock).toHaveBeenCalledWith('/mock/agents/claude/skills', {
      recursive: true,
    })
    expect(mkdirMock).toHaveBeenCalledWith('/mock/agents/cursor/skills', {
      recursive: true,
    })
  })

  it('creates the agent skills directory only once when several new skills land in the same agent', async () => {
    // Arrange: two new skills, both missing on disk, scoped to a single agent.
    // The second skill must reuse the dir the first one already mkdir'd.
    readdirMock.mockImplementation(async (dir: string) => {
      if (dir === '/mock/source/skills') {
        return [
          { name: 'first-skill', isDirectory: () => true },
          { name: 'second-skill', isDirectory: () => true },
        ]
      }
      return []
    })
    accessMock.mockResolvedValue(undefined)
    lstatMock.mockRejectedValue(new Error('ENOENT'))
    const { syncExecute } = await import('./syncService')

    // Act
    const result = await syncExecute({
      replaceConflicts: [],
      agentId: 'cursor',
    })

    // Assert
    expect(result.created).toBe(2) // 2 skills × 1 agent
    // Directory ensured a single time despite two skills landing in it
    expect(mkdirMock).toHaveBeenCalledTimes(1)
    expect(mkdirMock).toHaveBeenCalledWith('/mock/agents/cursor/skills', {
      recursive: true,
    })
    // Each skill still gets its own symlink
    expect(symlinkMock).toHaveBeenCalledTimes(2)
    expect(symlinkMock).toHaveBeenCalledWith(
      join('/mock/source/skills', 'first-skill'),
      join('/mock/agents/cursor/skills', 'first-skill'),
    )
    expect(symlinkMock).toHaveBeenCalledWith(
      join('/mock/source/skills', 'second-skill'),
      join('/mock/agents/cursor/skills', 'second-skill'),
    )
  })
})

/**
 * Scoped (per-agent) sync — drives the per-agent Cleanup flow surfaced
 * from AgentItem's right-click "Cleanup missing skills..." menu item.
 * Both `syncPreview` and `syncExecute` accept an optional `agentId` that
 * narrows the operation to one agent. The whole-agent global sync flow is
 * unchanged when `agentId` is omitted (covered by the suites above).
 */
describe('scoped sync (per-agent)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    accessMock.mockResolvedValue(undefined)
    statMock.mockResolvedValue({ isFile: () => true })
    mkdirMock.mockResolvedValue(undefined)
    symlinkMock.mockResolvedValue(undefined)
    rmMock.mockResolvedValue(undefined)
  })

  it('previews only the requested agent and labels the result with that agent', async () => {
    // Arrange
    readdirMock.mockImplementation(async (dir: string) => {
      if (dir === '/mock/source/skills') {
        return [{ name: 'my-skill', isDirectory: () => true }]
      }
      return []
    })
    // 'my-skill' already symlinked under cursor; we still expect
    // totalAgents===1 because the claude row is filtered out entirely.
    lstatMock.mockResolvedValue(createStats({ isSymbolicLink: true }))
    const { syncPreview } = await import('./syncService')

    // Act
    const result = await syncPreview({ agentId: 'cursor' })

    // Assert
    expect(result.totalSkills).toBe(1)
    expect(result.totalAgents).toBe(1)
    expect(result.alreadySynced).toBe(1) // 1 skill × 1 agent (filtered)
    expect(result.forAgent).toBe('cursor')
  })

  it('leaves a whole-fleet preview unlabeled by any single agent', async () => {
    // Arrange
    readdirMock.mockResolvedValue([])
    const { syncPreview } = await import('./syncService')

    // Act
    const result = await syncPreview()

    // Assert
    expect(result.forAgent).toBeUndefined()
    expect(result.totalAgents).toBe(2)
  })

  it('links the skill only into the scoped agent and never touches the others', async () => {
    // Arrange
    readdirMock.mockImplementation(async (dir: string) => {
      if (dir === '/mock/source/skills') {
        return [{ name: 'new-skill', isDirectory: () => true }]
      }
      return []
    })
    lstatMock.mockRejectedValue(new Error('ENOENT'))
    const { syncExecute } = await import('./syncService')

    // Act
    const result = await syncExecute({
      replaceConflicts: [],
      agentId: 'cursor',
    })

    // Assert
    expect(result.created).toBe(1)
    expect(result.details).toHaveLength(1)
    expect(result.details[0]).toMatchObject({
      skillName: 'new-skill',
      agentName: 'Cursor',
      action: 'created',
    })
    // Only the cursor symlink call — claude must not be touched.
    expect(symlinkMock).toHaveBeenCalledTimes(1)
    expect(symlinkMock).toHaveBeenCalledWith(
      join('/mock/source/skills', 'new-skill'),
      join('/mock/agents/cursor/skills', 'new-skill'),
    )
    expect(symlinkMock).not.toHaveBeenCalledWith(
      expect.any(String),
      join('/mock/agents/claude/skills', 'new-skill'),
    )
    expect(mkdirMock).toHaveBeenCalledWith('/mock/agents/cursor/skills', {
      recursive: true,
    })
    expect(mkdirMock).not.toHaveBeenCalledWith(
      '/mock/agents/claude/skills',
      expect.anything(),
    )
  })

  it('makes no changes when scoped to an agent that is not installed on disk, rather than syncing all', async () => {
    // Arrange: defends against typos AND against an agent that exists in the
    // union but isn't installed/on-disk in the user's environment. The mocked
    // AGENTS list above only includes claude-code and cursor; passing 'codex'
    // (a valid AgentId, not in the mock) reproduces "agent not on disk" —
    // production filterAgentsByOption returns [] and we expect zero side
    // effects.
    readdirMock.mockImplementation(async (dir: string) => {
      if (dir === '/mock/source/skills') {
        return [{ name: 'new-skill', isDirectory: () => true }]
      }
      return []
    })
    lstatMock.mockRejectedValue(new Error('ENOENT'))
    const { syncExecute } = await import('./syncService')

    // Act
    const result = await syncExecute({
      replaceConflicts: [],
      agentId: 'codex',
    })

    // Assert
    expect(result.created).toBe(0)
    expect(result.details).toHaveLength(0)
    expect(symlinkMock).not.toHaveBeenCalled()
    expect(mkdirMock).not.toHaveBeenCalled()
  })

  it('previews zero agents yet still labels the result when scoped to an uninstalled agent', async () => {
    // Arrange: symmetric counterpart to the syncExecute no-op test above. The
    // empty-state path of CleanupAgentDialog depends on this branch: forAgent
    // must round-trip so previewMatchesTarget keeps the dialog gated, while
    // totalAgents collapses to 0 and lstat is never even queried because
    // filterAgentsByOption returned [].
    readdirMock.mockImplementation(async (dir: string) => {
      if (dir === '/mock/source/skills') {
        return [{ name: 'any-skill', isDirectory: () => true }]
      }
      return []
    })
    const { syncPreview } = await import('./syncService')

    // Act
    const result = await syncPreview({ agentId: 'codex' })

    // Assert
    expect(result.totalAgents).toBe(0)
    expect(result.toCreate).toBe(0)
    expect(result.alreadySynced).toBe(0)
    expect(result.forAgent).toBe('codex')
    expect(lstatMock).not.toHaveBeenCalled()
  })
})
