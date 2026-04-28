import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import type * as NodeOs from 'node:os'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const handleMock = vi.fn()
const trashItemMock = vi.fn()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (...args: unknown[]) => handleMock(...args),
  },
  shell: {
    trashItem: (...args: unknown[]) => trashItemMock(...args),
  },
}))

/**
 * Look up a registered IPC handler by channel name.
 * @param channel - IPC invoke channel to find.
 * @returns Registered handler function.
 * @example
 * const handler = getRegisteredHandler('skills:removeAllFromAgent')
 */
function getRegisteredHandler(channel: string): (
  event: unknown,
  arg: { agentId: string; agentPath: string },
) => Promise<{
  success: boolean
  removedCount: number
  error?: string
}> {
  const registration = handleMock.mock.calls.find(([name]) => name === channel)
  if (!registration) {
    throw new Error(`No handler registered for ${channel}`)
  }
  return registration[1] as (
    event: unknown,
    arg: { agentId: string; agentPath: string },
  ) => Promise<{
    success: boolean
    removedCount: number
    error?: string
  }>
}

describe('skills:removeAllFromAgent handler', () => {
  let tempHome = ''

  beforeEach(async () => {
    vi.resetModules()
    handleMock.mockReset()
    trashItemMock.mockReset()
    trashItemMock.mockResolvedValue(undefined)
    tempHome = await mkdtemp(join(tmpdir(), 'skills-desktop-remove-'))
    vi.doMock('os', async () => {
      const actual = await vi.importActual<typeof NodeOs>('os')
      return {
        ...actual,
        homedir: () => tempHome,
      }
    })
    vi.doMock('node:os', async () => {
      const actual = await vi.importActual<typeof NodeOs>('node:os')
      return {
        ...actual,
        homedir: () => tempHome,
      }
    })
  })

  afterEach(async () => {
    vi.doUnmock('os')
    vi.doUnmock('node:os')
    await rm(tempHome, { recursive: true, force: true })
  })

  // v0.13.0 regression lock: clicking "remove all from Cline" used to pass
  // SOURCE_DIR (=~/.agents/skills) through unchecked, cascading into every
  // universal agent. The guard must reject this before any trashItem call.
  //
  // Two layers can refuse: `validatePath` (since the homeDir fix, SOURCE_DIR
  // is no longer any agent's base path → caught here as path-traversal) or
  // `isSharedAgentPath` (the original shared-folder guard, still relevant
  // for paths like `~/.config/agents/skills` that DO match an agent base).
  // Either rejection satisfies the contract — what matters is `success:
  // false` and trashItem never firing.
  it('rejects SOURCE_DIR — the v0.13.0 regression path', async () => {
    const sourceDir = join(tempHome, '.agents', 'skills')
    await mkdir(sourceDir, { recursive: true })

    const { registerSkillsHandlers } = await import('./skills')
    registerSkillsHandlers()

    const handler = getRegisteredHandler('skills:removeAllFromAgent')
    const result = await handler({}, { agentId: 'cline', agentPath: sourceDir })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/shared skills folder|path traversal/i)
    expect(trashItemMock).not.toHaveBeenCalled()
  })

  it('rejects a trailing-slash bypass of SOURCE_DIR', async () => {
    // A raw string `~/.agents/skills/` would miss SHARED_AGENT_PATHS.has()
    // without the resolve() normalization in isSharedAgentPath. Post-fix
    // it's normally caught one layer earlier by validatePath, but the
    // outcome is the same: rejected, no trashItem.
    const sourceDir = join(tempHome, '.agents', 'skills')
    await mkdir(sourceDir, { recursive: true })

    const { registerSkillsHandlers } = await import('./skills')
    registerSkillsHandlers()

    const handler = getRegisteredHandler('skills:removeAllFromAgent')
    const result = await handler(
      {},
      { agentId: 'cline', agentPath: sourceDir + '/' },
    )

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/shared skills folder|path traversal/i)
    expect(trashItemMock).not.toHaveBeenCalled()
  })

  // Idempotency contract: shell.trashItem throws ENOENT (unlike the old
  // fs.rm({force:true}) this handler used to call). Pre-checking with
  // fs.access lets double-clicks and out-of-band deletes resolve cleanly.
  it('returns success with 0 count when agent dir does not exist', async () => {
    // Never mkdir — the .cursor/skills dir is absent.
    const cursorDir = join(tempHome, '.cursor', 'skills')

    const { registerSkillsHandlers } = await import('./skills')
    registerSkillsHandlers()

    const handler = getRegisteredHandler('skills:removeAllFromAgent')
    const result = await handler(
      {},
      { agentId: 'cursor', agentPath: cursorDir },
    )

    expect(result).toEqual({ success: true, removedCount: 0 })
    expect(trashItemMock).not.toHaveBeenCalled()
  })

  it('trashes a real agent dir and returns count of entries', async () => {
    const cursorDir = join(tempHome, '.cursor', 'skills')
    await mkdir(join(cursorDir, 'skill-a'), { recursive: true })
    await mkdir(join(cursorDir, 'skill-b'), { recursive: true })

    const { registerSkillsHandlers } = await import('./skills')
    registerSkillsHandlers()

    const handler = getRegisteredHandler('skills:removeAllFromAgent')
    const result = await handler(
      {},
      { agentId: 'cursor', agentPath: cursorDir },
    )

    expect(result).toEqual({ success: true, removedCount: 2 })
    expect(trashItemMock).toHaveBeenCalledTimes(1)
  })

  // Exercises the `realpathSync.native` fallback inside isSharedAgentPath.
  // The resolve() stage sees ~/.cursor/skills (not in SHARED_AGENT_PATHS);
  // the realpath stage follows the symlink to ~/.agents/skills and catches
  // it. Without the fallback, a user who manually symlinked their agent
  // dir to the universal source could still trip the v0.13.0 cascade.
  it('rejects a symlink alias whose realpath lands on SOURCE_DIR', async () => {
    const sourceDir = join(tempHome, '.agents', 'skills')
    const aliasDir = join(tempHome, '.cursor', 'skills')
    await mkdir(sourceDir, { recursive: true })
    await mkdir(join(tempHome, '.cursor'), { recursive: true })
    await symlink(sourceDir, aliasDir, 'dir')

    const { registerSkillsHandlers } = await import('./skills')
    registerSkillsHandlers()

    const handler = getRegisteredHandler('skills:removeAllFromAgent')
    const result = await handler({}, { agentId: 'cursor', agentPath: aliasDir })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/shared skills folder/)
    expect(trashItemMock).not.toHaveBeenCalled()
  })
})
