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

  it('refuses name-rescan orphan cleanup when the target is restored during commit', async () => {
    // Arrange
    const skillName = 'orphan-target-restored'
    const cursorSkillsDir = join(tempHome, '.cursor', 'skills')
    const targetPath = join(tempHome, '.agents', 'skills', skillName)
    const linkPath = join(cursorSkillsDir, skillName)
    await mkdir(cursorSkillsDir, { recursive: true })
    await symlink(targetPath, linkPath)
    vi.doMock('node:fs/promises', async () => {
      const actual =
        await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
      return {
        ...actual,
        rename: async (oldPath: string, newPath: string): Promise<void> => {
          if (oldPath === linkPath) {
            await actual.mkdir(targetPath, { recursive: true })
          }
          return actual.rename(oldPath, newPath)
        },
      }
    })
    const { moveToTrash } = await import('./trashService')

    // Act / Assert
    await expect(moveToTrash(skillName)).rejects.toThrow(
      `Failed to remove 1 of 1 orphan symlink for "${skillName}"`,
    )
    expect((await lstat(linkPath)).isSymbolicLink()).toBe(true)
    expect(await readlink(linkPath)).toBe(targetPath)
    expect((await lstat(targetPath)).isDirectory()).toBe(true)
  })

  it('restores an unreviewed local replacement moved during orphan cleanup commit', async () => {
    // Arrange
    const skillName = 'orphan-slot-replaced'
    const cursorSkillsDir = join(tempHome, '.cursor', 'skills')
    const targetPath = join(tempHome, '.agents', 'skills', skillName)
    const linkPath = join(cursorSkillsDir, skillName)
    await mkdir(cursorSkillsDir, { recursive: true })
    await symlink(targetPath, linkPath)
    vi.doMock('node:fs/promises', async () => {
      const actual =
        await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
      return {
        ...actual,
        rename: async (oldPath: string, newPath: string): Promise<void> => {
          if (oldPath === linkPath) {
            await actual.rm(linkPath, { force: true })
            await actual.mkdir(linkPath, { recursive: true })
          }
          return actual.rename(oldPath, newPath)
        },
      }
    })
    const { moveToTrash } = await import('./trashService')

    // Act / Assert
    await expect(moveToTrash(skillName)).rejects.toThrow(
      `Failed to remove 1 of 1 orphan symlink for "${skillName}"`,
    )
    expect((await lstat(linkPath)).isDirectory()).toBe(true)
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
    await expect(moveToTrash(skillName)).rejects.toThrow(
      /Moved entry left|could not be restored|Failed to remove symlinks/i,
    )
    expect((await lstat(sourcePath)).isDirectory()).toBe(true)
    expect((await lstat(linkPath)).isSymbolicLink()).toBe(true)
    expect(await readlink(linkPath)).toBe(replacementTargetPath)
    const leftovers = await readdir(cursorSkillsDir)
    expect(
      leftovers.some((entry) => entry.startsWith(`${skillName}.cleanup-`)),
    ).toBe(true)
    expect(await readdir(__getTrashDirForTests())).toEqual([])
  })
})
