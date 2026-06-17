import { lstat, mkdir, mkdtemp, readdir, rm, symlink } from 'node:fs/promises'
import type * as NodeOs from 'node:os'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { filesystemIdentityFromStats } from '@/main/services/filesystemIdentity'
import type { FilesystemEntryIdentity } from '@/shared/types'

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
  arg: {
    agentId: string
    agentPath: string
    filesystemIdentity?: FilesystemEntryIdentity
    protectedSkillPaths?: string[]
  },
) => Promise<{
  success: boolean
  removedCount: number
  preservedCount?: number
  error?: string
}> {
  const registration = handleMock.mock.calls.find(([name]) => name === channel)
  if (!registration) {
    throw new Error(`No handler registered for ${channel}`)
  }
  return registration[1] as (
    event: unknown,
    arg: {
      agentId: string
      agentPath: string
      filesystemIdentity?: FilesystemEntryIdentity
      protectedSkillPaths?: string[]
    },
  ) => Promise<{
    success: boolean
    removedCount: number
    preservedCount?: number
    error?: string
  }>
}

/**
 * Capture the reviewed directory identity expected by removeAllFromAgent.
 * @param path - Agent skills directory reviewed by the user.
 * @returns Serializable filesystem identity for the IPC payload.
 * @example reviewedIdentity('/tmp/home/.cursor/skills')
 */
async function reviewedIdentity(
  path: string,
): Promise<FilesystemEntryIdentity> {
  return filesystemIdentityFromStats(await lstat(path))
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
  it('refuses to trash the shared SOURCE_DIR so it cannot cascade into every universal agent (v0.13.0 regression)', async () => {
    // Arrange
    const sourceDir = join(tempHome, '.agents', 'skills')
    await mkdir(sourceDir, { recursive: true })

    const { registerSkillsHandlers } = await import('./skills')
    registerSkillsHandlers()

    // Act
    const handler = getRegisteredHandler('skills:removeAllFromAgent')
    const result = await handler(
      {},
      {
        agentId: 'cline',
        agentPath: sourceDir,
        filesystemIdentity: await reviewedIdentity(sourceDir),
      },
    )

    // Assert
    expect(result.success).toBe(false)
    expect(result.error).toMatch(
      /shared skills folder|path traversal|does not match the selected agent slot/i,
    )
    expect(trashItemMock).not.toHaveBeenCalled()
  })

  it('refuses to trash SOURCE_DIR even when a trailing slash is appended to dodge the guard', async () => {
    // Arrange
    // A raw string `~/.agents/skills/` would miss SHARED_AGENT_PATHS.has()
    // without the resolve() normalization in isSharedAgentPath. Post-fix
    // it's normally caught one layer earlier by validatePath, but the
    // outcome is the same: rejected, no trashItem.
    const sourceDir = join(tempHome, '.agents', 'skills')
    await mkdir(sourceDir, { recursive: true })

    const { registerSkillsHandlers } = await import('./skills')
    registerSkillsHandlers()

    // Act
    const handler = getRegisteredHandler('skills:removeAllFromAgent')
    const sourceIdentity = await reviewedIdentity(sourceDir)
    const result = await handler(
      {},
      {
        agentId: 'cline',
        agentPath: sourceDir + '/',
        filesystemIdentity: sourceIdentity,
      },
    )

    // Assert
    expect(result.success).toBe(false)
    expect(result.error).toMatch(
      /shared skills folder|path traversal|does not match the selected agent slot/i,
    )
    expect(trashItemMock).not.toHaveBeenCalled()
  })

  // Idempotency contract: shell.trashItem throws ENOENT (unlike the old
  // fs.rm({force:true}) this handler used to call). Pre-checking with
  // fs.access lets double-clicks and out-of-band deletes resolve cleanly.
  it('treats removing an already-gone agent dir as a no-op success (idempotent double-click)', async () => {
    // Arrange
    const cursorDir = join(tempHome, '.cursor', 'skills')
    await mkdir(cursorDir, { recursive: true })
    const staleIdentity = await reviewedIdentity(cursorDir)
    await rm(cursorDir, { recursive: true, force: true })

    const { registerSkillsHandlers } = await import('./skills')
    registerSkillsHandlers()

    // Act
    const handler = getRegisteredHandler('skills:removeAllFromAgent')
    const result = await handler(
      {},
      {
        agentId: 'cursor',
        agentPath: cursorDir,
        filesystemIdentity: staleIdentity,
      },
    )

    // Assert
    expect(result).toEqual({ success: true, removedCount: 0 })
    expect(trashItemMock).not.toHaveBeenCalled()
  })

  it('rejects a renderer path for a different agent than the selected agentId', async () => {
    // Arrange
    const cursorDir = join(tempHome, '.cursor', 'skills')
    const claudeDir = join(tempHome, '.claude', 'skills')
    await mkdir(cursorDir, { recursive: true })
    await mkdir(claudeDir, { recursive: true })

    const { registerSkillsHandlers } = await import('./skills')
    registerSkillsHandlers()

    // Act
    const handler = getRegisteredHandler('skills:removeAllFromAgent')
    const result = await handler(
      {},
      {
        agentId: 'cursor',
        agentPath: claudeDir,
        filesystemIdentity: await reviewedIdentity(claudeDir),
      },
    )

    // Assert
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/does not match the selected agent slot/i)
    expect(trashItemMock).not.toHaveBeenCalled()
  })

  it('moves a real agent dir to the Trash and reports how many skills it held', async () => {
    // Arrange
    const cursorDir = join(tempHome, '.cursor', 'skills')
    await mkdir(join(cursorDir, 'skill-a'), { recursive: true })
    await mkdir(join(cursorDir, 'skill-b'), { recursive: true })

    const { registerSkillsHandlers } = await import('./skills')
    registerSkillsHandlers()

    // Act
    const handler = getRegisteredHandler('skills:removeAllFromAgent')
    const result = await handler(
      {},
      {
        agentId: 'cursor',
        agentPath: cursorDir,
        filesystemIdentity: await reviewedIdentity(cursorDir),
      },
    )

    // Assert
    expect(result).toEqual({ success: true, removedCount: 2 })
    expect(trashItemMock).toHaveBeenCalledTimes(1)
    expect(String(trashItemMock.mock.calls[0][0])).toContain(
      join(tempHome, '.cursor', 'skills.trash-'),
    )
  })

  it('keeps only protected skill entries when deleting an agent folder with protected skills', async () => {
    // Arrange
    trashItemMock.mockImplementation(async (path: string) => {
      await rm(path, { recursive: true, force: true })
    })
    const cursorDir = join(tempHome, '.cursor', 'skills')
    const sourceDir = join(tempHome, '.agents', 'skills')
    const protectedSource = join(sourceDir, 'protected-source')
    const unprotectedSource = join(sourceDir, 'unprotected-source')
    const protectedLink = join(cursorDir, 'protected-link')
    const protectedLocal = join(cursorDir, 'protected-local')
    await mkdir(protectedSource, { recursive: true })
    await mkdir(unprotectedSource, { recursive: true })
    await mkdir(protectedLocal, { recursive: true })
    await mkdir(join(cursorDir, 'unprotected-local'), { recursive: true })
    await symlink(protectedSource, protectedLink)
    await symlink(unprotectedSource, join(cursorDir, 'unprotected-link'))

    const { registerSkillsHandlers } = await import('./skills')
    registerSkillsHandlers()

    // Act
    const handler = getRegisteredHandler('skills:removeAllFromAgent')
    const result = await handler(
      {},
      {
        agentId: 'cursor',
        agentPath: cursorDir,
        filesystemIdentity: await reviewedIdentity(cursorDir),
        protectedSkillPaths: [protectedLink, protectedLocal],
      },
    )

    // Assert
    expect(result).toEqual({
      success: true,
      removedCount: 2,
      preservedCount: 2,
    })
    await expect(
      readdir(cursorDir).then((entries) => entries.sort()),
    ).resolves.toEqual(['protected-link', 'protected-local'])
    await expect(lstat(protectedLink)).resolves.toBeDefined()
    await expect(lstat(protectedLocal)).resolves.toBeDefined()
    await expect(lstat(join(cursorDir, 'unprotected-link'))).rejects.toThrow(
      /ENOENT/,
    )
    await expect(lstat(join(cursorDir, 'unprotected-local'))).rejects.toThrow(
      /ENOENT/,
    )
    expect(trashItemMock).toHaveBeenCalledTimes(2)
  })

  it('stops protected-folder deletion before a swapped parent symlink can redirect the next child delete', async () => {
    // Arrange
    const cursorDir = join(tempHome, '.cursor', 'skills')
    const evilDir = join(tempHome, 'evil-target')
    const protectedLocal = join(cursorDir, 'z-protected-local')
    trashItemMock.mockImplementationOnce(async (path: string) => {
      await rm(path, { recursive: true, force: true })
      await rm(cursorDir, { recursive: true, force: true })
      await symlink(evilDir, cursorDir, 'dir')
    })
    await mkdir(join(cursorDir, 'a-unprotected-local'), { recursive: true })
    await mkdir(join(cursorDir, 'b-unprotected-local'), { recursive: true })
    await mkdir(protectedLocal, { recursive: true })
    await mkdir(join(evilDir, 'b-unprotected-local'), { recursive: true })
    const cursorIdentity = await reviewedIdentity(cursorDir)

    const { registerSkillsHandlers } = await import('./skills')
    registerSkillsHandlers()

    // Act
    const handler = getRegisteredHandler('skills:removeAllFromAgent')
    const result = await handler(
      {},
      {
        agentId: 'cursor',
        agentPath: cursorDir,
        filesystemIdentity: cursorIdentity,
        protectedSkillPaths: [protectedLocal],
      },
    )

    // Assert
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/changed since review/i)
    await expect(
      lstat(join(evilDir, 'b-unprotected-local')),
    ).resolves.toBeDefined()
    expect(trashItemMock).toHaveBeenCalledTimes(1)
  })

  it('rejects a same-path replacement before moving the agent dir to OS Trash', async () => {
    // Arrange
    const cursorDir = join(tempHome, '.cursor', 'skills')
    await mkdir(join(cursorDir, 'reviewed-skill'), { recursive: true })
    await rm(cursorDir, { recursive: true, force: true })
    await mkdir(join(cursorDir, 'replacement-skill'), { recursive: true })
    // Synthesize the reviewed identity from the replacement dir but with a
    // distinct ctime. This deterministically simulates an in-place same-path
    // replacement (dev+ino reused as ext4 does, fresh ctime) without depending
    // on the host filesystem's ctime granularity, which can otherwise let the
    // recreated dir reuse the captured ctime and make the test flaky.
    const replacementIdentity = await reviewedIdentity(cursorDir)
    const staleIdentity: FilesystemEntryIdentity = {
      ...replacementIdentity,
      ctimeMs: replacementIdentity.ctimeMs - 60_000,
    }

    const { registerSkillsHandlers } = await import('./skills')
    registerSkillsHandlers()

    // Act
    const handler = getRegisteredHandler('skills:removeAllFromAgent')
    const result = await handler(
      {},
      {
        agentId: 'cursor',
        agentPath: cursorDir,
        filesystemIdentity: staleIdentity,
      },
    )

    // Assert
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/changed since review/i)
    await expect(
      lstat(join(cursorDir, 'replacement-skill')),
    ).resolves.toBeDefined()
    expect(trashItemMock).not.toHaveBeenCalled()
  })

  // Exercises the `realpathSync.native` fallback inside isSharedAgentPath.
  // The resolve() stage sees ~/.cursor/skills (not in SHARED_AGENT_PATHS);
  // the realpath stage follows the symlink to ~/.agents/skills and catches
  // it. Without the fallback, a user who manually symlinked their agent
  // dir to the universal source could still trip the v0.13.0 cascade.
  it('refuses to trash an agent dir that is a symlink resolving to the shared SOURCE_DIR', async () => {
    // Arrange
    const sourceDir = join(tempHome, '.agents', 'skills')
    const aliasDir = join(tempHome, '.cursor', 'skills')
    await mkdir(sourceDir, { recursive: true })
    await mkdir(join(tempHome, '.cursor'), { recursive: true })
    await symlink(sourceDir, aliasDir, 'dir')

    const { registerSkillsHandlers } = await import('./skills')
    registerSkillsHandlers()

    // Act
    const handler = getRegisteredHandler('skills:removeAllFromAgent')
    const result = await handler(
      {},
      {
        agentId: 'cursor',
        agentPath: aliasDir,
        filesystemIdentity: await reviewedIdentity(aliasDir),
      },
    )

    // Assert
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/shared skills folder/)
    expect(trashItemMock).not.toHaveBeenCalled()
  })
})
