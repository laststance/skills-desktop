import {
  mkdir,
  mkdtemp,
  lstat,
  readdir,
  readlink,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import type * as NodeFsPromises from 'node:fs/promises'
import type * as NodeOs from 'node:os'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { filesystemIdentityFromStats } from './filesystemIdentity'

/**
 * Capture the reviewed identity for the exact directory about to be deleted.
 * @param path - Source or agent-local skill folder path.
 * @returns Serializable identity payload passed through destructive IPC.
 * @example await reviewedIdentityForPath('/tmp/home/.agents/skills/task')
 */
async function reviewedIdentityForPath(
  path: string,
): Promise<ReturnType<typeof filesystemIdentityFromStats>> {
  return filesystemIdentityFromStats(await lstat(path))
}

describe('trashService orphan cleanup guarded commit', () => {
  let tempHome = ''

  beforeEach(async () => {
    vi.resetModules()
    tempHome = await mkdtemp(join(tmpdir(), 'skills-trash-orphan-race-'))
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

  it('aborts source-backed delete when quarantined symlink restore fails', async () => {
    // Arrange
    const skillName = 'source-restore-failure'
    const sourcePath = join(tempHome, '.agents', 'skills', skillName)
    const cursorSkillsDir = join(tempHome, '.cursor', 'skills')
    const linkPath = join(cursorSkillsDir, skillName)
    const replacementTargetPath = join(
      tempHome,
      '.agents',
      'skills',
      'replacement-target',
    )
    await mkdir(sourcePath, { recursive: true })
    await writeFile(join(sourcePath, 'SKILL.md'), `# ${skillName}\n`, 'utf-8')
    await mkdir(cursorSkillsDir, { recursive: true })
    await symlink(sourcePath, linkPath)
    vi.doMock('node:fs/promises', async () => {
      const actual =
        await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
      return {
        ...actual,
        unlink: async (path: string): Promise<void> => {
          if (String(path).startsWith(`${linkPath}.cleanup-`)) {
            await actual.symlink(replacementTargetPath, linkPath)
            const error = new Error(
              'forced cleanup unlink failure',
            ) as NodeJS.ErrnoException
            error.code = 'EACCES'
            throw error
          }
          return actual.unlink(path)
        },
      }
    })
    const { __getTrashDirForTests, moveToTrash } =
      await import('./trashService')

    // Act / Assert
    await expect(
      moveToTrash(
        skillName,
        sourcePath,
        await reviewedIdentityForPath(sourcePath),
      ),
    ).rejects.toThrow(
      /Moved entry left|could not be restored|Failed to remove symlinks/i,
    )
    expect((await lstat(sourcePath)).isDirectory()).toBe(true)
    expect((await lstat(linkPath)).isSymbolicLink()).toBe(true)
    expect(await readlink(linkPath)).toBe(replacementTargetPath)
    const leftovers = await readdir(cursorSkillsDir)
    const cleanupEntries = leftovers.filter((entry) =>
      entry.startsWith(`${skillName}.cleanup-`),
    )
    expect(cleanupEntries).toHaveLength(1)
    const cleanupPath = join(cursorSkillsDir, cleanupEntries[0]!)
    expect((await lstat(cleanupPath)).isSymbolicLink()).toBe(true)
    expect(await readlink(cleanupPath)).toBe(sourcePath)
    expect(await readdir(__getTrashDirForTests())).toEqual([])
  })

  it('restores earlier source-backed symlinks when a later agent aborts cascade cleanup', async () => {
    // Arrange
    const skillName = 'source-partial-rollback'
    const sourcePath = join(tempHome, '.agents', 'skills', skillName)
    const claudeSkillsDir = join(tempHome, '.claude', 'skills')
    const cursorSkillsDir = join(tempHome, '.cursor', 'skills')
    const claudeLinkPath = join(claudeSkillsDir, skillName)
    const cursorLinkPath = join(cursorSkillsDir, skillName)
    const replacementTargetPath = join(
      tempHome,
      '.agents',
      'skills',
      'replacement-target',
    )
    await mkdir(sourcePath, { recursive: true })
    await writeFile(join(sourcePath, 'SKILL.md'), `# ${skillName}\n`, 'utf-8')
    await mkdir(claudeSkillsDir, { recursive: true })
    await mkdir(cursorSkillsDir, { recursive: true })
    await symlink(sourcePath, claudeLinkPath)
    await symlink(sourcePath, cursorLinkPath)
    vi.doMock('node:fs/promises', async () => {
      const actual =
        await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
      return {
        ...actual,
        unlink: async (path: string): Promise<void> => {
          if (String(path).startsWith(`${cursorLinkPath}.cleanup-`)) {
            await actual.symlink(replacementTargetPath, cursorLinkPath)
            const error = new Error(
              'forced cleanup unlink failure',
            ) as NodeJS.ErrnoException
            error.code = 'EACCES'
            throw error
          }
          return actual.unlink(path)
        },
      }
    })
    const { __getTrashDirForTests, moveToTrash } =
      await import('./trashService')

    // Act / Assert
    await expect(
      moveToTrash(
        skillName,
        sourcePath,
        await reviewedIdentityForPath(sourcePath),
      ),
    ).rejects.toThrow(/Failed to remove symlinks|could not be restored/i)
    expect((await lstat(sourcePath)).isDirectory()).toBe(true)
    expect((await lstat(claudeLinkPath)).isSymbolicLink()).toBe(true)
    expect(await readlink(claudeLinkPath)).toBe(sourcePath)
    expect((await lstat(cursorLinkPath)).isSymbolicLink()).toBe(true)
    expect(await readlink(cursorLinkPath)).toBe(replacementTargetPath)
    const leftovers = await readdir(cursorSkillsDir)
    const cleanupEntries = leftovers.filter((entry) =>
      entry.startsWith(`${skillName}.cleanup-`),
    )
    expect(cleanupEntries).toHaveLength(1)
    const cleanupPath = join(cursorSkillsDir, cleanupEntries[0]!)
    expect((await lstat(cleanupPath)).isSymbolicLink()).toBe(true)
    expect(await readlink(cleanupPath)).toBe(sourcePath)
    expect(await readdir(__getTrashDirForTests())).toEqual([])
  })

  it('preserves trash source directory when manifest rollback cannot restore source', async () => {
    // Arrange
    const skillName = 'source-manifest-stranded'
    const sourcePath = join(tempHome, '.agents', 'skills', skillName)
    const cursorSkillsDir = join(tempHome, '.cursor', 'skills')
    const linkPath = join(cursorSkillsDir, skillName)
    await mkdir(sourcePath, { recursive: true })
    await writeFile(join(sourcePath, 'SKILL.md'), `# ${skillName}\n`, 'utf-8')
    await mkdir(cursorSkillsDir, { recursive: true })
    await symlink(sourcePath, linkPath)
    vi.doMock('node:fs/promises', async () => {
      const actual =
        await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
      return {
        ...actual,
        rename: async (oldPath: string, newPath: string): Promise<void> => {
          if (
            oldPath.includes('/.agents/.trash/') &&
            oldPath.endsWith('/source') &&
            newPath === sourcePath
          ) {
            const error = new Error(
              'forced source rollback failure',
            ) as NodeJS.ErrnoException
            error.code = 'EACCES'
            throw error
          }
          return actual.rename(oldPath, newPath)
        },
        writeFile: async (
          path: string,
          data: Parameters<typeof actual.writeFile>[1],
          options?: Parameters<typeof actual.writeFile>[2],
        ): Promise<void> => {
          if (
            path.includes('/.agents/.trash/') &&
            path.endsWith('/manifest.json')
          ) {
            const error = new Error(
              'forced manifest write failure',
            ) as NodeJS.ErrnoException
            error.code = 'EACCES'
            throw error
          }
          return actual.writeFile(path, data, options)
        },
      }
    })
    const { __getTrashDirForTests, moveToTrash } =
      await import('./trashService')

    // Act / Assert
    await expect(
      moveToTrash(
        skillName,
        sourcePath,
        await reviewedIdentityForPath(sourcePath),
      ),
    ).rejects.toThrow(/source is stranded/i)
    await expect(lstat(sourcePath)).rejects.toThrow()
    expect((await lstat(linkPath)).isSymbolicLink()).toBe(true)
    expect(await readlink(linkPath)).toBe(sourcePath)
    const trashEntries = await readdir(__getTrashDirForTests())
    expect(trashEntries).toHaveLength(1)
    expect(
      (
        await lstat(join(__getTrashDirForTests(), trashEntries[0]!, 'source'))
      ).isDirectory(),
    ).toBe(true)
    await expect(
      lstat(join(__getTrashDirForTests(), trashEntries[0]!, 'manifest.json')),
    ).rejects.toThrow()
  })

  it('startupCleanup preserves old entries marked for manual recovery', async () => {
    // Arrange
    const { __getTrashDirForTests, startupCleanup } =
      await import('./trashService')
    const trashDir = __getTrashDirForTests()
    const oldMs = Date.now() - 25 * 60 * 60 * 1000
    const manualEntry = join(trashDir, `${oldMs}-manual-recovery-aaaaaaaa`)
    const sweepEntry = join(trashDir, `${oldMs}-safe-sweep-bbbbbbbb`)
    await mkdir(manualEntry, { recursive: true })
    await mkdir(sweepEntry, { recursive: true })
    await writeFile(
      join(manualEntry, '.manual-recovery'),
      'manual recovery required\n',
      'utf-8',
    )

    // Act
    await startupCleanup()

    // Assert
    await expect(lstat(manualEntry)).resolves.toBeDefined()
    await expect(lstat(sweepEntry)).rejects.toThrow()
  })

  it('preserves source EXDEV fallback copy when removing original fails', async () => {
    // Arrange
    const skillName = 'source-exdev-staged'
    const sourcePath = join(tempHome, '.agents', 'skills', skillName)
    const cursorSkillsDir = join(tempHome, '.cursor', 'skills')
    const linkPath = join(cursorSkillsDir, skillName)
    await mkdir(sourcePath, { recursive: true })
    await writeFile(join(sourcePath, 'SKILL.md'), `# ${skillName}\n`, 'utf-8')
    await mkdir(cursorSkillsDir, { recursive: true })
    await symlink(sourcePath, linkPath)
    vi.doMock('node:fs/promises', async () => {
      const actual =
        await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
      return {
        ...actual,
        rename: async (oldPath: string, newPath: string): Promise<void> => {
          if (oldPath === sourcePath && newPath.includes('/.agents/.trash/')) {
            const error = new Error(
              'forced cross-device source move',
            ) as NodeJS.ErrnoException
            error.code = 'EXDEV'
            throw error
          }
          return actual.rename(oldPath, newPath)
        },
        rm: async (
          path: string,
          options?: Parameters<typeof actual.rm>[1],
        ): Promise<void> => {
          if (path.includes(`.${skillName}.trash-source-`)) {
            const error = new Error(
              'forced source remove failure',
            ) as NodeJS.ErrnoException
            error.code = 'EACCES'
            throw error
          }
          return actual.rm(path, options)
        },
      }
    })
    const { __getTrashDirForTests, moveToTrash } =
      await import('./trashService')

    // Act / Assert
    await expect(
      moveToTrash(
        skillName,
        sourcePath,
        await reviewedIdentityForPath(sourcePath),
      ),
    ).rejects.toThrow(/source copy preserved/i)
    expect((await lstat(sourcePath)).isDirectory()).toBe(true)
    expect((await lstat(linkPath)).isSymbolicLink()).toBe(true)
    const trashEntries = await readdir(__getTrashDirForTests())
    expect(trashEntries).toHaveLength(1)
    const entryDir = join(__getTrashDirForTests(), trashEntries[0]!)
    expect((await lstat(join(entryDir, 'source'))).isDirectory()).toBe(true)
    await expect(
      lstat(join(entryDir, '.manual-recovery')),
    ).resolves.toBeDefined()
  })

  it('preserves local-only EXDEV fallback copy when removing original fails', async () => {
    // Arrange
    const skillName = 'local-exdev-staged'
    const claudeSkillsDir = join(tempHome, '.claude', 'skills')
    const localPath = join(claudeSkillsDir, skillName)
    await mkdir(localPath, { recursive: true })
    await writeFile(join(localPath, 'SKILL.md'), `# ${skillName}\n`, 'utf-8')
    vi.doMock('node:fs/promises', async () => {
      const actual =
        await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
      return {
        ...actual,
        rename: async (oldPath: string, newPath: string): Promise<void> => {
          if (oldPath === localPath && newPath.includes('/.agents/.trash/')) {
            const error = new Error(
              'forced cross-device local move',
            ) as NodeJS.ErrnoException
            error.code = 'EXDEV'
            throw error
          }
          return actual.rename(oldPath, newPath)
        },
        rm: async (
          path: string,
          options?: Parameters<typeof actual.rm>[1],
        ): Promise<void> => {
          if (path.includes(`.${skillName}.trash-local-claude-code-`)) {
            const error = new Error(
              'forced local remove failure',
            ) as NodeJS.ErrnoException
            error.code = 'EACCES'
            throw error
          }
          return actual.rm(path, options)
        },
      }
    })
    const { __getTrashDirForTests, moveToTrash } =
      await import('./trashService')

    // Act / Assert
    await expect(
      moveToTrash(
        skillName,
        localPath,
        await reviewedIdentityForPath(localPath),
      ),
    ).rejects.toThrow(/staged copy preserved/i)
    expect((await lstat(localPath)).isDirectory()).toBe(true)
    const trashEntries = await readdir(__getTrashDirForTests())
    expect(trashEntries).toHaveLength(1)
    const entryDir = join(__getTrashDirForTests(), trashEntries[0]!)
    expect(
      (
        await lstat(join(entryDir, 'local-copies', 'claude-code'))
      ).isDirectory(),
    ).toBe(true)
    await expect(
      lstat(join(entryDir, '.manual-recovery')),
    ).resolves.toBeDefined()
  })
})
