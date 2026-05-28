import {
  lstat,
  mkdir,
  mkdtemp,
  readlink,
  realpath,
  rm,
  symlink,
} from 'node:fs/promises'
import type * as NodeFsPromises from 'node:fs/promises'
import type * as NodeOs from 'node:os'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

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
 * Returns a registered skills cleanup IPC handler from the Electron mock.
 * @param channel - IPC invoke channel to find.
 * @returns Registered handler callable with test event and options.
 * @example
 * const handler = getRegisteredHandler('skills:clearOrphanSymlinks')
 */
function getRegisteredHandler(channel: string): (
  event: unknown,
  arg: {
    items: Array<{
      skillName?: string
      linkName?: string
      agents?: Array<{ agentId: string; linkPath: string; targetPath: string }>
      agentId?: string
      linkPath?: string
      targetPath?: string
    }>
  },
) => Promise<unknown> {
  const registration = handleMock.mock.calls.find(([name]) => name === channel)
  if (!registration) {
    throw new Error(`No handler registered for ${channel}`)
  }
  return registration[1] as (
    event: unknown,
    arg: {
      items: Array<{
        skillName?: string
        linkName?: string
        agents?: Array<{
          agentId: string
          linkPath: string
          targetPath: string
        }>
        agentId?: string
        linkPath?: string
        targetPath?: string
      }>
    },
  ) => Promise<unknown>
}

describe('skills:clearOrphanSymlinks handler', () => {
  let tempHome = ''

  beforeEach(async () => {
    vi.resetModules()
    handleMock.mockReset()
    trashItemMock.mockReset()
    tempHome = await mkdtemp(join(tmpdir(), 'skills-desktop-orphan-ipc-'))
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
    vi.doUnmock('node:fs/promises')
    await rm(tempHome, { recursive: true, force: true })
  })

  it('unlinks a reviewed orphan symlink without creating a source-delete tombstone', async () => {
    // Arrange
    const skillName = 'abandoned'
    const codexSkillsDir = join(tempHome, '.codex', 'skills')
    const targetPath = join(tempHome, '.agents', 'skills', skillName)
    const linkPath = join(codexSkillsDir, skillName)
    await mkdir(codexSkillsDir, { recursive: true })
    await symlink(targetPath, linkPath)
    const { registerSkillsHandlers } = await import('./skills')
    registerSkillsHandlers()
    const handler = getRegisteredHandler('skills:clearOrphanSymlinks')

    // Act
    const result = await handler(
      {},
      {
        items: [
          {
            skillName,
            agents: [{ agentId: 'codex', linkPath, targetPath }],
          },
        ],
      },
    )

    // Assert
    expect(result).toEqual({
      items: [
        {
          skillName,
          outcome: 'orphan-cleared',
          symlinksRemoved: 1,
          cascadeAgents: ['codex'],
        },
      ],
    })
    await expect(lstat(linkPath)).rejects.toThrow(/ENOENT/)
    expect(trashItemMock).not.toHaveBeenCalled()
  })

  it('refuses orphan cleanup when a source skill was restored before mutation', async () => {
    // Arrange
    const skillName = 'restored-source'
    const sourceDir = join(tempHome, '.agents', 'skills', skillName)
    const codexSkillsDir = join(tempHome, '.codex', 'skills')
    const targetPath = sourceDir
    const linkPath = join(codexSkillsDir, skillName)
    await mkdir(sourceDir, { recursive: true })
    await mkdir(codexSkillsDir, { recursive: true })
    await symlink(sourceDir, linkPath)
    const { registerSkillsHandlers } = await import('./skills')
    registerSkillsHandlers()
    const handler = getRegisteredHandler('skills:clearOrphanSymlinks')

    // Act
    const result = await handler(
      {},
      {
        items: [
          {
            skillName,
            agents: [{ agentId: 'codex', linkPath, targetPath }],
          },
        ],
      },
    )

    // Assert
    expect(result).toEqual({
      items: [
        {
          skillName,
          outcome: 'error',
          error: {
            message: 'Source skill exists. Rescan before cleanup.',
            code: 'ESTALE',
          },
        },
      ],
    })
    expect((await lstat(linkPath)).isSymbolicLink()).toBe(true)
  })

  it('resolves broken targets through a symlinked Devin config parent before unlinking', async () => {
    // Arrange
    const skillName = 'devin-orphan'
    const physicalConfigDir = join(tempHome, 'dotfiles', '.config')
    const logicalConfigDir = join(tempHome, '.config')
    const devinSkillsDir = join(logicalConfigDir, 'devin', 'skills')
    const physicalDevinSkillsDir = join(physicalConfigDir, 'devin', 'skills')
    const linkPath = join(devinSkillsDir, skillName)
    await mkdir(physicalDevinSkillsDir, { recursive: true })
    await symlink(physicalConfigDir, logicalConfigDir)
    const relativeMissingTarget = relative(
      physicalDevinSkillsDir,
      join(tempHome, '.agents', 'skills', skillName),
    )
    const targetPath = join(
      await realpath(physicalDevinSkillsDir),
      relativeMissingTarget,
    )
    await symlink(relativeMissingTarget, linkPath)
    const { registerSkillsHandlers } = await import('./skills')
    registerSkillsHandlers()
    const handler = getRegisteredHandler('skills:clearOrphanSymlinks')

    // Act
    const result = await handler(
      {},
      {
        items: [
          {
            skillName,
            agents: [{ agentId: 'devin', linkPath, targetPath }],
          },
        ],
      },
    )

    // Assert
    expect(result).toEqual({
      items: [
        {
          skillName,
          outcome: 'orphan-cleared',
          symlinksRemoved: 1,
          cascadeAgents: ['devin'],
        },
      ],
    })
    await expect(lstat(linkPath)).rejects.toThrow(/ENOENT/)
    expect((await lstat(logicalConfigDir)).isSymbolicLink()).toBe(true)
  })

  it('refuses orphan cleanup when the reviewed target changed before unlink', async () => {
    // Arrange
    const skillName = 'orphan-target-swapped'
    const codexSkillsDir = join(tempHome, '.codex', 'skills')
    const reviewedTargetPath = join(tempHome, '.agents', 'skills', skillName)
    const currentTargetPath = join(
      tempHome,
      '.agents',
      'skills',
      'other-orphan-target',
    )
    const linkPath = join(codexSkillsDir, skillName)
    await mkdir(codexSkillsDir, { recursive: true })
    await symlink(currentTargetPath, linkPath)
    const { registerSkillsHandlers } = await import('./skills')
    registerSkillsHandlers()
    const handler = getRegisteredHandler('skills:clearOrphanSymlinks')

    // Act
    const result = await handler(
      {},
      {
        items: [
          {
            skillName,
            agents: [
              {
                agentId: 'codex',
                linkPath,
                targetPath: reviewedTargetPath,
              },
            ],
          },
        ],
      },
    )

    // Assert
    expect(result).toEqual({
      items: [
        {
          skillName,
          outcome: 'error',
          error: {
            message:
              'Reviewed orphan link target changed. Rescan before cleanup.',
            code: 'ESTALE',
          },
        },
      ],
    })
    expect((await lstat(linkPath)).isSymbolicLink()).toBe(true)
  })
})

describe('skills:clearBrokenSymlinkSlots handler', () => {
  let tempHome = ''

  beforeEach(async () => {
    vi.resetModules()
    handleMock.mockReset()
    trashItemMock.mockReset()
    tempHome = await mkdtemp(join(tmpdir(), 'skills-desktop-broken-ipc-'))
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

  it('unlinks a reviewed broken slot only when the exact target is still missing', async () => {
    // Arrange
    const skillName = 'stale-source-slot'
    const codexSkillsDir = join(tempHome, '.codex', 'skills')
    const targetPath = join(tempHome, '.agents', 'skills', skillName)
    const linkPath = join(codexSkillsDir, skillName)
    await mkdir(codexSkillsDir, { recursive: true })
    await symlink(targetPath, linkPath)
    const { registerSkillsHandlers } = await import('./skills')
    registerSkillsHandlers()
    const handler = getRegisteredHandler('skills:clearBrokenSymlinkSlots')

    // Act
    const result = await handler(
      {},
      {
        items: [
          {
            agentId: 'codex',
            linkName: skillName,
            linkPath,
            targetPath,
          },
        ],
      },
    )

    // Assert
    expect(result).toEqual({
      items: [{ agentId: 'codex', skillName, linkPath, outcome: 'unlinked' }],
    })
    await expect(lstat(linkPath)).rejects.toThrow(/ENOENT/)
  })

  it('refuses to unlink a reviewed broken slot when its target was restored', async () => {
    // Arrange
    const skillName = 'restored-target-slot'
    const codexSkillsDir = join(tempHome, '.codex', 'skills')
    const targetPath = join(tempHome, '.agents', 'skills', skillName)
    const linkPath = join(codexSkillsDir, skillName)
    await mkdir(codexSkillsDir, { recursive: true })
    await mkdir(targetPath, { recursive: true })
    await symlink(targetPath, linkPath)
    const { registerSkillsHandlers } = await import('./skills')
    registerSkillsHandlers()
    const handler = getRegisteredHandler('skills:clearBrokenSymlinkSlots')

    // Act
    const result = await handler(
      {},
      {
        items: [
          {
            agentId: 'codex',
            linkName: skillName,
            linkPath,
            targetPath,
          },
        ],
      },
    )

    // Assert
    expect(result).toEqual({
      items: [
        {
          skillName,
          agentId: 'codex',
          linkPath,
          outcome: 'error',
          error: {
            message:
              'Reviewed broken link target now exists. Rescan before cleanup.',
            code: 'ESTALE',
          },
        },
      ],
    })
    expect((await lstat(linkPath)).isSymbolicLink()).toBe(true)
  })

  it('refuses to unlink when the reviewed link path no longer matches the agent slot', async () => {
    // Arrange
    const skillName = 'path-swapped-slot'
    const codexSkillsDir = join(tempHome, '.codex', 'skills')
    const targetPath = join(tempHome, '.agents', 'skills', skillName)
    const linkPath = join(codexSkillsDir, skillName)
    const reviewedLinkPath = join(codexSkillsDir, 'other-slot')
    await mkdir(codexSkillsDir, { recursive: true })
    await symlink(targetPath, linkPath)
    const { registerSkillsHandlers } = await import('./skills')
    registerSkillsHandlers()
    const handler = getRegisteredHandler('skills:clearBrokenSymlinkSlots')

    // Act
    const result = await handler(
      {},
      {
        items: [
          {
            agentId: 'codex',
            linkName: skillName,
            linkPath: reviewedLinkPath,
            targetPath,
          },
        ],
      },
    )

    // Assert
    expect(result).toEqual({
      items: [
        {
          agentId: 'codex',
          skillName,
          linkPath: reviewedLinkPath,
          outcome: 'error',
          error: {
            message: 'Reviewed broken link path no longer matches agent slot',
            code: 'ESTALE',
          },
        },
      ],
    })
    expect((await lstat(linkPath)).isSymbolicLink()).toBe(true)
  })

  it('refuses to unlink when the reviewed broken slot target changed', async () => {
    // Arrange
    const skillName = 'target-swapped-slot'
    const codexSkillsDir = join(tempHome, '.codex', 'skills')
    const reviewedTargetPath = join(tempHome, '.agents', 'skills', skillName)
    const currentTargetPath = join(
      tempHome,
      '.agents',
      'skills',
      'other-target',
    )
    const linkPath = join(codexSkillsDir, skillName)
    await mkdir(codexSkillsDir, { recursive: true })
    await symlink(currentTargetPath, linkPath)
    const { registerSkillsHandlers } = await import('./skills')
    registerSkillsHandlers()
    const handler = getRegisteredHandler('skills:clearBrokenSymlinkSlots')

    // Act
    const result = await handler(
      {},
      {
        items: [
          {
            agentId: 'codex',
            linkName: skillName,
            linkPath,
            targetPath: reviewedTargetPath,
          },
        ],
      },
    )

    // Assert
    expect(result).toEqual({
      items: [
        {
          agentId: 'codex',
          skillName,
          linkPath,
          outcome: 'error',
          error: {
            message:
              'Reviewed broken link target changed. Rescan before cleanup.',
            code: 'ESTALE',
          },
        },
      ],
    })
    expect((await lstat(linkPath)).isSymbolicLink()).toBe(true)
  })

  it('keeps a local replacement when a reviewed link becomes a folder before unlink', async () => {
    // Arrange
    const skillName = 'replacement-race-slot'
    const codexSkillsDir = join(tempHome, '.codex', 'skills')
    const targetPath = join(tempHome, '.agents', 'skills', skillName)
    const linkPath = join(codexSkillsDir, skillName)
    await mkdir(codexSkillsDir, { recursive: true })
    await symlink(targetPath, linkPath)
    vi.doMock('node:fs/promises', async () => {
      const actual =
        await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
      return {
        ...actual,
        unlink: async (path: string): Promise<void> => {
          if (String(path) === linkPath) {
            await actual.rm(linkPath, { recursive: true, force: true })
            await actual.mkdir(linkPath, { recursive: true })
          }
          return actual.unlink(path)
        },
      }
    })
    const { registerSkillsHandlers } = await import('./skills')
    registerSkillsHandlers()
    const handler = getRegisteredHandler('skills:clearBrokenSymlinkSlots')

    // Act
    const result = await handler(
      {},
      {
        items: [
          {
            agentId: 'codex',
            linkName: skillName,
            linkPath,
            targetPath,
          },
        ],
      },
    )

    // Assert
    expect(result).toEqual({
      items: [
        {
          agentId: 'codex',
          skillName,
          linkPath,
          outcome: 'error',
          error: {
            message: 'Reviewed cleanup slot is no longer a symlink',
            code: 'ESTALE',
          },
        },
      ],
    })
    expect((await lstat(linkPath)).isDirectory()).toBe(true)
  })

  it('refuses when a reviewed link becomes a different symlink before final unlink', async () => {
    // Arrange
    const skillName = 'replacement-symlink-race'
    const codexSkillsDir = join(tempHome, '.codex', 'skills')
    const targetPath = join(tempHome, '.agents', 'skills', skillName)
    const replacementTargetPath = join(
      tempHome,
      '.agents',
      'skills',
      'other-target',
    )
    const linkPath = join(codexSkillsDir, skillName)
    await mkdir(codexSkillsDir, { recursive: true })
    await symlink(targetPath, linkPath)
    let targetProbeCount = 0
    vi.doMock('node:fs/promises', async () => {
      const actual =
        await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
      return {
        ...actual,
        access: async (path: string): Promise<void> => {
          if (String(path) === targetPath) {
            targetProbeCount += 1
            if (targetProbeCount === 1) {
              await actual.rm(linkPath, { force: true })
              await actual.symlink(replacementTargetPath, linkPath)
            }
            throw Object.assign(new Error('missing target'), { code: 'ENOENT' })
          }
          return actual.access(path)
        },
      }
    })
    const { registerSkillsHandlers } = await import('./skills')
    registerSkillsHandlers()
    const handler = getRegisteredHandler('skills:clearBrokenSymlinkSlots')

    // Act
    const result = await handler(
      {},
      {
        items: [
          {
            agentId: 'codex',
            linkName: skillName,
            linkPath,
            targetPath,
          },
        ],
      },
    )

    // Assert
    expect(result).toEqual({
      items: [
        {
          agentId: 'codex',
          skillName,
          linkPath,
          outcome: 'error',
          error: {
            message:
              'Reviewed broken link target changed. Rescan before cleanup.',
            code: 'ESTALE',
          },
        },
      ],
    })
    expect(await readlink(linkPath)).toBe(replacementTargetPath)
  })

  it('refuses when the reviewed target is restored before final unlink', async () => {
    // Arrange
    const skillName = 'restored-target-race'
    const codexSkillsDir = join(tempHome, '.codex', 'skills')
    const targetPath = join(tempHome, '.agents', 'skills', skillName)
    const linkPath = join(codexSkillsDir, skillName)
    await mkdir(codexSkillsDir, { recursive: true })
    await symlink(targetPath, linkPath)
    let targetProbeCount = 0
    vi.doMock('node:fs/promises', async () => {
      const actual =
        await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
      return {
        ...actual,
        access: async (path: string): Promise<void> => {
          if (String(path) === targetPath && targetProbeCount === 0) {
            targetProbeCount += 1
            await actual.mkdir(targetPath, { recursive: true })
            throw Object.assign(new Error('missing target'), { code: 'ENOENT' })
          }
          return actual.access(path)
        },
      }
    })
    const { registerSkillsHandlers } = await import('./skills')
    registerSkillsHandlers()
    const handler = getRegisteredHandler('skills:clearBrokenSymlinkSlots')

    // Act
    const result = await handler(
      {},
      {
        items: [
          {
            agentId: 'codex',
            linkName: skillName,
            linkPath,
            targetPath,
          },
        ],
      },
    )

    // Assert
    expect(result).toEqual({
      items: [
        {
          agentId: 'codex',
          skillName,
          linkPath,
          outcome: 'error',
          error: {
            message:
              'Reviewed broken link target now exists. Rescan before cleanup.',
            code: 'ESTALE',
          },
        },
      ],
    })
    expect((await lstat(linkPath)).isSymbolicLink()).toBe(true)
    expect((await lstat(targetPath)).isDirectory()).toBe(true)
  })
})
