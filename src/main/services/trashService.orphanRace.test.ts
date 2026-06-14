import { existsSync } from 'node:fs'
import type { BigIntStats, Stats } from 'node:fs'
import {
  mkdir,
  mkdtemp,
  lstat,
  readdir,
  readFile,
  readlink,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import type * as NodeFsPromises from 'node:fs/promises'
import type * as NodeOs from 'node:os'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FilesystemEntryIdentity } from '@/shared/types'

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

/**
 * Identity stand-in for a path whose stats were never captured — used to drive
 * pre-staging rejections that fail before any identity comparison matters.
 */
const missingDirectoryIdentityForOrphanTests: FilesystemEntryIdentity = {
  kind: 'directory',
  dev: 1,
  ino: 1,
  size: 96,
  ctimeMs: 1,
  mtimeMs: 1,
}

/**
 * Return a copy of real Stats that reports as a symlink, so a post-rename
 * identity recheck (which rejects symlinks) fails on demand inside a mocked lstat.
 * @param realStats - The genuine lstat result for the staged path.
 * @returns Stats whose isSymbolicLink() is true and isDirectory() is false.
 */
function makeSymlinkStats(realStats: Stats | BigIntStats): Stats {
  return Object.assign(
    Object.create(Object.getPrototypeOf(realStats)),
    realStats,
    {
      isSymbolicLink: () => true,
      isDirectory: () => false,
      isFile: () => false,
    },
  )
}

/**
 * Return a copy of real Stats that reports as none of file/dir/symlink, so the
 * "type cannot be restored safely" defensive branch is exercised.
 * @param realStats - The genuine lstat result for the moved cleanup candidate.
 * @returns Stats whose is{File,Directory,SymbolicLink}() all return false.
 */
function makeUntypedStats(realStats: Stats | BigIntStats): Stats {
  return Object.assign(
    Object.create(Object.getPrototypeOf(realStats)),
    realStats,
    {
      isSymbolicLink: () => false,
      isDirectory: () => false,
      isFile: () => false,
    },
  )
}

/**
 * Hand-build a source-backed trash entry on disk so restore() has something to
 * consume, bypassing moveToTrash to control the manifest contents directly.
 * @param trashDir - Resolved TRASH_DIR for the active mocked home.
 * @param params - Skill name, source path, and symlink records for the manifest.
 * @returns The tombstone id (entry basename) to pass to restore().
 */
async function buildSourceBackedTrashEntry(
  trashDir: string,
  params: {
    skillName: string
    sourcePath: string
    symlinks: { agentId: string; linkPath: string; target: string }[]
  },
): Promise<string> {
  const tombstoneId = `${Date.now()}-${params.skillName}-deadbeef`
  const entryDir = join(trashDir, tombstoneId)
  const entrySourceDir = join(entryDir, 'source')
  await mkdir(entrySourceDir, { recursive: true })
  await writeFile(
    join(entrySourceDir, 'SKILL.md'),
    `# ${params.skillName}\n`,
    'utf-8',
  )
  const manifest = {
    schemaVersion: 2,
    kind: 'source-backed',
    deletedAt: Date.now(),
    skillName: params.skillName,
    sourcePath: params.sourcePath,
    symlinks: params.symlinks,
  }
  await writeFile(
    join(entryDir, 'manifest.json'),
    JSON.stringify(manifest),
    'utf-8',
  )
  return tombstoneId
}

/**
 * Poll until a trash directory is empty, accommodating the fire-and-forget evict
 * whose directory removal runs detached from the TTL timer that triggered it.
 * @param trashDir - Resolved TRASH_DIR to observe.
 * @returns Resolves once the directory is empty or the bounded attempts elapse.
 */
async function waitForTrashEntryRemoval(trashDir: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const entries = await readdir(trashDir)
    if (entries.length === 0) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
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

  it('preserves moved cleanup symlink when restore destination appears after empty check', async () => {
    // Arrange
    const skillName = 'source-restore-race-after-check'
    const sourcePath = join(tempHome, '.agents', 'skills', skillName)
    const cursorSkillsDir = join(tempHome, '.cursor', 'skills')
    const linkPath = join(cursorSkillsDir, skillName)
    const replacementTargetPath = join(
      tempHome,
      '.agents',
      'skills',
      'replacement-after-check',
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
            const error = new Error(
              'forced cleanup unlink failure before restore race',
            ) as NodeJS.ErrnoException
            error.code = 'EACCES'
            throw error
          }
          return actual.unlink(path)
        },
        symlink: async (
          target: string,
          path: string,
          type?: Parameters<typeof actual.symlink>[2],
        ): Promise<void> => {
          if (target === sourcePath && path === linkPath) {
            await actual.symlink(replacementTargetPath, linkPath)
            const error = new Error(
              'forced restore destination collision',
            ) as NodeJS.ErrnoException
            error.code = 'EEXIST'
            throw error
          }
          return actual.symlink(target, path, type)
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
    ).rejects.toThrow(/could not be restored/i)
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

  it('preserves source-backed tombstone when source path reappears as an empty directory during restore', async () => {
    // Arrange
    const skillName = 'source-restore-empty-dir-race'
    const sourcePath = join(tempHome, '.agents', 'skills', skillName)
    let seededReplacement = false
    vi.doMock('node:fs/promises', async () => {
      const actual =
        await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
      return {
        ...actual,
        lstat: async (
          path: string,
          options?: Parameters<typeof actual.lstat>[1],
        ): Promise<Awaited<ReturnType<typeof actual.lstat>>> => {
          if (path === sourcePath && !seededReplacement) {
            seededReplacement = true
            await actual.mkdir(sourcePath, { recursive: true })
            const error = new Error(
              'source path was absent at review time',
            ) as NodeJS.ErrnoException
            error.code = 'ENOENT'
            throw error
          }
          return actual.lstat(path, options)
        },
      }
    })
    const { __getTrashDirForTests, restore } = await import('./trashService')
    const tombstone = `${Date.now()}-${skillName}-1234abcd`
    const entryDir = join(__getTrashDirForTests(), tombstone)
    const entrySourceDir = join(entryDir, 'source')
    await mkdir(entrySourceDir, { recursive: true })
    await writeFile(join(entrySourceDir, 'SKILL.md'), '# restored\n', 'utf-8')
    await writeFile(
      join(entryDir, 'manifest.json'),
      JSON.stringify({
        schemaVersion: 2,
        kind: 'source-backed',
        deletedAt: Date.now(),
        skillName,
        sourcePath,
        symlinks: [],
      }),
      'utf-8',
    )

    // Act
    const result = await restore(tombstone as never)

    // Assert
    expect(result.outcome).toBe('error')
    if (result.outcome === 'error') {
      expect(result.error.code).toBe('ERR_FS_CP_EEXIST')
    }
    expect(await readdir(sourcePath)).toEqual([])
    await expect(stat(join(entrySourceDir, 'SKILL.md'))).resolves.toBeTruthy()
  })

  it('keeps local-only staged copy when agent slot reappears as an empty directory during restore', async () => {
    // Arrange
    const skillName = 'local-restore-empty-dir-race'
    const linkPath = join(tempHome, '.claude', 'skills', skillName)
    let seededReplacement = false
    vi.doMock('node:fs/promises', async () => {
      const actual =
        await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
      return {
        ...actual,
        lstat: async (
          path: string,
          options?: Parameters<typeof actual.lstat>[1],
        ): Promise<Awaited<ReturnType<typeof actual.lstat>>> => {
          if (path === linkPath && !seededReplacement) {
            seededReplacement = true
            await actual.mkdir(linkPath, { recursive: true })
            const error = new Error(
              'agent slot was absent at review time',
            ) as NodeJS.ErrnoException
            error.code = 'ENOENT'
            throw error
          }
          return actual.lstat(path, options)
        },
      }
    })
    const { __getTrashDirForTests, restore } = await import('./trashService')
    const tombstone = `${Date.now()}-${skillName}-5678abcd`
    const entryDir = join(__getTrashDirForTests(), tombstone)
    const stagedPath = join(entryDir, 'local-copies', 'claude-code')
    await mkdir(stagedPath, { recursive: true })
    await writeFile(join(stagedPath, 'SKILL.md'), '# staged\n', 'utf-8')
    await writeFile(
      join(entryDir, 'manifest.json'),
      JSON.stringify({
        schemaVersion: 2,
        kind: 'local-only',
        deletedAt: Date.now(),
        skillName,
        localCopies: [{ agentId: 'claude-code', linkPath }],
      }),
      'utf-8',
    )

    // Act
    const result = await restore(tombstone as never)

    // Assert
    expect(result.outcome).toBe('restored')
    if (result.outcome === 'restored') {
      expect(result.symlinksRestored).toBe(0)
      expect(result.symlinksSkipped).toBe(1)
    }
    expect(await readdir(linkPath)).toEqual([])
    await expect(stat(join(stagedPath, 'SKILL.md'))).resolves.toBeTruthy()
    await expect(stat(join(entryDir, 'manifest.json'))).resolves.toBeTruthy()
  })

  it('preserves relative symlink targets inside local-only staged copies during restore', async () => {
    // Arrange
    const skillName = 'local-restore-relative-symlink'
    const linkPath = join(tempHome, '.claude', 'skills', skillName)
    const { __getTrashDirForTests, restore } = await import('./trashService')
    const tombstone = `${Date.now()}-${skillName}-9abcdeff`
    const entryDir = join(__getTrashDirForTests(), tombstone)
    const stagedPath = join(entryDir, 'local-copies', 'claude-code')
    const symlinkPath = join(stagedPath, 'links', 'target-link')
    await mkdir(join(stagedPath, 'links'), { recursive: true })
    await mkdir(join(stagedPath, 'target'), { recursive: true })
    await writeFile(
      join(stagedPath, 'target', 'SKILL.md'),
      '# target\n',
      'utf-8',
    )
    await symlink('../target', symlinkPath)
    await writeFile(
      join(entryDir, 'manifest.json'),
      JSON.stringify({
        schemaVersion: 2,
        kind: 'local-only',
        deletedAt: Date.now(),
        skillName,
        localCopies: [{ agentId: 'claude-code', linkPath }],
      }),
      'utf-8',
    )

    // Act
    const result = await restore(tombstone as never)

    // Assert
    expect(result.outcome).toBe('restored')
    if (result.outcome === 'restored') {
      expect(result.symlinksRestored).toBe(1)
      expect(result.symlinksSkipped).toBe(0)
    }
    await expect(
      readlink(join(linkPath, 'links', 'target-link')),
    ).resolves.toBe('../target')
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
        cp: async (
          source: string,
          destination: string,
          options?: Parameters<typeof actual.cp>[2],
        ): Promise<void> => {
          if (
            source.includes('/.agents/.trash/') &&
            source.endsWith('/source') &&
            destination === sourcePath
          ) {
            const error = new Error(
              'forced source rollback failure',
            ) as NodeJS.ErrnoException
            error.code = 'EACCES'
            throw error
          }
          return actual.cp(source, destination, options)
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
        cp: async (
          source: string,
          destination: string,
          options?: Parameters<typeof actual.cp>[2],
        ): Promise<void> => {
          expect(options).toMatchObject({
            recursive: true,
            force: false,
            errorOnExist: true,
          })
          return actual.cp(source, destination, options)
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

  it('does not overwrite a replacement during manifest rollback restore', async () => {
    // Arrange
    const skillName = 'source-manifest-exdev-collision'
    const sourcePath = join(tempHome, '.agents', 'skills', skillName)
    const cursorSkillsDir = join(tempHome, '.cursor', 'skills')
    const linkPath = join(cursorSkillsDir, skillName)
    await mkdir(sourcePath, { recursive: true })
    await writeFile(
      join(sourcePath, 'SKILL.md'),
      `# original ${skillName}\n`,
      'utf-8',
    )
    await mkdir(cursorSkillsDir, { recursive: true })
    await symlink(sourcePath, linkPath)
    vi.doMock('node:fs/promises', async () => {
      const actual =
        await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
      return {
        ...actual,
        cp: async (
          source: string,
          destination: string,
          options?: Parameters<typeof actual.cp>[2],
        ): Promise<void> => {
          if (
            source.includes('/.agents/.trash/') &&
            source.endsWith('/source') &&
            destination === sourcePath
          ) {
            await actual.mkdir(sourcePath, { recursive: true })
            await actual.writeFile(
              join(sourcePath, 'SKILL.md'),
              `# replacement ${skillName}\n`,
              'utf-8',
            )
            return actual.cp(source, destination, options)
          }
          return actual.cp(source, destination, options)
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
    expect(await readFile(join(sourcePath, 'SKILL.md'), 'utf-8')).toBe(
      `# replacement ${skillName}\n`,
    )
    expect((await lstat(linkPath)).isSymbolicLink()).toBe(true)
    expect(await readlink(linkPath)).toBe(sourcePath)
    const trashEntries = await readdir(__getTrashDirForTests())
    expect(trashEntries).toHaveLength(1)
    const entryDir = join(__getTrashDirForTests(), trashEntries[0]!)
    expect(await readFile(join(entryDir, 'source', 'SKILL.md'), 'utf-8')).toBe(
      `# original ${skillName}\n`,
    )
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
        cp: async (
          source: string,
          destination: string,
          options?: Parameters<typeof actual.cp>[2],
        ): Promise<void> => {
          expect(options).toMatchObject({
            recursive: true,
            force: false,
            errorOnExist: true,
          })
          return actual.cp(source, destination, options)
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

  it('rejects deleting a reviewed path that contains a null byte in its basename', async () => {
    // Arrange
    // A reviewed source path whose basename carries a NUL byte passes the
    // traversal check (realpath of a NUL path throws and is caught) but must be
    // refused before any filesystem mutation — the basename is unusable as a
    // skill folder name.
    const sourceSkillsDir = join(tempHome, '.agents', 'skills')
    await mkdir(sourceSkillsDir, { recursive: true })
    const nullBytePath = join(sourceSkillsDir, `null name`)
    const { moveToTrash } = await import('./trashService')

    // Act / Assert
    await expect(
      moveToTrash(
        'null-byte-skill' as never,
        nullBytePath as never,
        missingDirectoryIdentityForOrphanTests,
      ),
    ).rejects.toThrow(/invalid basename/i)
  })

  it('rejects deleting a path that sits outside every known skill directory', async () => {
    // Arrange
    // The reviewed path lives in a random folder that is neither SOURCE_DIR nor
    // any agent skills dir, so there is no destructive flow that can own it.
    const strayPath = join(tempHome, 'somewhere', 'else', 'stray-skill')
    await mkdir(join(tempHome, 'somewhere', 'else'), { recursive: true })
    await mkdir(strayPath, { recursive: true })
    await writeFile(join(strayPath, 'SKILL.md'), '# stray\n', 'utf-8')
    const { moveToTrash } = await import('./trashService')

    // Act / Assert
    await expect(
      moveToTrash(
        'stray-skill' as never,
        strayPath as never,
        await reviewedIdentityForPath(strayPath),
      ),
    ).rejects.toThrow(/outside known skill directories/i)
  })

  it('refuses to delete a reviewed source slot that is now a symlink instead of a real folder', async () => {
    // Arrange
    // The reviewed source row pointed at a real directory; by delete time the
    // slot is a symlink, so the pre-staging gate must reject it as stale.
    const sourceSkillsDir = join(tempHome, '.agents', 'skills')
    await mkdir(sourceSkillsDir, { recursive: true })
    const realSourcePath = join(sourceSkillsDir, 'symlinked-source')
    await mkdir(realSourcePath, { recursive: true })
    await writeFile(join(realSourcePath, 'SKILL.md'), '# real\n', 'utf-8')
    const reviewedIdentity = await reviewedIdentityForPath(realSourcePath)
    await rm(realSourcePath, { recursive: true, force: true })
    await symlink(join(sourceSkillsDir, 'elsewhere'), realSourcePath)
    const { moveToTrash } = await import('./trashService')

    // Act / Assert
    await expect(
      moveToTrash(
        'symlinked-source' as never,
        realSourcePath as never,
        reviewedIdentity,
      ),
    ).rejects.toMatchObject({ code: 'ESTALE' })
  })

  it('refuses to delete a reviewed folder that no longer carries a SKILL.md file', async () => {
    // Arrange
    // The reviewed folder is unchanged (same identity) but its SKILL.md was
    // removed since review, so it is no longer a valid skill and must be left
    // untouched rather than trashed.
    const sourceSkillsDir = join(tempHome, '.agents', 'skills')
    await mkdir(sourceSkillsDir, { recursive: true })
    const invalidSkillPath = join(sourceSkillsDir, 'no-skill-md')
    await mkdir(invalidSkillPath, { recursive: true })
    await writeFile(
      join(invalidSkillPath, 'README.md'),
      '# not a skill\n',
      'utf-8',
    )
    const { moveToTrash } = await import('./trashService')

    // Act / Assert
    await expect(
      moveToTrash(
        'no-skill-md' as never,
        invalidSkillPath as never,
        await reviewedIdentityForPath(invalidSkillPath),
      ),
    ).rejects.toMatchObject({ code: 'ESTALE' })
  })

  it('reports "already deleted" when the reviewed source vanishes before the move into trash', async () => {
    // Arrange
    // assertReviewedSkillDirectory passes, but the source rename into the trash
    // entry then fails with ENOENT (the folder raced away). The trash entry must
    // be cleaned up and the caller told the skill is already gone.
    const skillName = 'source-vanished-before-move'
    const sourcePath = join(tempHome, '.agents', 'skills', skillName)
    await mkdir(sourcePath, { recursive: true })
    await writeFile(join(sourcePath, 'SKILL.md'), `# ${skillName}\n`, 'utf-8')
    vi.doMock('node:fs/promises', async () => {
      const actual =
        await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
      return {
        ...actual,
        rename: async (oldPath: string, newPath: string): Promise<void> => {
          if (oldPath === sourcePath && newPath.includes('/.agents/.trash/')) {
            const error = new Error(
              'forced missing source on move',
            ) as NodeJS.ErrnoException
            error.code = 'ENOENT'
            throw error
          }
          return actual.rename(oldPath, newPath)
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
    ).rejects.toThrow(/already deleted/i)
    expect((await lstat(sourcePath)).isDirectory()).toBe(true)
    await expect(readdir(__getTrashDirForTests())).resolves.toEqual([])
  })

  it('surfaces a generic move error and drops the trash entry when the source rename fails hard', async () => {
    // Arrange
    // A non-EXDEV, non-ENOENT rename failure (EACCES) is a hard failure: the
    // staged trash entry must be removed and the original error surfaced.
    const skillName = 'source-rename-eacces'
    const sourcePath = join(tempHome, '.agents', 'skills', skillName)
    await mkdir(sourcePath, { recursive: true })
    await writeFile(join(sourcePath, 'SKILL.md'), `# ${skillName}\n`, 'utf-8')
    vi.doMock('node:fs/promises', async () => {
      const actual =
        await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
      return {
        ...actual,
        rename: async (oldPath: string, newPath: string): Promise<void> => {
          if (oldPath === sourcePath && newPath.includes('/.agents/.trash/')) {
            const error = new Error(
              'forced permission denied on move',
            ) as NodeJS.ErrnoException
            error.code = 'EACCES'
            throw error
          }
          return actual.rename(oldPath, newPath)
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
    ).rejects.toThrow(/Failed to move source to trash/i)
    expect((await lstat(sourcePath)).isDirectory()).toBe(true)
    await expect(readdir(__getTrashDirForTests())).resolves.toEqual([])
  })

  it('completes a cross-device source delete by copying into the trash entry', async () => {
    // Arrange
    // The same-device rename into the trash entry fails with EXDEV; the
    // cross-device fallback (sibling rename + copy + remove) must still produce
    // a tombstoned source-backed entry.
    const skillName = 'source-exdev-clean'
    const sourcePath = join(tempHome, '.agents', 'skills', skillName)
    await mkdir(sourcePath, { recursive: true })
    await writeFile(join(sourcePath, 'SKILL.md'), `# ${skillName}\n`, 'utf-8')
    vi.doMock('node:fs/promises', async () => {
      const actual =
        await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
      return {
        ...actual,
        rename: async (oldPath: string, newPath: string): Promise<void> => {
          // Only the source → <entryDir>/source move is cross-device; the
          // same-directory sibling rename stays local so the fallback can work.
          if (oldPath === sourcePath && newPath.includes('/.agents/.trash/')) {
            const error = new Error(
              'forced cross-device source move',
            ) as NodeJS.ErrnoException
            error.code = 'EXDEV'
            throw error
          }
          return actual.rename(oldPath, newPath)
        },
      }
    })
    const { __clearEvictTimersForTests, __getTrashDirForTests, moveToTrash } =
      await import('./trashService')

    // Act
    const result = await moveToTrash(
      skillName,
      sourcePath,
      await reviewedIdentityForPath(sourcePath),
    )

    // Assert
    expect(result.kind).toBe('tombstoned')
    await expect(lstat(sourcePath)).rejects.toThrow()
    const trashEntries = await readdir(__getTrashDirForTests())
    expect(trashEntries).toHaveLength(1)
    const stagedSource = join(
      __getTrashDirForTests(),
      trashEntries[0]!,
      'source',
      'SKILL.md',
    )
    expect(await readFile(stagedSource, 'utf-8')).toContain(skillName)
    __clearEvictTimersForTests()
  })

  it('rolls back unlinked symlinks (logging failures) when the source move fails', async () => {
    // Arrange
    // One agent symlink is removed during the cascade, then the source move
    // fails with ENOENT. Re-creating that symlink during rollback ALSO fails
    // (EACCES); the failure must be logged best-effort, not thrown, so the
    // caller still surfaces the original "already deleted" error.
    const skillName = 'rollback-symlink-warn'
    const sourcePath = join(tempHome, '.agents', 'skills', skillName)
    const cursorSkillsDir = join(tempHome, '.cursor', 'skills')
    const cursorLinkPath = join(cursorSkillsDir, skillName)
    await mkdir(sourcePath, { recursive: true })
    await writeFile(join(sourcePath, 'SKILL.md'), `# ${skillName}\n`, 'utf-8')
    await mkdir(cursorSkillsDir, { recursive: true })
    await symlink(sourcePath, cursorLinkPath)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.doMock('node:fs/promises', async () => {
      const actual =
        await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
      return {
        ...actual,
        rename: async (oldPath: string, newPath: string): Promise<void> => {
          if (oldPath === sourcePath && newPath.includes('/.agents/.trash/')) {
            const error = new Error(
              'forced missing source on move',
            ) as NodeJS.ErrnoException
            error.code = 'ENOENT'
            throw error
          }
          return actual.rename(oldPath, newPath)
        },
        symlink: async (
          target: string,
          path: string,
          type?: Parameters<typeof actual.symlink>[2],
        ): Promise<void> => {
          // Fail only the rollback re-creation of the cursor link.
          if (path === cursorLinkPath) {
            const error = new Error(
              'forced rollback symlink failure',
            ) as NodeJS.ErrnoException
            error.code = 'EACCES'
            throw error
          }
          return actual.symlink(target, path, type)
        },
      }
    })
    const { moveToTrash } = await import('./trashService')

    // Act / Assert
    await expect(
      moveToTrash(
        skillName,
        sourcePath,
        await reviewedIdentityForPath(sourcePath),
      ),
    ).rejects.toThrow(/already deleted/i)
    expect(
      warnSpy.mock.calls.some(
        ([message]) => message === 'trashService: rollback symlink failed',
      ),
    ).toBe(true)
    warnSpy.mockRestore()
  })

  it('restores the source and drops the entry when the staged source fails its identity recheck', async () => {
    // Arrange
    // The same-device rename succeeds, but the post-rename identity recheck sees
    // a non-directory (mocked symlink) staged entry. The source is moved back to
    // its original path and the empty trash entry is dropped.
    const skillName = 'staged-identity-mismatch-restored'
    const sourcePath = join(tempHome, '.agents', 'skills', skillName)
    await mkdir(sourcePath, { recursive: true })
    await writeFile(join(sourcePath, 'SKILL.md'), `# ${skillName}\n`, 'utf-8')
    vi.doMock('node:fs/promises', async () => {
      const actual =
        await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
      return {
        ...actual,
        lstat: async (
          path: string,
          options?: Parameters<typeof actual.lstat>[1],
        ): Promise<Awaited<ReturnType<typeof actual.lstat>>> => {
          const realStats = await actual.lstat(path, options)
          // Make the staged <entryDir>/source look like a symlink so the
          // post-rename recheck fails and triggers the restore path.
          if (path.includes('/.agents/.trash/') && path.endsWith('/source')) {
            return makeSymlinkStats(realStats)
          }
          return realStats
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
    ).rejects.toMatchObject({ code: 'ESTALE' })
    expect((await lstat(sourcePath)).isDirectory()).toBe(true)
    expect(await readFile(join(sourcePath, 'SKILL.md'), 'utf-8')).toContain(
      skillName,
    )
    await expect(readdir(__getTrashDirForTests())).resolves.toEqual([])
  })

  it('preserves the staged source for manual recovery when the identity-recheck restore also fails', async () => {
    // Arrange
    // Same staged-identity mismatch, but this time the no-overwrite restore back
    // to the original path fails. The staged source under the trash entry is the
    // only surviving copy, so it must be kept and marked for manual recovery.
    const skillName = 'staged-identity-mismatch-stranded'
    const sourcePath = join(tempHome, '.agents', 'skills', skillName)
    await mkdir(sourcePath, { recursive: true })
    await writeFile(join(sourcePath, 'SKILL.md'), `# ${skillName}\n`, 'utf-8')
    vi.doMock('node:fs/promises', async () => {
      const actual =
        await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
      return {
        ...actual,
        lstat: async (
          path: string,
          options?: Parameters<typeof actual.lstat>[1],
        ): Promise<Awaited<ReturnType<typeof actual.lstat>>> => {
          const realStats = await actual.lstat(path, options)
          if (path.includes('/.agents/.trash/') && path.endsWith('/source')) {
            return makeSymlinkStats(realStats)
          }
          return realStats
        },
        cp: async (
          source: string,
          destination: string,
          options?: Parameters<typeof actual.cp>[2],
        ): Promise<void> => {
          // Fail the restore copy back to the original source path.
          if (destination === sourcePath) {
            const error = new Error(
              'forced restore copy failure',
            ) as NodeJS.ErrnoException
            error.code = 'EACCES'
            throw error
          }
          return actual.cp(source, destination, options)
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
    ).rejects.toMatchObject({ code: 'ESTALE' })
    const trashEntries = await readdir(__getTrashDirForTests())
    expect(trashEntries).toHaveLength(1)
    const entryDir = join(__getTrashDirForTests(), trashEntries[0]!)
    await expect(
      lstat(join(entryDir, '.manual-recovery')),
    ).resolves.toBeDefined()
  })

  it('restores the source on a cross-device delete when the staged sibling fails its identity recheck', async () => {
    // Arrange
    // The EXDEV fallback renames the source to a same-directory sibling, then the
    // identity recheck on that sibling fails (mocked symlink). The sibling is
    // moved back to the original path and the stale error surfaces.
    const skillName = 'exdev-sibling-identity-mismatch'
    const sourcePath = join(tempHome, '.agents', 'skills', skillName)
    await mkdir(sourcePath, { recursive: true })
    await writeFile(join(sourcePath, 'SKILL.md'), `# ${skillName}\n`, 'utf-8')
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
        lstat: async (
          path: string,
          options?: Parameters<typeof actual.lstat>[1],
        ): Promise<Awaited<ReturnType<typeof actual.lstat>>> => {
          const realStats = await actual.lstat(path, options)
          // The EXDEV fallback's sibling stage path is `.${name}.trash-source-*`.
          if (path.includes(`.${skillName}.trash-source-`)) {
            return makeSymlinkStats(realStats)
          }
          return realStats
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
    ).rejects.toMatchObject({ code: 'ESTALE' })
    expect((await lstat(sourcePath)).isDirectory()).toBe(true)
    expect(await readFile(join(sourcePath, 'SKILL.md'), 'utf-8')).toContain(
      skillName,
    )
    await expect(readdir(__getTrashDirForTests())).resolves.toEqual([])
  })

  it('marks an entry for manual recovery when its recovery marker cannot be written', async () => {
    // Arrange
    // The EXDEV fallback copied the source into trash but removing the original
    // failed, so the entry must be marked for manual recovery. The marker write
    // itself fails (EACCES); that failure is logged best-effort and the original
    // recovery error still surfaces with the entry preserved.
    const skillName = 'manual-marker-write-fails'
    const sourcePath = join(tempHome, '.agents', 'skills', skillName)
    await mkdir(sourcePath, { recursive: true })
    await writeFile(join(sourcePath, 'SKILL.md'), `# ${skillName}\n`, 'utf-8')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
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
          // Removing the EXDEV sibling stage fails → entry preserved for recovery.
          if (path.includes(`.${skillName}.trash-source-`)) {
            const error = new Error(
              'forced sibling remove failure',
            ) as NodeJS.ErrnoException
            error.code = 'EACCES'
            throw error
          }
          return actual.rm(path, options)
        },
        writeFile: async (
          path: string,
          data: Parameters<typeof actual.writeFile>[1],
          options?: Parameters<typeof actual.writeFile>[2],
        ): Promise<void> => {
          // Fail the manual-recovery marker write.
          if (path.endsWith('/.manual-recovery')) {
            const error = new Error(
              'forced marker write failure',
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
    ).rejects.toThrow(/source copy preserved/i)
    expect(
      warnSpy.mock.calls.some(
        ([message]) =>
          message === 'trashService: failed to mark manual recovery entry',
      ),
    ).toBe(true)
    const trashEntries = await readdir(__getTrashDirForTests())
    expect(trashEntries).toHaveLength(1)
    warnSpy.mockRestore()
  })

  it('keeps an old entry on startup when its recovery marker cannot be read', async () => {
    // Arrange
    // An ancient trash entry's recovery-marker probe fails with a non-ENOENT
    // error (EACCES). Startup cleanup must treat the unreadable marker as
    // present and preserve the entry instead of sweeping it.
    const trashDir = join(tempHome, '.agents', '.trash')
    const oldMs = Date.now() - 25 * 60 * 60 * 1000
    const unreadableMarkerEntry = join(
      trashDir,
      `${oldMs}-marker-unreadable-cccccccc`,
    )
    await mkdir(unreadableMarkerEntry, { recursive: true })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.doMock('node:fs/promises', async () => {
      const actual =
        await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
      return {
        ...actual,
        access: async (
          path: string,
          mode?: Parameters<typeof actual.access>[1],
        ): Promise<void> => {
          if (path.endsWith('/.manual-recovery')) {
            const error = new Error(
              'forced marker access failure',
            ) as NodeJS.ErrnoException
            error.code = 'EACCES'
            throw error
          }
          return actual.access(path, mode)
        },
      }
    })
    const { startupCleanup } = await import('./trashService')

    // Act
    await startupCleanup()

    // Assert
    await expect(lstat(unreadableMarkerEntry)).resolves.toBeDefined()
    expect(
      warnSpy.mock.calls.some(
        ([message]) =>
          message === 'trashService: manual recovery marker check failed',
      ),
    ).toBe(true)
    warnSpy.mockRestore()
  })

  it('restores a real-file cleanup candidate after a dangling symlink slot changes type', async () => {
    // Arrange
    // commitReviewedDanglingSymlink quarantines the reviewed slot, but the moved
    // entry turns out to be a regular file (not the expected symlink). It must be
    // restored to its original path via copyFile, then the stale error surfaces.
    const cursorSkillsDir = join(tempHome, '.cursor', 'skills')
    await mkdir(cursorSkillsDir, { recursive: true })
    const slotPath = join(cursorSkillsDir, 'file-cleanup-candidate')
    await writeFile(slotPath, 'plain file contents\n', 'utf-8')
    const targetPath = join(
      tempHome,
      '.agents',
      'skills',
      'file-cleanup-candidate',
    )
    const { commitReviewedDanglingSymlink } = await import('./trashService')

    // Act / Assert
    await expect(
      commitReviewedDanglingSymlink({
        linkPath: slotPath as never,
        targetPath: targetPath as never,
        targetChangedMessage: 'target changed',
        targetExistsMessage: 'target exists',
        targetProbePrefix: 'cannot probe target',
      }),
    ).rejects.toThrow(/no longer a symlink/i)
    // The plain file was restored to its original slot, not lost in a .cleanup-* path.
    expect((await lstat(slotPath)).isFile()).toBe(true)
    expect(await readFile(slotPath, 'utf-8')).toBe('plain file contents\n')
    const leftovers = await readdir(cursorSkillsDir)
    expect(
      leftovers.filter((entry) => entry.includes('.cleanup-')),
    ).toHaveLength(0)
  })

  it('refuses to restore a cleanup candidate that is neither file, directory, nor symlink', async () => {
    // Arrange
    // The quarantined moved entry reports an unsupported type (mocked: not a
    // file, directory, or symlink), so restoring it safely is impossible and the
    // restore must throw an EINVAL TrashError.
    const cursorSkillsDir = join(tempHome, '.cursor', 'skills')
    await mkdir(cursorSkillsDir, { recursive: true })
    const slotPath = join(cursorSkillsDir, 'weird-type-candidate')
    await writeFile(slotPath, 'placeholder\n', 'utf-8')
    const targetPath = join(
      tempHome,
      '.agents',
      'skills',
      'weird-type-candidate',
    )
    vi.doMock('node:fs/promises', async () => {
      const actual =
        await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
      return {
        ...actual,
        lstat: async (
          path: string,
          options?: Parameters<typeof actual.lstat>[1],
        ): Promise<Awaited<ReturnType<typeof actual.lstat>>> => {
          const realStats = await actual.lstat(path, options)
          // Make the moved .cleanup-* entry report as an unsupported type.
          if (path.includes(`${slotPath}.cleanup-`)) {
            return makeUntypedStats(realStats)
          }
          return realStats
        },
      }
    })
    const { commitReviewedDanglingSymlink } = await import('./trashService')

    // Act / Assert
    await expect(
      commitReviewedDanglingSymlink({
        linkPath: slotPath as never,
        targetPath: targetPath as never,
        targetChangedMessage: 'target changed',
        targetExistsMessage: 'target exists',
        targetProbePrefix: 'cannot probe target',
      }),
    ).rejects.toThrow(/cannot be restored safely/i)
  })

  it('restores a moved local copy when a local-only manifest write fails after staging', async () => {
    // Arrange
    // The single local copy is staged into trash, then the manifest write fails.
    // Rollback must move that staged copy back to its original agent slot, and
    // because every copy was restored the trash entry is dropped entirely.
    const skillName = 'local-manifest-rollback-restored'
    const claudeSkillsDir = join(tempHome, '.claude', 'skills')
    const localPath = join(claudeSkillsDir, skillName)
    await mkdir(localPath, { recursive: true })
    await writeFile(join(localPath, 'SKILL.md'), `# ${skillName}\n`, 'utf-8')
    vi.doMock('node:fs/promises', async () => {
      const actual =
        await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
      return {
        ...actual,
        writeFile: async (
          path: string,
          data: Parameters<typeof actual.writeFile>[1],
          options?: Parameters<typeof actual.writeFile>[2],
        ): Promise<void> => {
          if (path.endsWith('/manifest.json')) {
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
        localPath,
        await reviewedIdentityForPath(localPath),
      ),
    ).rejects.toThrow(/Failed to write trash manifest/i)
    // The staged folder was restored to its original agent slot.
    expect(await readFile(join(localPath, 'SKILL.md'), 'utf-8')).toContain(
      skillName,
    )
    // All copies restored → trash entry removed.
    await expect(readdir(__getTrashDirForTests())).resolves.toEqual([])
  })

  it('strands a local copy for manual recovery when manifest rollback cannot restore it', async () => {
    // Arrange
    // Manifest write fails AND the rollback restore of the staged copy fails too,
    // so the staged folder under local-copies is the only surviving copy. The
    // entry must be preserved, marked for manual recovery, and the error must
    // name the stranded agent.
    const skillName = 'local-manifest-rollback-stranded'
    const claudeSkillsDir = join(tempHome, '.claude', 'skills')
    const localPath = join(claudeSkillsDir, skillName)
    await mkdir(localPath, { recursive: true })
    await writeFile(join(localPath, 'SKILL.md'), `# ${skillName}\n`, 'utf-8')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.doMock('node:fs/promises', async () => {
      const actual =
        await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
      return {
        ...actual,
        writeFile: async (
          path: string,
          data: Parameters<typeof actual.writeFile>[1],
          options?: Parameters<typeof actual.writeFile>[2],
        ): Promise<void> => {
          if (path.endsWith('/manifest.json')) {
            const error = new Error(
              'forced manifest write failure',
            ) as NodeJS.ErrnoException
            error.code = 'EACCES'
            throw error
          }
          return actual.writeFile(path, data, options)
        },
        cp: async (
          source: string,
          destination: string,
          options?: Parameters<typeof actual.cp>[2],
        ): Promise<void> => {
          // Fail the rollback copy back to the original agent slot.
          if (destination === localPath) {
            const error = new Error(
              'forced rollback restore failure',
            ) as NodeJS.ErrnoException
            error.code = 'EACCES'
            throw error
          }
          return actual.cp(source, destination, options)
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
    ).rejects.toThrow(/stranded in/i)
    expect(
      warnSpy.mock.calls.some(
        ([message]) => message === 'trashService: rollback local copy failed',
      ),
    ).toBe(true)
    const trashEntries = await readdir(__getTrashDirForTests())
    expect(trashEntries).toHaveLength(1)
    const entryDir = join(__getTrashDirForTests(), trashEntries[0]!)
    await expect(
      lstat(join(entryDir, '.manual-recovery')),
    ).resolves.toBeDefined()
    await expect(
      lstat(join(entryDir, 'local-copies', 'claude-code')),
    ).resolves.toBeDefined()
    warnSpy.mockRestore()
  })

  it('reports the reviewed cleanup slot as already missing when it vanished before quarantine', async () => {
    // Arrange
    // No symlink is ever created at slotPath, so the very first lstat throws
    // ENOENT — readReviewedDanglingSymlink must surface a stable ENOENT signal.
    const cursorSkillsDir = join(tempHome, '.cursor', 'skills')
    await mkdir(cursorSkillsDir, { recursive: true })
    const slotPath = join(cursorSkillsDir, 'never-existed-slot')
    const targetPath = join(tempHome, '.agents', 'skills', 'never-existed-slot')
    const { readReviewedDanglingSymlink } = await import('./trashService')

    // Act / Assert
    await expect(
      readReviewedDanglingSymlink({
        linkPath: slotPath as never,
        targetPath: targetPath as never,
        targetChangedMessage: 'target changed',
      }),
    ).rejects.toMatchObject({
      message: 'Reviewed cleanup slot is already missing',
      code: 'ENOENT',
    })
  })

  it('surfaces a permission error when the reviewed cleanup slot cannot be inspected', async () => {
    // Arrange
    // lstat on the reviewed slot fails with EACCES (not a missing-path error),
    // so the failure must propagate with its original code instead of ENOENT.
    const cursorSkillsDir = join(tempHome, '.cursor', 'skills')
    await mkdir(cursorSkillsDir, { recursive: true })
    const slotPath = join(cursorSkillsDir, 'locked-slot')
    await symlink(join(tempHome, 'wherever'), slotPath)
    const targetPath = join(tempHome, '.agents', 'skills', 'locked-slot')
    vi.doMock('node:fs/promises', async () => {
      const actual =
        await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
      return {
        ...actual,
        lstat: async (
          path: string,
          options?: Parameters<typeof actual.lstat>[1],
        ): Promise<Awaited<ReturnType<typeof actual.lstat>>> => {
          if (path === slotPath) {
            const error = new Error(
              'permission denied',
            ) as NodeJS.ErrnoException
            error.code = 'EACCES'
            throw error
          }
          return actual.lstat(path, options)
        },
      }
    })
    const { readReviewedDanglingSymlink } = await import('./trashService')

    // Act / Assert
    await expect(
      readReviewedDanglingSymlink({
        linkPath: slotPath as never,
        targetPath: targetPath as never,
        targetChangedMessage: 'target changed',
      }),
    ).rejects.toMatchObject({ message: 'permission denied', code: 'EACCES' })
  })

  it('reports the cleanup slot as already missing when its symlink target is unreadable as ENOENT', async () => {
    // Arrange
    // lstat sees a symlink, but readlink then races to ENOENT — the slot must be
    // reported as already missing rather than as a stale symlink.
    const cursorSkillsDir = join(tempHome, '.cursor', 'skills')
    await mkdir(cursorSkillsDir, { recursive: true })
    const slotPath = join(cursorSkillsDir, 'readlink-vanished-slot')
    await symlink(join(tempHome, 'somewhere'), slotPath)
    const targetPath = join(
      tempHome,
      '.agents',
      'skills',
      'readlink-vanished-slot',
    )
    vi.doMock('node:fs/promises', async () => {
      const actual =
        await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
      return {
        ...actual,
        readlink: async (
          path: string,
          options?: Parameters<typeof actual.readlink>[1],
        ): Promise<Awaited<ReturnType<typeof actual.readlink>>> => {
          if (path === slotPath) {
            const error = new Error('gone') as NodeJS.ErrnoException
            error.code = 'ENOENT'
            throw error
          }
          return actual.readlink(path, options)
        },
      }
    })
    const { readReviewedDanglingSymlink } = await import('./trashService')

    // Act / Assert
    await expect(
      readReviewedDanglingSymlink({
        linkPath: slotPath as never,
        targetPath: targetPath as never,
        targetChangedMessage: 'target changed',
      }),
    ).rejects.toMatchObject({
      message: 'Reviewed cleanup slot is already missing',
      code: 'ENOENT',
    })
  })

  it('treats an unreadable cleanup symlink as no longer a symlink when readlink fails non-missing', async () => {
    // Arrange
    // lstat sees a symlink, but readlink fails with EACCES — the slot must be
    // rejected as no longer a usable symlink (ESTALE), not propagated as EACCES.
    const cursorSkillsDir = join(tempHome, '.cursor', 'skills')
    await mkdir(cursorSkillsDir, { recursive: true })
    const slotPath = join(cursorSkillsDir, 'readlink-locked-slot')
    await symlink(join(tempHome, 'somewhere'), slotPath)
    const targetPath = join(
      tempHome,
      '.agents',
      'skills',
      'readlink-locked-slot',
    )
    vi.doMock('node:fs/promises', async () => {
      const actual =
        await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
      return {
        ...actual,
        readlink: async (
          path: string,
          options?: Parameters<typeof actual.readlink>[1],
        ): Promise<Awaited<ReturnType<typeof actual.readlink>>> => {
          if (path === slotPath) {
            const error = new Error(
              'permission denied',
            ) as NodeJS.ErrnoException
            error.code = 'EACCES'
            throw error
          }
          return actual.readlink(path, options)
        },
      }
    })
    const { readReviewedDanglingSymlink } = await import('./trashService')

    // Act / Assert
    await expect(
      readReviewedDanglingSymlink({
        linkPath: slotPath as never,
        targetPath: targetPath as never,
        targetChangedMessage: 'target changed',
      }),
    ).rejects.toMatchObject({
      message: 'Reviewed cleanup slot is no longer a symlink',
      code: 'ESTALE',
    })
  })

  it('aborts cleanup when probing the reviewed target fails with a permission error', async () => {
    // Arrange
    // assertReviewedTargetMissing probes the resolved target with access(); a
    // non-missing failure (EACCES) must surface a prefixed probe error.
    const resolvedTarget = join(
      tempHome,
      '.agents',
      'skills',
      'probe-locked-target',
    )
    vi.doMock('node:fs/promises', async () => {
      const actual =
        await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
      return {
        ...actual,
        access: async (
          path: string,
          mode?: Parameters<typeof actual.access>[1],
        ): Promise<void> => {
          if (path === resolvedTarget) {
            const error = new Error(
              'permission denied',
            ) as NodeJS.ErrnoException
            error.code = 'EACCES'
            throw error
          }
          return actual.access(path, mode)
        },
      }
    })
    const { assertReviewedTargetMissing } = await import('./trashService')

    // Act / Assert
    await expect(
      assertReviewedTargetMissing(
        resolvedTarget as never,
        'target exists',
        'cannot verify target',
      ),
    ).rejects.toMatchObject({
      message: 'cannot verify target: permission denied',
      code: 'EACCES',
    })
  })

  it('treats commit as a no-op when the reviewed slot disappears before quarantine rename', async () => {
    // Arrange
    // The slot never exists, so the quarantine rename throws ENOENT and commit
    // resolves without error (nothing left to remove).
    const cursorSkillsDir = join(tempHome, '.cursor', 'skills')
    await mkdir(cursorSkillsDir, { recursive: true })
    const slotPath = join(cursorSkillsDir, 'commit-vanished-slot')
    const targetPath = join(
      tempHome,
      '.agents',
      'skills',
      'commit-vanished-slot',
    )
    const { commitReviewedDanglingSymlink } = await import('./trashService')

    // Act / Assert
    await expect(
      commitReviewedDanglingSymlink({
        linkPath: slotPath as never,
        targetPath: targetPath as never,
        targetChangedMessage: 'target changed',
        targetExistsMessage: 'target exists',
        targetProbePrefix: 'cannot probe target',
      }),
    ).resolves.toBeUndefined()
  })

  it('surfaces a permission error when the quarantine rename fails non-missing during commit', async () => {
    // Arrange
    // The reviewed slot exists, but renaming it into the .cleanup-* quarantine
    // fails with EACCES — commit must surface the original error code.
    const cursorSkillsDir = join(tempHome, '.cursor', 'skills')
    await mkdir(cursorSkillsDir, { recursive: true })
    const slotPath = join(cursorSkillsDir, 'commit-rename-locked')
    await symlink(join(tempHome, 'somewhere'), slotPath)
    const targetPath = join(
      tempHome,
      '.agents',
      'skills',
      'commit-rename-locked',
    )
    vi.doMock('node:fs/promises', async () => {
      const actual =
        await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
      return {
        ...actual,
        rename: async (source: string, destination: string): Promise<void> => {
          if (source === slotPath) {
            const error = new Error(
              'permission denied',
            ) as NodeJS.ErrnoException
            error.code = 'EACCES'
            throw error
          }
          return actual.rename(source, destination)
        },
      }
    })
    const { commitReviewedDanglingSymlink } = await import('./trashService')

    // Act / Assert
    await expect(
      commitReviewedDanglingSymlink({
        linkPath: slotPath as never,
        targetPath: targetPath as never,
        targetChangedMessage: 'target changed',
        targetExistsMessage: 'target exists',
        targetProbePrefix: 'cannot probe target',
      }),
    ).rejects.toMatchObject({ message: 'permission denied', code: 'EACCES' })
  })

  it('reports an already-gone reviewed slot as missing instead of failing the unlink', async () => {
    // Arrange
    // unlinkReviewedDanglingSymlink is asked to remove a slot that never existed;
    // it must classify the situation as 'missing' rather than throwing.
    const cursorSkillsDir = join(tempHome, '.cursor', 'skills')
    await mkdir(cursorSkillsDir, { recursive: true })
    const slotPath = join(cursorSkillsDir, 'unlink-missing-slot')
    const targetPath = join(
      tempHome,
      '.agents',
      'skills',
      'unlink-missing-slot',
    )
    const { unlinkReviewedDanglingSymlink } = await import('./trashService')

    // Act
    const outcome = await unlinkReviewedDanglingSymlink({
      linkPath: slotPath as never,
      targetPath: targetPath as never,
      targetChangedMessage: 'target changed',
      targetExistsMessage: 'target exists',
      targetProbePrefix: 'cannot probe target',
    })

    // Assert
    expect(outcome).toBe('missing')
  })

  it('treats a concurrent folder replacement as no longer a symlink when the final removal raises EINVAL', async () => {
    // Arrange
    // The reviewed dangling symlink's final unlink raises a raw EINVAL (the slot
    // was swapped for a directory), which must be reclassified as a stale slot
    // rather than removed.
    const cursorSkillsDir = join(tempHome, '.cursor', 'skills')
    await mkdir(cursorSkillsDir, { recursive: true })
    const slotName = 'unlink-einval-slot'
    const slotPath = join(cursorSkillsDir, slotName)
    const targetPath = join(tempHome, '.agents', 'skills', slotName)
    // A dangling symlink whose missing target keeps the target-probe satisfied.
    await symlink(targetPath, slotPath)
    // Throw only on the FIRST quarantine unlink (the final removal); the later
    // restore-time unlink must succeed so commit re-throws the RAW EINVAL.
    let firstCleanupUnlinkThrown = false
    vi.doMock('node:fs/promises', async () => {
      const actual =
        await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
      return {
        ...actual,
        unlink: async (path: string): Promise<void> => {
          if (
            !firstCleanupUnlinkThrown &&
            String(path).startsWith(`${slotPath}.cleanup-`)
          ) {
            firstCleanupUnlinkThrown = true
            const error = new Error('is a directory') as NodeJS.ErrnoException
            error.code = 'EINVAL'
            throw error
          }
          return actual.unlink(path)
        },
      }
    })
    const { unlinkReviewedDanglingSymlink } = await import('./trashService')

    // Act / Assert
    await expect(
      unlinkReviewedDanglingSymlink({
        linkPath: slotPath as never,
        targetPath: targetPath as never,
        targetChangedMessage: 'target changed',
        targetExistsMessage: 'target exists',
        targetProbePrefix: 'cannot probe target',
      }),
    ).rejects.toMatchObject({
      message: 'Reviewed cleanup slot is no longer a symlink',
      code: 'ESTALE',
    })
  })

  it('surfaces an unexpected removal error verbatim when the final unlink fails with EACCES', async () => {
    // Arrange
    // The final unlink raises a raw EACCES — not a known concurrent-replacement
    // code — so the original message and code must be surfaced unchanged.
    const cursorSkillsDir = join(tempHome, '.cursor', 'skills')
    await mkdir(cursorSkillsDir, { recursive: true })
    const slotName = 'unlink-eacces-slot'
    const slotPath = join(cursorSkillsDir, slotName)
    const targetPath = join(tempHome, '.agents', 'skills', slotName)
    await symlink(targetPath, slotPath)
    // Throw only on the FIRST quarantine unlink (the final removal); the later
    // restore-time unlink must succeed so commit re-throws the RAW EACCES.
    let firstCleanupUnlinkThrown = false
    vi.doMock('node:fs/promises', async () => {
      const actual =
        await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
      return {
        ...actual,
        unlink: async (path: string): Promise<void> => {
          if (
            !firstCleanupUnlinkThrown &&
            String(path).startsWith(`${slotPath}.cleanup-`)
          ) {
            firstCleanupUnlinkThrown = true
            const error = new Error(
              'permission denied',
            ) as NodeJS.ErrnoException
            error.code = 'EACCES'
            throw error
          }
          return actual.unlink(path)
        },
      }
    })
    const { unlinkReviewedDanglingSymlink } = await import('./trashService')

    // Act / Assert
    await expect(
      unlinkReviewedDanglingSymlink({
        linkPath: slotPath as never,
        targetPath: targetPath as never,
        targetChangedMessage: 'target changed',
        targetExistsMessage: 'target exists',
        targetProbePrefix: 'cannot probe target',
      }),
    ).rejects.toMatchObject({ message: 'permission denied', code: 'EACCES' })
  })

  it('surfaces the probe error when the reviewed slot cannot be re-checked before restoring the moved cleanup entry', async () => {
    // Arrange
    // The quarantined moved entry fails its post-rename revalidation (its target
    // changed), so restore runs; but re-checking the original slot fails with
    // EACCES, which must be surfaced from restoreMovedCleanupCandidate.
    const cursorSkillsDir = join(tempHome, '.cursor', 'skills')
    await mkdir(cursorSkillsDir, { recursive: true })
    const slotName = 'moved-restore-probe-locked'
    const slotPath = join(cursorSkillsDir, slotName)
    const expectedTargetPath = join(tempHome, '.agents', 'skills', slotName)
    const otherTargetPath = join(
      tempHome,
      '.agents',
      'skills',
      'some-other-target',
    )
    // The slot points at a DIFFERENT target than expected, so the moved-entry
    // revalidation throws ESTALE and triggers the restore path.
    await symlink(otherTargetPath, slotPath)
    vi.doMock('node:fs/promises', async () => {
      const actual =
        await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
      return {
        ...actual,
        lstat: async (
          path: string,
          options?: Parameters<typeof actual.lstat>[1],
        ): Promise<Awaited<ReturnType<typeof actual.lstat>>> => {
          // Fail the restore-time re-check of the ORIGINAL slot with EACCES.
          if (path === slotPath) {
            const error = new Error(
              'permission denied',
            ) as NodeJS.ErrnoException
            error.code = 'EACCES'
            throw error
          }
          return actual.lstat(path, options)
        },
      }
    })
    const { commitReviewedDanglingSymlink } = await import('./trashService')

    // Act / Assert
    await expect(
      commitReviewedDanglingSymlink({
        linkPath: slotPath as never,
        targetPath: expectedTargetPath as never,
        targetChangedMessage: 'target changed',
        targetExistsMessage: 'target exists',
        targetProbePrefix: 'cannot probe target',
      }),
    ).rejects.toMatchObject({ code: 'EACCES' })
  })

  it('completes a source-backed delete, skipping an agent symlink that vanishes mid-cascade', async () => {
    // Arrange
    // The cascade sees the symlink, but it races to ENOENT before revalidation;
    // that agent slot is skipped while the source still moves to trash.
    const skillName = 'cascade-symlink-vanished'
    const sourcePath = join(tempHome, '.agents', 'skills', skillName)
    const cursorSkillsDir = join(tempHome, '.cursor', 'skills')
    const linkPath = join(cursorSkillsDir, skillName)
    await mkdir(sourcePath, { recursive: true })
    await writeFile(join(sourcePath, 'SKILL.md'), `# ${skillName}\n`, 'utf-8')
    await mkdir(cursorSkillsDir, { recursive: true })
    await symlink(sourcePath, linkPath)
    const lstatCallsByPath = new Map<string, number>()
    vi.doMock('node:fs/promises', async () => {
      const actual =
        await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
      return {
        ...actual,
        lstat: async (
          path: string,
          options?: Parameters<typeof actual.lstat>[1],
        ): Promise<Awaited<ReturnType<typeof actual.lstat>>> => {
          if (path === linkPath) {
            const count = (lstatCallsByPath.get(path) ?? 0) + 1
            lstatCallsByPath.set(path, count)
            // 1st call = cascade inspection (succeeds); 2nd = revalidation race.
            if (count >= 2) {
              const error = new Error('gone') as NodeJS.ErrnoException
              error.code = 'ENOENT'
              throw error
            }
          }
          return actual.lstat(path, options)
        },
      }
    })
    const { __getTrashDirForTests, moveToTrash } =
      await import('./trashService')

    // Act
    const result = await moveToTrash(
      skillName,
      sourcePath as never,
      await reviewedIdentityForPath(sourcePath),
    )

    // Assert
    expect(result.kind).toBe('tombstoned')
    if (result.kind === 'tombstoned') {
      // The vanished slot is not counted as a removed symlink.
      expect(result.symlinksRemoved).toBe(0)
    }
    await expect(lstat(sourcePath)).rejects.toThrow()
    const trashEntries = await readdir(__getTrashDirForTests())
    expect(trashEntries).toHaveLength(1)
  })

  it('aborts a source-backed delete and re-creates symlinks when an agent slot cannot be inspected during revalidation', async () => {
    // Arrange
    // Revalidation lstat fails with EACCES (not ENOENT/ESTALE), which is fatal:
    // the cascade rolls back and surfaces a "Failed to remove symlinks" error.
    const skillName = 'cascade-revalidate-locked'
    const sourcePath = join(tempHome, '.agents', 'skills', skillName)
    const cursorSkillsDir = join(tempHome, '.cursor', 'skills')
    const linkPath = join(cursorSkillsDir, skillName)
    await mkdir(sourcePath, { recursive: true })
    await writeFile(join(sourcePath, 'SKILL.md'), `# ${skillName}\n`, 'utf-8')
    await mkdir(cursorSkillsDir, { recursive: true })
    await symlink(sourcePath, linkPath)
    const lstatCallsByPath = new Map<string, number>()
    vi.doMock('node:fs/promises', async () => {
      const actual =
        await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
      return {
        ...actual,
        lstat: async (
          path: string,
          options?: Parameters<typeof actual.lstat>[1],
        ): Promise<Awaited<ReturnType<typeof actual.lstat>>> => {
          if (path === linkPath) {
            const count = (lstatCallsByPath.get(path) ?? 0) + 1
            lstatCallsByPath.set(path, count)
            if (count >= 2) {
              const error = new Error(
                'permission denied',
              ) as NodeJS.ErrnoException
              error.code = 'EACCES'
              throw error
            }
          }
          return actual.lstat(path, options)
        },
      }
    })
    const { __getTrashDirForTests, moveToTrash } =
      await import('./trashService')

    // Act / Assert
    await expect(
      moveToTrash(
        skillName,
        sourcePath as never,
        await reviewedIdentityForPath(sourcePath),
      ),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/Failed to remove symlinks/i),
      code: 'EACCES',
    })
    // Source untouched; the trash entry was not created.
    expect((await lstat(sourcePath)).isDirectory()).toBe(true)
    expect(await readdir(__getTrashDirForTests())).toEqual([])
  })

  it('completes a source-backed delete, skipping an agent slot that turned into a non-symlink before revalidation', async () => {
    // Arrange
    // Revalidation reports the slot as no longer a symlink (ESTALE), so it is
    // left for manual review while the source still tombstones.
    const skillName = 'cascade-slot-retyped'
    const sourcePath = join(tempHome, '.agents', 'skills', skillName)
    const cursorSkillsDir = join(tempHome, '.cursor', 'skills')
    const linkPath = join(cursorSkillsDir, skillName)
    await mkdir(sourcePath, { recursive: true })
    await writeFile(join(sourcePath, 'SKILL.md'), `# ${skillName}\n`, 'utf-8')
    await mkdir(cursorSkillsDir, { recursive: true })
    await symlink(sourcePath, linkPath)
    const lstatCallsByPath = new Map<string, number>()
    vi.doMock('node:fs/promises', async () => {
      const actual =
        await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
      return {
        ...actual,
        lstat: async (
          path: string,
          options?: Parameters<typeof actual.lstat>[1],
        ): Promise<Awaited<ReturnType<typeof actual.lstat>>> => {
          const realStats = await actual.lstat(path, options)
          if (path === linkPath) {
            const count = (lstatCallsByPath.get(path) ?? 0) + 1
            lstatCallsByPath.set(path, count)
            // 2nd call (revalidation) sees a non-symlink type.
            if (count >= 2) return makeUntypedStats(realStats)
          }
          return realStats
        },
      }
    })
    const { __getTrashDirForTests, moveToTrash } =
      await import('./trashService')

    // Act
    const result = await moveToTrash(
      skillName,
      sourcePath as never,
      await reviewedIdentityForPath(sourcePath),
    )

    // Assert
    expect(result.kind).toBe('tombstoned')
    if (result.kind === 'tombstoned') {
      expect(result.symlinksRemoved).toBe(0)
    }
    await expect(lstat(sourcePath)).rejects.toThrow()
    expect(await readdir(__getTrashDirForTests())).toHaveLength(1)
  })

  it('completes a source-backed delete, skipping an agent slot whose target reads back as missing', async () => {
    // Arrange
    // Revalidation readlink races to ENOENT, so the slot is treated as missing
    // and skipped while the source still moves to trash.
    const skillName = 'cascade-readlink-missing'
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
        readlink: async (
          path: string,
          options?: Parameters<typeof actual.readlink>[1],
        ): Promise<Awaited<ReturnType<typeof actual.readlink>>> => {
          if (path === linkPath) {
            const error = new Error('gone') as NodeJS.ErrnoException
            error.code = 'ENOENT'
            throw error
          }
          return actual.readlink(path, options)
        },
      }
    })
    const { __getTrashDirForTests, moveToTrash } =
      await import('./trashService')

    // Act
    const result = await moveToTrash(
      skillName,
      sourcePath as never,
      await reviewedIdentityForPath(sourcePath),
    )

    // Assert
    expect(result.kind).toBe('tombstoned')
    if (result.kind === 'tombstoned') {
      expect(result.symlinksRemoved).toBe(0)
    }
    await expect(lstat(sourcePath)).rejects.toThrow()
    expect(await readdir(__getTrashDirForTests())).toHaveLength(1)
  })

  it('completes a source-backed delete, skipping an agent slot whose target is unreadable', async () => {
    // Arrange
    // Revalidation readlink fails with EACCES, classified as a stale slot
    // (ESTALE) and skipped; the source still tombstones.
    const skillName = 'cascade-readlink-locked'
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
        readlink: async (
          path: string,
          options?: Parameters<typeof actual.readlink>[1],
        ): Promise<Awaited<ReturnType<typeof actual.readlink>>> => {
          if (path === linkPath) {
            const error = new Error(
              'permission denied',
            ) as NodeJS.ErrnoException
            error.code = 'EACCES'
            throw error
          }
          return actual.readlink(path, options)
        },
      }
    })
    const { __getTrashDirForTests, moveToTrash } =
      await import('./trashService')

    // Act
    const result = await moveToTrash(
      skillName,
      sourcePath as never,
      await reviewedIdentityForPath(sourcePath),
    )

    // Assert
    expect(result.kind).toBe('tombstoned')
    if (result.kind === 'tombstoned') {
      expect(result.symlinksRemoved).toBe(0)
    }
    await expect(lstat(sourcePath)).rejects.toThrow()
    expect(await readdir(__getTrashDirForTests())).toHaveLength(1)
  })

  it('completes a source-backed delete, skipping an agent slot that vanishes during quarantine rename', async () => {
    // Arrange
    // The quarantine rename races to ENOENT, classified as missing and skipped;
    // the source still moves to trash.
    const skillName = 'cascade-rename-missing'
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
        rename: async (source: string, destination: string): Promise<void> => {
          if (source === linkPath) {
            const error = new Error('gone') as NodeJS.ErrnoException
            error.code = 'ENOENT'
            throw error
          }
          return actual.rename(source, destination)
        },
      }
    })
    const { __getTrashDirForTests, moveToTrash } =
      await import('./trashService')

    // Act
    const result = await moveToTrash(
      skillName,
      sourcePath as never,
      await reviewedIdentityForPath(sourcePath),
    )

    // Assert
    expect(result.kind).toBe('tombstoned')
    if (result.kind === 'tombstoned') {
      expect(result.symlinksRemoved).toBe(0)
    }
    await expect(lstat(sourcePath)).rejects.toThrow()
    expect(await readdir(__getTrashDirForTests())).toHaveLength(1)
  })

  it('aborts a source-backed delete when an agent slot cannot be quarantined due to a permission error', async () => {
    // Arrange
    // The quarantine rename fails with EACCES — fatal — so the cascade rolls
    // back and surfaces a "Failed to remove symlinks" error.
    const skillName = 'cascade-rename-locked'
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
        rename: async (source: string, destination: string): Promise<void> => {
          if (source === linkPath) {
            const error = new Error(
              'permission denied',
            ) as NodeJS.ErrnoException
            error.code = 'EACCES'
            throw error
          }
          return actual.rename(source, destination)
        },
      }
    })
    const { __getTrashDirForTests, moveToTrash } =
      await import('./trashService')

    // Act / Assert
    await expect(
      moveToTrash(
        skillName,
        sourcePath as never,
        await reviewedIdentityForPath(sourcePath),
      ),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/Failed to remove symlinks/i),
      code: 'EACCES',
    })
    expect((await lstat(sourcePath)).isDirectory()).toBe(true)
    expect(await readdir(__getTrashDirForTests())).toEqual([])
  })

  it('completes a source-backed delete, restoring then skipping a slot whose quarantined copy fails revalidation', async () => {
    // Arrange
    // After quarantine the moved copy no longer points at the source (its target
    // changed), so it is restored to the original slot and the slot is skipped as
    // stale; the source still tombstones.
    const skillName = 'cascade-moved-revalidate-fail'
    const sourcePath = join(tempHome, '.agents', 'skills', skillName)
    const cursorSkillsDir = join(tempHome, '.cursor', 'skills')
    const linkPath = join(cursorSkillsDir, skillName)
    const otherTargetPath = join(
      tempHome,
      '.agents',
      'skills',
      'cascade-other-target',
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
        readlink: async (
          path: string,
          options?: Parameters<typeof actual.readlink>[1],
        ): Promise<Awaited<ReturnType<typeof actual.readlink>>> => {
          // The QUARANTINED copy reads back a different target, failing the
          // moved-entry revalidation and triggering restore + re-throw.
          if (String(path).startsWith(`${linkPath}.cleanup-`)) {
            return otherTargetPath
          }
          return actual.readlink(path, options)
        },
      }
    })
    const { __getTrashDirForTests, moveToTrash } =
      await import('./trashService')

    // Act
    const result = await moveToTrash(
      skillName,
      sourcePath as never,
      await reviewedIdentityForPath(sourcePath),
    )

    // Assert
    expect(result.kind).toBe('tombstoned')
    if (result.kind === 'tombstoned') {
      expect(result.symlinksRemoved).toBe(0)
    }
    await expect(lstat(sourcePath)).rejects.toThrow()
    expect(await readdir(__getTrashDirForTests())).toHaveLength(1)
    // The slot was restored, not left in a .cleanup-* quarantine path.
    const cursorEntries = await readdir(cursorSkillsDir)
    expect(
      cursorEntries.filter((entry) => entry.includes('.cleanup-')),
    ).toHaveLength(0)
  })

  it('completes a source-backed delete even when realpath identity checks are unavailable', async () => {
    // Arrange
    // realpath() fails for every path, forcing pathsReferenceSameTarget to fall
    // back to resolve(); the symlink still matches the source and is removed.
    const skillName = 'cascade-realpath-fallback'
    const sourcePath = join(tempHome, '.agents', 'skills', skillName)
    const cursorSkillsDir = join(tempHome, '.cursor', 'skills')
    const linkPath = join(cursorSkillsDir, skillName)
    await mkdir(sourcePath, { recursive: true })
    await writeFile(join(sourcePath, 'SKILL.md'), `# ${skillName}\n`, 'utf-8')
    await mkdir(cursorSkillsDir, { recursive: true })
    // Use an absolute target so resolve() fallback matches the source exactly.
    await symlink(sourcePath, linkPath)
    vi.doMock('node:fs/promises', async () => {
      const actual =
        await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
      return {
        ...actual,
        realpath: async (
          _path: string,
          _options?: Parameters<typeof actual.realpath>[1],
        ): Promise<Awaited<ReturnType<typeof actual.realpath>>> => {
          const error = new Error(
            'realpath unavailable',
          ) as NodeJS.ErrnoException
          error.code = 'EACCES'
          throw error
        },
      }
    })
    const { __getTrashDirForTests, moveToTrash } =
      await import('./trashService')

    // Act
    const result = await moveToTrash(
      skillName,
      sourcePath as never,
      await reviewedIdentityForPath(sourcePath),
    )

    // Assert
    expect(result.kind).toBe('tombstoned')
    if (result.kind === 'tombstoned') {
      expect(result.symlinksRemoved).toBe(1)
    }
    await expect(lstat(linkPath)).rejects.toThrow()
    await expect(lstat(sourcePath)).rejects.toThrow()
    expect(await readdir(__getTrashDirForTests())).toHaveLength(1)
  })

  it('completes a source-backed delete, skipping a same-named agent slot that resolves outside known skill directories', async () => {
    // Arrange
    // A decoy symlink in an agent dir points outside every allowed base, so
    // validatePath rejects it and the cascade skips it; the real source symlink
    // is still removed and the source tombstones.
    const skillName = 'cascade-validatepath-skip'
    const sourcePath = join(tempHome, '.agents', 'skills', skillName)
    const cursorSkillsDir = join(tempHome, '.cursor', 'skills')
    const realLinkPath = join(cursorSkillsDir, skillName)
    const claudeSkillsDir = join(tempHome, '.claude', 'skills')
    const decoyLinkPath = join(claudeSkillsDir, skillName)
    const outsideTarget = join(tempHome, 'outside-skill-dirs')
    await mkdir(sourcePath, { recursive: true })
    await writeFile(join(sourcePath, 'SKILL.md'), `# ${skillName}\n`, 'utf-8')
    await mkdir(outsideTarget, { recursive: true })
    await mkdir(cursorSkillsDir, { recursive: true })
    await symlink(sourcePath, realLinkPath)
    await mkdir(claudeSkillsDir, { recursive: true })
    // Decoy resolves outside SOURCE_DIR and every agent base.
    await symlink(outsideTarget, decoyLinkPath)
    const { __getTrashDirForTests, moveToTrash } =
      await import('./trashService')

    // Act
    const result = await moveToTrash(
      skillName,
      sourcePath as never,
      await reviewedIdentityForPath(sourcePath),
    )

    // Assert
    expect(result.kind).toBe('tombstoned')
    if (result.kind === 'tombstoned') {
      // Only the legitimate source symlink was removed.
      expect(result.symlinksRemoved).toBe(1)
    }
    await expect(lstat(realLinkPath)).rejects.toThrow()
    // The decoy was left untouched.
    expect((await lstat(decoyLinkPath)).isSymbolicLink()).toBe(true)
    await expect(lstat(sourcePath)).rejects.toThrow()
    expect(await readdir(__getTrashDirForTests())).toHaveLength(1)
  })

  it('aborts a source-backed delete when an agent slot cannot be inspected by the cascade', async () => {
    // Arrange
    // The cascade's own lstat of the slot fails with EACCES (non-ENOENT), which
    // is fatal: the delete surfaces a "Failed to inspect symlink" error.
    const skillName = 'cascade-inspect-locked'
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
        lstat: async (
          path: string,
          options?: Parameters<typeof actual.lstat>[1],
        ): Promise<Awaited<ReturnType<typeof actual.lstat>>> => {
          if (path === linkPath) {
            const error = new Error(
              'permission denied',
            ) as NodeJS.ErrnoException
            error.code = 'EACCES'
            throw error
          }
          return actual.lstat(path, options)
        },
      }
    })
    const { __getTrashDirForTests, moveToTrash } =
      await import('./trashService')

    // Act / Assert
    await expect(
      moveToTrash(
        skillName,
        sourcePath as never,
        await reviewedIdentityForPath(sourcePath),
      ),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/Failed to inspect symlink/i),
      code: 'EACCES',
    })
    expect((await lstat(sourcePath)).isDirectory()).toBe(true)
    expect(await readdir(__getTrashDirForTests())).toEqual([])
  })

  it('rolls the source back and drops the entry when the manifest write fails', async () => {
    // Arrange
    // After the source has moved into the trash entry, the manifest write fails;
    // rollback restores the source to its original path and removes the entry.
    const skillName = 'source-manifest-rollback-restored'
    const sourcePath = join(tempHome, '.agents', 'skills', skillName)
    await mkdir(sourcePath, { recursive: true })
    await writeFile(join(sourcePath, 'SKILL.md'), `# ${skillName}\n`, 'utf-8')
    vi.doMock('node:fs/promises', async () => {
      const actual =
        await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
      return {
        ...actual,
        writeFile: async (
          path: string,
          data: Parameters<typeof actual.writeFile>[1],
          options?: Parameters<typeof actual.writeFile>[2],
        ): Promise<void> => {
          if (String(path).endsWith('/manifest.json')) {
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
        sourcePath as never,
        await reviewedIdentityForPath(sourcePath),
      ),
    ).rejects.toThrow(/Failed to write trash manifest/i)
    // Source restored to its original location.
    expect(await readFile(join(sourcePath, 'SKILL.md'), 'utf-8')).toContain(
      skillName,
    )
    // Fully rolled-back entry is dropped.
    expect(await readdir(__getTrashDirForTests())).toEqual([])
  })

  it('permanently removes a source-backed tombstone when its TTL eviction timer fires', async () => {
    // Arrange
    // A successful source-backed delete schedules a TTL evict timer; when it
    // fires, the trash entry is permanently removed.
    vi.useFakeTimers()
    try {
      const skillName = 'source-ttl-evict'
      const sourcePath = join(tempHome, '.agents', 'skills', skillName)
      await mkdir(sourcePath, { recursive: true })
      await writeFile(join(sourcePath, 'SKILL.md'), `# ${skillName}\n`, 'utf-8')
      const reviewedIdentity = await reviewedIdentityForPath(sourcePath)
      const { __getTrashDirForTests, moveToTrash } =
        await import('./trashService')
      await moveToTrash(skillName, sourcePath as never, reviewedIdentity)
      expect(await readdir(__getTrashDirForTests())).toHaveLength(1)

      // Act
      // Fire the TTL timer (its callback dispatches a fire-and-forget evict).
      await vi.runAllTimersAsync()
      // The evict's directory removal runs detached from the timer, so wait for
      // the entry to actually disappear under real time.
      vi.useRealTimers()
      await waitForTrashEntryRemoval(__getTrashDirForTests())

      // Assert
      expect(await readdir(__getTrashDirForTests())).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('permanently removes a local-only tombstone when its TTL eviction timer fires', async () => {
    // Arrange
    // A successful local-only delete schedules a TTL evict timer; firing it
    // permanently removes the staged trash entry.
    vi.useFakeTimers()
    try {
      const skillName = 'local-ttl-evict'
      const claudeSkillsDir = join(tempHome, '.claude', 'skills')
      const localPath = join(claudeSkillsDir, skillName)
      await mkdir(localPath, { recursive: true })
      await writeFile(join(localPath, 'SKILL.md'), `# ${skillName}\n`, 'utf-8')
      const reviewedIdentity = await reviewedIdentityForPath(localPath)
      const { __getTrashDirForTests, moveToTrash } =
        await import('./trashService')
      await moveToTrash(skillName, localPath as never, reviewedIdentity)
      expect(await readdir(__getTrashDirForTests())).toHaveLength(1)

      // Act
      await vi.runAllTimersAsync()
      vi.useRealTimers()
      await waitForTrashEntryRemoval(__getTrashDirForTests())

      // Assert
      expect(await readdir(__getTrashDirForTests())).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('logs and swallows the failure when evicting a trash entry cannot remove its directory', async () => {
    // Arrange
    // evict() must be idempotent and never throw; if the directory removal fails,
    // it logs an error and resolves.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.doMock('node:fs/promises', async () => {
      const actual =
        await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
      return {
        ...actual,
        rm: async (
          path: string,
          options?: Parameters<typeof actual.rm>[1],
        ): Promise<void> => {
          if (String(path).includes('/.agents/.trash/')) {
            const error = new Error(
              'forced rm failure',
            ) as NodeJS.ErrnoException
            error.code = 'EACCES'
            throw error
          }
          return actual.rm(path, options)
        },
      }
    })
    const { evict } = await import('./trashService')

    // Act / Assert
    await expect(
      evict('1700000000000-anything-deadbeef' as never),
    ).resolves.toBeUndefined()
    expect(
      errorSpy.mock.calls.some(
        ([message]) => message === 'trashService: evict failed',
      ),
    ).toBe(true)
    errorSpy.mockRestore()
  })

  it('reports a non-missing failure when the trash entry cannot be stat-checked during restore', async () => {
    // Arrange
    // restore() probes the entry directory with stat(); a non-ENOENT failure
    // (EACCES) must be surfaced verbatim rather than treated as "missing".
    const tombstoneId = '1700000000000-stat-locked-deadbeef'
    const entryDir = join(tempHome, '.agents', '.trash', tombstoneId)
    await mkdir(entryDir, { recursive: true })
    vi.doMock('node:fs/promises', async () => {
      const actual =
        await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
      return {
        ...actual,
        stat: async (
          path: string,
          options?: Parameters<typeof actual.stat>[1],
        ): Promise<Awaited<ReturnType<typeof actual.stat>>> => {
          if (path === entryDir) {
            const error = new Error(
              'permission denied',
            ) as NodeJS.ErrnoException
            error.code = 'EACCES'
            throw error
          }
          return actual.stat(path, options)
        },
      }
    })
    const { restore } = await import('./trashService')

    // Act
    const result = await restore(tombstoneId as never)

    // Assert
    expect(result).toMatchObject({
      outcome: 'error',
      error: { code: 'EACCES' },
    })
  })

  it('rejects restoring a source-backed manifest whose source path escapes the source directory', async () => {
    // Arrange
    // A tampered manifest claims a sourcePath outside SOURCE_DIR; restore must
    // refuse before touching the filesystem.
    const { __getTrashDirForTests, restore } = await import('./trashService')
    const tombstoneId = await buildSourceBackedTrashEntry(
      __getTrashDirForTests(),
      {
        skillName: 'tampered-source-path',
        sourcePath: join(tempHome, 'outside', 'tampered-source-path'),
        symlinks: [],
      },
    )

    // Act
    const result = await restore(tombstoneId as never)

    // Assert
    expect(result).toEqual({
      outcome: 'error',
      error: { message: 'Invalid source path in manifest' },
    })
  })

  it('reports a non-missing failure when the source path cannot be probed during restore', async () => {
    // Arrange
    // The source slot lstat fails with EACCES (not ENOENT), so restore aborts
    // and surfaces the original error code.
    const skillName = 'source-probe-locked'
    const sourcePath = join(tempHome, '.agents', 'skills', skillName)
    let trashDirForMock = ''
    vi.doMock('node:fs/promises', async () => {
      const actual =
        await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
      return {
        ...actual,
        lstat: async (
          path: string,
          options?: Parameters<typeof actual.lstat>[1],
        ): Promise<Awaited<ReturnType<typeof actual.lstat>>> => {
          if (path === sourcePath) {
            const error = new Error(
              'permission denied',
            ) as NodeJS.ErrnoException
            error.code = 'EACCES'
            throw error
          }
          return actual.lstat(path, options)
        },
      }
    })
    const { __getTrashDirForTests, restore } = await import('./trashService')
    trashDirForMock = __getTrashDirForTests()
    const tombstoneId = await buildSourceBackedTrashEntry(trashDirForMock, {
      skillName,
      sourcePath,
      symlinks: [],
    })

    // Act
    const result = await restore(tombstoneId as never)

    // Assert
    expect(result).toMatchObject({
      outcome: 'error',
      error: { code: 'EACCES' },
    })
  })

  it('skips a recorded symlink during restore when its agent parent directory cannot be created', async () => {
    // Arrange
    // mkdir of the agent skills parent fails with EACCES; that link is skipped
    // while the source is still restored.
    const skillName = 'restore-mkdir-fail'
    const sourcePath = join(tempHome, '.agents', 'skills', skillName)
    const claudeSkillsDir = join(tempHome, '.claude', 'skills')
    const linkPath = join(claudeSkillsDir, skillName)
    vi.doMock('node:fs/promises', async () => {
      const actual =
        await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
      return {
        ...actual,
        mkdir: async (
          path: string,
          options?: Parameters<typeof actual.mkdir>[1],
        ): Promise<string | undefined> => {
          if (path === claudeSkillsDir) {
            const error = new Error(
              'permission denied',
            ) as NodeJS.ErrnoException
            error.code = 'EACCES'
            throw error
          }
          return actual.mkdir(path, options)
        },
      }
    })
    const { __getTrashDirForTests, restore } = await import('./trashService')
    const tombstoneId = await buildSourceBackedTrashEntry(
      __getTrashDirForTests(),
      {
        skillName,
        sourcePath,
        symlinks: [{ agentId: 'claude-code', linkPath, target: sourcePath }],
      },
    )

    // Act
    const result = await restore(tombstoneId as never)

    // Assert
    expect(result.outcome).toBe('restored')
    if (result.outcome === 'restored') {
      expect(result.symlinksRestored).toBe(0)
      expect(result.symlinksSkipped).toBe(1)
    }
    // Source restored despite the per-link skip.
    expect((await lstat(sourcePath)).isDirectory()).toBe(true)
  })

  it('skips a recorded symlink during restore when its agent slot cannot be probed', async () => {
    // Arrange
    // The free-slot lstat of linkPath fails with EACCES (non-ENOENT); restore
    // skips that link rather than overwriting an indeterminate slot.
    const skillName = 'restore-linkpath-probe-locked'
    const sourcePath = join(tempHome, '.agents', 'skills', skillName)
    const claudeSkillsDir = join(tempHome, '.claude', 'skills')
    const linkPath = join(claudeSkillsDir, skillName)
    await mkdir(claudeSkillsDir, { recursive: true })
    vi.doMock('node:fs/promises', async () => {
      const actual =
        await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
      return {
        ...actual,
        lstat: async (
          path: string,
          options?: Parameters<typeof actual.lstat>[1],
        ): Promise<Awaited<ReturnType<typeof actual.lstat>>> => {
          if (path === linkPath) {
            const error = new Error(
              'permission denied',
            ) as NodeJS.ErrnoException
            error.code = 'EACCES'
            throw error
          }
          return actual.lstat(path, options)
        },
      }
    })
    const { __getTrashDirForTests, restore } = await import('./trashService')
    const tombstoneId = await buildSourceBackedTrashEntry(
      __getTrashDirForTests(),
      {
        skillName,
        sourcePath,
        symlinks: [{ agentId: 'claude-code', linkPath, target: sourcePath }],
      },
    )

    // Act
    const result = await restore(tombstoneId as never)

    // Assert
    expect(result.outcome).toBe('restored')
    if (result.outcome === 'restored') {
      expect(result.symlinksRestored).toBe(0)
      expect(result.symlinksSkipped).toBe(1)
    }
    expect((await lstat(sourcePath)).isDirectory()).toBe(true)
  })

  it('skips a recorded symlink during restore when creating the symlink fails', async () => {
    // Arrange
    // Everything validates but the final symlink() fails with EACCES; that link
    // is counted as skipped while the source is still restored.
    const skillName = 'restore-symlink-fail'
    const sourcePath = join(tempHome, '.agents', 'skills', skillName)
    const claudeSkillsDir = join(tempHome, '.claude', 'skills')
    const linkPath = join(claudeSkillsDir, skillName)
    await mkdir(claudeSkillsDir, { recursive: true })
    vi.doMock('node:fs/promises', async () => {
      const actual =
        await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
      return {
        ...actual,
        symlink: async (
          target: string,
          path: string,
          type?: Parameters<typeof actual.symlink>[2],
        ): Promise<void> => {
          if (path === linkPath) {
            const error = new Error(
              'permission denied',
            ) as NodeJS.ErrnoException
            error.code = 'EACCES'
            throw error
          }
          return actual.symlink(target, path, type)
        },
      }
    })
    const { __getTrashDirForTests, restore } = await import('./trashService')
    const tombstoneId = await buildSourceBackedTrashEntry(
      __getTrashDirForTests(),
      {
        skillName,
        sourcePath,
        symlinks: [{ agentId: 'claude-code', linkPath, target: sourcePath }],
      },
    )

    // Act
    const result = await restore(tombstoneId as never)

    // Assert
    expect(result.outcome).toBe('restored')
    if (result.outcome === 'restored') {
      expect(result.symlinksRestored).toBe(0)
      expect(result.symlinksSkipped).toBe(1)
    }
    expect((await lstat(sourcePath)).isDirectory()).toBe(true)
    await expect(lstat(linkPath)).rejects.toThrow()
  })

  it('skips a local-only copy during restore when its agent slot cannot be probed', async () => {
    // Arrange
    // The free-slot lstat of a local copy fails with EACCES (non-ENOENT), so the
    // staged folder is skipped and kept for manual recovery.
    const skillName = 'restore-local-probe-locked'
    const claudeSkillsDir = join(tempHome, '.claude', 'skills')
    const linkPath = join(claudeSkillsDir, skillName)
    await mkdir(claudeSkillsDir, { recursive: true })
    vi.doMock('node:fs/promises', async () => {
      const actual =
        await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
      return {
        ...actual,
        lstat: async (
          path: string,
          options?: Parameters<typeof actual.lstat>[1],
        ): Promise<Awaited<ReturnType<typeof actual.lstat>>> => {
          if (path === linkPath) {
            const error = new Error(
              'permission denied',
            ) as NodeJS.ErrnoException
            error.code = 'EACCES'
            throw error
          }
          return actual.lstat(path, options)
        },
      }
    })
    const { __getTrashDirForTests, restore } = await import('./trashService')
    const trashDir = __getTrashDirForTests()
    const tombstoneId = `${Date.now()}-${skillName}-feedface`
    const entryDir = join(trashDir, tombstoneId)
    const stagedPath = join(entryDir, 'local-copies', 'claude-code')
    await mkdir(stagedPath, { recursive: true })
    await writeFile(join(stagedPath, 'SKILL.md'), `# ${skillName}\n`, 'utf-8')
    await writeFile(
      join(entryDir, 'manifest.json'),
      JSON.stringify({
        schemaVersion: 2,
        kind: 'local-only',
        deletedAt: Date.now(),
        skillName,
        localCopies: [{ agentId: 'claude-code', linkPath }],
      }),
      'utf-8',
    )

    // Act
    const result = await restore(tombstoneId as never)

    // Assert
    expect(result.outcome).toBe('restored')
    if (result.outcome === 'restored') {
      expect(result.symlinksRestored).toBe(0)
      expect(result.symlinksSkipped).toBe(1)
    }
    // Staged copy preserved for manual recovery.
    await expect(
      lstat(join(entryDir, 'local-copies', 'claude-code')),
    ).resolves.toBeDefined()
  })

  it('completes a cross-device local-only delete by copying the staged folder into trash', async () => {
    // Arrange
    // The direct rename returns EXDEV, forcing the sibling-stage + copy + remove
    // fallback; the delete still succeeds and the source folder is gone.
    const skillName = 'local-exdev-success'
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
          // Only the cross-volume move into the trash entry returns EXDEV; the
          // in-dir sibling rename must still succeed for the fallback to work.
          if (oldPath === localPath && newPath.includes('/.agents/.trash/')) {
            const error = new Error(
              'forced cross-device local move',
            ) as NodeJS.ErrnoException
            error.code = 'EXDEV'
            throw error
          }
          return actual.rename(oldPath, newPath)
        },
      }
    })
    const { __getTrashDirForTests, moveToTrash } =
      await import('./trashService')

    // Act
    const result = await moveToTrash(
      skillName,
      localPath as never,
      await reviewedIdentityForPath(localPath),
    )

    // Assert
    expect(result.kind).toBe('tombstoned')
    if (result.kind === 'tombstoned') {
      expect(result.symlinksRemoved).toBe(1)
    }
    // Original folder is gone; staged copy lives in trash.
    await expect(lstat(localPath)).rejects.toThrow()
    const trashEntries = await readdir(__getTrashDirForTests())
    expect(trashEntries).toHaveLength(1)
    const entryDir = join(__getTrashDirForTests(), trashEntries[0]!)
    await expect(
      lstat(join(entryDir, 'local-copies', 'claude-code')),
    ).resolves.toBeDefined()
  })

  it('restores the original folder when a cross-device staged copy fails its identity recheck', async () => {
    // Arrange
    // The EXDEV sibling rename succeeds, but the staged copy fails the identity
    // recheck (mocked as a symlink), so it is moved back and the delete aborts.
    const skillName = 'local-exdev-identity-fail'
    const claudeSkillsDir = join(tempHome, '.claude', 'skills')
    const localPath = join(claudeSkillsDir, skillName)
    await mkdir(localPath, { recursive: true })
    await writeFile(join(localPath, 'SKILL.md'), `# ${skillName}\n`, 'utf-8')
    const siblingStageMarker = `.${skillName}.trash-local-claude-code-`
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
        lstat: async (
          path: string,
          options?: Parameters<typeof actual.lstat>[1],
        ): Promise<Awaited<ReturnType<typeof actual.lstat>>> => {
          const realStats = await actual.lstat(path, options)
          // Make the staged sibling fail its identity recheck (rejects symlinks).
          if (path.includes(siblingStageMarker)) {
            return makeSymlinkStats(realStats)
          }
          return realStats
        },
      }
    })
    const { __getTrashDirForTests, moveToTrash } =
      await import('./trashService')

    // Act / Assert
    await expect(
      moveToTrash(
        skillName,
        localPath as never,
        await reviewedIdentityForPath(localPath),
      ),
    ).rejects.toMatchObject({ code: 'ESTALE' })
    // Original folder restored to its agent slot.
    expect((await lstat(localPath)).isDirectory()).toBe(true)
    expect(await readFile(join(localPath, 'SKILL.md'), 'utf-8')).toContain(
      skillName,
    )
    // Fully rolled-back entry is dropped.
    expect(await readdir(__getTrashDirForTests())).toEqual([])
  })

  it('aborts a local-only delete and drops the entry when an agent folder rename fails hard', async () => {
    // Arrange
    // A non-EXDEV, non-ENOENT rename failure (EACCES) is fatal for the single
    // copy; rollback restores nothing-was-moved and the entry is dropped.
    const skillName = 'local-rename-fatal'
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
              'forced fatal local move',
            ) as NodeJS.ErrnoException
            error.code = 'EACCES'
            throw error
          }
          return actual.rename(oldPath, newPath)
        },
      }
    })
    const { __getTrashDirForTests, moveToTrash } =
      await import('./trashService')

    // Act / Assert
    await expect(
      moveToTrash(
        skillName,
        localPath as never,
        await reviewedIdentityForPath(localPath),
      ),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/Failed to move local copy/i),
      code: 'EACCES',
    })
    // Original folder is untouched; the entry was dropped.
    expect((await lstat(localPath)).isDirectory()).toBe(true)
    expect(await readdir(__getTrashDirForTests())).toEqual([])
  })

  it('strands a staged local copy for manual recovery when an identity-recheck failure cannot be rolled back', async () => {
    // Arrange
    // The copy stages successfully, then fails its identity recheck (fatal); the
    // rollback that would restore it also fails, so the staged folder is the only
    // surviving copy — the entry is preserved, marked for recovery, and the error
    // names the stranded agent.
    const skillName = 'local-identity-fatal-stranded'
    const claudeSkillsDir = join(tempHome, '.claude', 'skills')
    const localPath = join(claudeSkillsDir, skillName)
    await mkdir(localPath, { recursive: true })
    await writeFile(join(localPath, 'SKILL.md'), `# ${skillName}\n`, 'utf-8')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.doMock('node:fs/promises', async () => {
      const actual =
        await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
      return {
        ...actual,
        lstat: async (
          path: string,
          options?: Parameters<typeof actual.lstat>[1],
        ): Promise<Awaited<ReturnType<typeof actual.lstat>>> => {
          const realStats = await actual.lstat(path, options)
          // The staged copy fails its identity recheck (rejects symlinks).
          if (path.includes('/local-copies/claude-code')) {
            return makeSymlinkStats(realStats)
          }
          return realStats
        },
        cp: async (
          source: string,
          destination: string,
          options?: Parameters<typeof actual.cp>[2],
        ): Promise<void> => {
          // Fail the rollback copy back to the original agent slot.
          if (destination === localPath) {
            const error = new Error(
              'forced rollback restore failure',
            ) as NodeJS.ErrnoException
            error.code = 'EACCES'
            throw error
          }
          return actual.cp(source, destination, options)
        },
      }
    })
    const { __getTrashDirForTests, moveToTrash } =
      await import('./trashService')

    // Act / Assert
    await expect(
      moveToTrash(
        skillName,
        localPath as never,
        await reviewedIdentityForPath(localPath),
      ),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/stranded in/i),
      code: 'ESTALE',
    })
    // The staged copy is preserved under a manual-recovery entry.
    const trashEntries = await readdir(__getTrashDirForTests())
    expect(trashEntries).toHaveLength(1)
    const entryDir = join(__getTrashDirForTests(), trashEntries[0]!)
    await expect(
      lstat(join(entryDir, '.manual-recovery')),
    ).resolves.toBeDefined()
    await expect(
      lstat(join(entryDir, 'local-copies', 'claude-code')),
    ).resolves.toBeDefined()
    // The original agent slot could not be restored.
    await expect(lstat(localPath)).rejects.toThrow()
    warnSpy.mockRestore()
  })

  it('reports "already deleted" for a local-only delete when the only agent folder races away', async () => {
    // Arrange
    // The single copy disappears (ENOENT) during the rename; with nothing moved,
    // the delete reports the skill as already deleted and drops the entry.
    const skillName = 'local-all-raced'
    const claudeSkillsDir = join(tempHome, '.claude', 'skills')
    const localPath = join(claudeSkillsDir, skillName)
    await mkdir(localPath, { recursive: true })
    await writeFile(join(localPath, 'SKILL.md'), `# ${skillName}\n`, 'utf-8')
    const reviewedIdentity = await reviewedIdentityForPath(localPath)
    vi.doMock('node:fs/promises', async () => {
      const actual =
        await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
      return {
        ...actual,
        rename: async (oldPath: string, newPath: string): Promise<void> => {
          if (oldPath === localPath && newPath.includes('/.agents/.trash/')) {
            const error = new Error('raced away') as NodeJS.ErrnoException
            error.code = 'ENOENT'
            throw error
          }
          return actual.rename(oldPath, newPath)
        },
      }
    })
    const { __getTrashDirForTests, moveToTrash } =
      await import('./trashService')

    // Act / Assert
    await expect(
      moveToTrash(skillName, localPath as never, reviewedIdentity),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/already deleted/i),
      code: 'ENOENT',
    })
    expect(await readdir(__getTrashDirForTests())).toEqual([])
  })

  it('ignores a foreign trash entry name on startup but still sweeps an old well-formed entry', async () => {
    // Arrange
    // startupCleanup must leave un-parseable names alone (no leading dash, and a
    // non-numeric prefix) while removing an aged, properly-named entry.
    const { __getTrashDirForTests, startupCleanup } =
      await import('./trashService')
    const trashDir = __getTrashDirForTests()
    await mkdir(trashDir, { recursive: true })
    const foreignNoDash = join(trashDir, 'foreignfile')
    const foreignNonNumeric = join(trashDir, 'abc-not-a-timestamp')
    const oldEntry = join(trashDir, '1-old-skill-deadbeef')
    await mkdir(foreignNoDash, { recursive: true })
    await mkdir(foreignNonNumeric, { recursive: true })
    await mkdir(oldEntry, { recursive: true })

    // Act
    await startupCleanup()

    // Assert
    // Foreign names survive; the aged well-formed entry is swept.
    await expect(lstat(foreignNoDash)).resolves.toBeDefined()
    await expect(lstat(foreignNonNumeric)).resolves.toBeDefined()
    await expect(lstat(oldEntry)).rejects.toThrow()
  })

  it('does nothing on startup when the trash directory has never been created', async () => {
    // Arrange
    // On a fresh install TRASH_DIR does not exist; startupCleanup must return
    // quietly without error.
    const { startupCleanup } = await import('./trashService')

    // Act / Assert
    await expect(startupCleanup()).resolves.toBeUndefined()
  })

  it('logs and returns on startup when the trash directory cannot be read', async () => {
    // Arrange
    // readdir of TRASH_DIR fails with a non-ENOENT error (EACCES); startupCleanup
    // logs and returns rather than throwing.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.doMock('node:fs/promises', async () => {
      const actual =
        await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
      // startupCleanup calls fs.readdir(TRASH_DIR) with no options, so only the
      // plain string[] overload needs to be honored here.
      const readdir = async (
        path: Parameters<typeof actual.readdir>[0],
      ): Promise<string[]> => {
        if (String(path).includes('/.agents/.trash')) {
          const error = new Error('permission denied') as NodeJS.ErrnoException
          error.code = 'EACCES'
          throw error
        }
        return actual.readdir(path)
      }
      return {
        ...actual,
        readdir,
      }
    })
    const { startupCleanup } = await import('./trashService')

    // Act / Assert
    await expect(startupCleanup()).resolves.toBeUndefined()
    expect(
      errorSpy.mock.calls.some(
        ([message]) =>
          message === 'trashService: startupCleanup failed to read TRASH_DIR',
      ),
    ).toBe(true)
    errorSpy.mockRestore()
  })

  it('logs and continues on startup when an old entry cannot be removed', async () => {
    // Arrange
    // The per-entry rm of an aged entry fails; startupCleanup must log a warning
    // and not throw, leaving the entry behind.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const oldEntryName = '1-old-unremovable-deadbeef'
    vi.doMock('node:fs/promises', async () => {
      const actual =
        await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
      return {
        ...actual,
        rm: async (
          path: string,
          options?: Parameters<typeof actual.rm>[1],
        ): Promise<void> => {
          if (String(path).endsWith(oldEntryName)) {
            const error = new Error(
              'forced rm failure',
            ) as NodeJS.ErrnoException
            error.code = 'EACCES'
            throw error
          }
          return actual.rm(path, options)
        },
      }
    })
    const { __getTrashDirForTests, startupCleanup } =
      await import('./trashService')
    const trashDir = __getTrashDirForTests()
    await mkdir(join(trashDir, oldEntryName), { recursive: true })

    // Act
    await startupCleanup()

    // Assert
    expect(
      warnSpy.mock.calls.some(
        ([message]) => message === 'trashService: startupCleanup entry skipped',
      ),
    ).toBe(true)
    warnSpy.mockRestore()
  })

  it('reports an inspect failure when revalidating the reviewed folder hits a non-ENOENT error', async () => {
    // Arrange
    // assertReviewedSkillDirectory lstat()s the reviewed path before deleting.
    // A non-ENOENT lstat failure (EACCES, e.g. parent perms changed) must surface
    // as an "inspect" error, distinct from the "not found" message ENOENT yields.
    const skillName = 'reviewed-inspect-eacces'
    const sourcePath = join(tempHome, '.agents', 'skills', skillName)
    await mkdir(sourcePath, { recursive: true })
    await writeFile(join(sourcePath, 'SKILL.md'), `# ${skillName}\n`, 'utf-8')
    const reviewedIdentity = await reviewedIdentityForPath(sourcePath)
    vi.doMock('node:fs/promises', async () => {
      const actual =
        await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
      return {
        ...actual,
        lstat: async (
          path: string,
          options?: Parameters<typeof actual.lstat>[1],
        ): Promise<Awaited<ReturnType<typeof actual.lstat>>> => {
          // Only the reviewed-folder revalidation lstat fails; everything else is real.
          if (path === sourcePath) {
            const error = new Error(
              'forced reviewed inspect failure',
            ) as NodeJS.ErrnoException
            error.code = 'EACCES'
            throw error
          }
          return actual.lstat(path, options)
        },
      }
    })
    const { moveToTrash } = await import('./trashService')

    // Act / Assert
    await expect(
      moveToTrash(skillName, sourcePath, reviewedIdentity),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/Failed to inspect reviewed skill folder/),
      code: 'EACCES',
    })
    // The reviewed source is left untouched because the move never started.
    expect((await lstat(sourcePath)).isDirectory()).toBe(true)
  })

  it('wraps a non-TrashError staged-source validation failure into a TrashError', async () => {
    // Arrange
    // After the same-device rename into the trash entry, the staged-source identity
    // recheck lstat()s `<entry>/source`. When that lstat throws a raw fs error
    // (not already a TrashError), coerceTrashError must wrap it, preserving its code
    // and prefixing the message — proving the non-TrashError arm of the wrapper.
    const skillName = 'staged-source-wrap-eacces'
    const sourcePath = join(tempHome, '.agents', 'skills', skillName)
    await mkdir(sourcePath, { recursive: true })
    await writeFile(join(sourcePath, 'SKILL.md'), `# ${skillName}\n`, 'utf-8')
    vi.doMock('node:fs/promises', async () => {
      const actual =
        await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
      return {
        ...actual,
        lstat: async (
          path: string,
          options?: Parameters<typeof actual.lstat>[1],
        ): Promise<Awaited<ReturnType<typeof actual.lstat>>> => {
          // Fail the staged-source identity recheck with a raw (non-TrashError) error.
          if (path.includes('/.agents/.trash/') && path.endsWith('/source')) {
            const error = new Error(
              'forced staged-source inspect failure',
            ) as NodeJS.ErrnoException
            error.code = 'EACCES'
            throw error
          }
          return actual.lstat(path, options)
        },
      }
    })
    const { moveToTrash } = await import('./trashService')

    // Act / Assert
    await expect(
      moveToTrash(
        skillName,
        sourcePath,
        await reviewedIdentityForPath(sourcePath),
      ),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/^Failed to validate staged source: /),
      code: 'EACCES',
    })
  })

  it('reports a cross-device source failure with no preserved-copy hint when the sibling is already gone', async () => {
    // Arrange
    // EXDEV forces the sibling-stage + copy fallback. The copy into the trash entry
    // fails (so no recovery copy was created), and by the time the catch tries to
    // restore the sibling it is already gone (ENOENT) — so the original cannot be
    // brought back. The surfaced error must NOT claim a preserved copy.
    const skillName = 'source-exdev-sibling-gone'
    const sourcePath = join(tempHome, '.agents', 'skills', skillName)
    await mkdir(sourcePath, { recursive: true })
    await writeFile(join(sourcePath, 'SKILL.md'), `# ${skillName}\n`, 'utf-8')
    const siblingStageMarker = `.${skillName}.trash-source-`
    let siblingLstatCalls = 0
    vi.doMock('node:fs/promises', async () => {
      const actual =
        await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
      return {
        ...actual,
        rename: async (oldPath: string, newPath: string): Promise<void> => {
          // Force the cross-device path on the move into the trash entry.
          if (oldPath === sourcePath && newPath.includes('/.agents/.trash/')) {
            const error = new Error(
              'forced cross-device source move',
            ) as NodeJS.ErrnoException
            error.code = 'EXDEV'
            throw error
          }
          return actual.rename(oldPath, newPath)
        },
        lstat: async (
          path: string,
          options?: Parameters<typeof actual.lstat>[1],
        ): Promise<Awaited<ReturnType<typeof actual.lstat>>> => {
          if (path.includes(siblingStageMarker)) {
            siblingLstatCalls += 1
            // 1st lstat = identity recheck (must pass); 2nd = restore probe → ENOENT.
            if (siblingLstatCalls >= 2) {
              const error = new Error(
                'sibling already gone',
              ) as NodeJS.ErrnoException
              error.code = 'ENOENT'
              throw error
            }
          }
          return actual.lstat(path, options)
        },
        cp: async (
          source: string,
          destination: string,
          options?: Parameters<typeof actual.cp>[2],
        ): Promise<void> => {
          // Fail the copy of the sibling into the trash entry's source dir.
          if (
            source.includes(siblingStageMarker) &&
            destination.includes('/.agents/.trash/')
          ) {
            const error = new Error(
              'forced cross-device copy failure',
            ) as NodeJS.ErrnoException
            error.code = 'EACCES'
            throw error
          }
          return actual.cp(source, destination, options)
        },
      }
    })
    const { __getTrashDirForTests, moveToTrash } =
      await import('./trashService')

    // Act
    let surfacedError: unknown
    try {
      await moveToTrash(
        skillName,
        sourcePath,
        await reviewedIdentityForPath(sourcePath),
      )
    } catch (error) {
      surfacedError = error
    }

    // Assert
    expect((surfacedError as Error).message).toMatch(
      /Failed to move source to trash \(cross-device\)/,
    )
    expect((surfacedError as Error).message).not.toMatch(
      /source copy preserved/,
    )
    // No recovery copy → the trash entry is dropped, not preserved.
    expect(await readdir(__getTrashDirForTests())).toEqual([])
    // Unrecoverable branch: the sibling-stage rename moved the source out and the
    // ENOENT restore probe leaves nothing to bring back, so the original is gone
    // from its path — exactly why the error honestly omits a preserved-copy hint.
    expect(existsSync(sourcePath)).toBe(false)
  })

  it('reports a local cross-device failure with no staged-copy hint when the sibling is already gone', async () => {
    // Arrange
    // Local-only mirror of the source case: EXDEV forces the sibling-stage + copy
    // fallback for an agent-local copy. The copy fails (no staged copy created) and
    // the sibling restore probe finds it already gone (ENOENT). The surfaced fatal
    // error must NOT claim a staged copy was preserved.
    const skillName = 'local-exdev-sibling-gone'
    const claudeSkillsDir = join(tempHome, '.claude', 'skills')
    const localPath = join(claudeSkillsDir, skillName)
    await mkdir(localPath, { recursive: true })
    await writeFile(join(localPath, 'SKILL.md'), `# ${skillName}\n`, 'utf-8')
    const siblingStageMarker = `.${skillName}.trash-local-claude-code-`
    let siblingLstatCalls = 0
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
        lstat: async (
          path: string,
          options?: Parameters<typeof actual.lstat>[1],
        ): Promise<Awaited<ReturnType<typeof actual.lstat>>> => {
          if (path.includes(siblingStageMarker)) {
            siblingLstatCalls += 1
            // 1st lstat = identity recheck (must pass); 2nd = restore probe → ENOENT.
            if (siblingLstatCalls >= 2) {
              const error = new Error(
                'sibling already gone',
              ) as NodeJS.ErrnoException
              error.code = 'ENOENT'
              throw error
            }
          }
          return actual.lstat(path, options)
        },
        cp: async (
          source: string,
          destination: string,
          options?: Parameters<typeof actual.cp>[2],
        ): Promise<void> => {
          if (
            source.includes(siblingStageMarker) &&
            destination.includes('/.agents/.trash/')
          ) {
            const error = new Error(
              'forced cross-device copy failure',
            ) as NodeJS.ErrnoException
            error.code = 'EACCES'
            throw error
          }
          return actual.cp(source, destination, options)
        },
      }
    })
    const { moveToTrash } = await import('./trashService')

    // Act
    let surfacedError: unknown
    try {
      await moveToTrash(
        skillName,
        localPath,
        await reviewedIdentityForPath(localPath),
      )
    } catch (error) {
      surfacedError = error
    }

    // Assert
    expect((surfacedError as Error).message).toMatch(
      /Failed to move local copy \(cross-device, agent=claude-code\)/,
    )
    expect((surfacedError as Error).message).not.toMatch(
      /staged copy preserved/,
    )
    // Unrecoverable branch: the local copy was staged out and the ENOENT restore
    // probe leaves nothing to bring back, so it is gone from its original path —
    // exactly why the error honestly omits a staged-copy hint.
    expect(existsSync(localPath)).toBe(false)
  })
})
