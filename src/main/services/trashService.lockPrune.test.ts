import { mkdtempSync, realpathSync } from 'node:fs'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeEach, describe, expect, test, vi } from 'vitest'

import { tombstoneId } from '@/shared/types'

// Stamped synchronously at module load — `main/constants` derives TRASH_DIR
// from homedir() the moment it is imported.
const sharedHome = realpathSync(mkdtempSync(join(tmpdir(), 'skills-prune-it-')))
const sourceDir = join(sharedHome, '.agents', 'skills')
const trashDir = join(sharedHome, '.agents', '.trash')

vi.mock('node:os', async () => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await vi.importActual<typeof import('node:os')>('node:os')
  return { ...actual, homedir: () => sharedHome }
})

vi.mock('os', async () => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await vi.importActual<typeof import('os')>('os')
  return { ...actual, homedir: () => sharedHome }
})

// The lock service is exercised in its own suite; here we only care that the
// trash service hands it the right key at the right moment.
const { queuePruneMock, resolveLockKeyMock } = vi.hoisted(() => ({
  queuePruneMock: vi.fn<(name: string) => void>(),
  resolveLockKeyMock: vi.fn<(dirName: string) => Promise<string | null>>(),
}))

vi.mock('./skillLockService', () => ({
  queuePrune: (name: string) => queuePruneMock(name),
  resolveLockKeyForDirectory: async (dirName: string) =>
    resolveLockKeyMock(dirName),
}))

const trashServiceModule = import('./trashService')

/**
 * Stage a tombstone directory with the manifest a real delete would have left.
 * @param entryName - Trash entry basename (`<unix_ms>-<name>-<rand8hex>`).
 * @param manifest - Manifest body to serialize, or a raw string for corruption.
 * @returns Absolute path to the staged entry directory.
 * @example await stageTombstone('1700000000000-task-aaaaaaaa', { ... })
 */
async function stageTombstone(
  entryName: string,
  manifest: object | string | null,
): Promise<string> {
  const entryDir = join(trashDir, entryName)
  await mkdir(entryDir, { recursive: true })
  if (manifest !== null) {
    await writeFile(
      join(entryDir, 'manifest.json'),
      typeof manifest === 'string' ? manifest : JSON.stringify(manifest),
      'utf-8',
    )
  }
  return entryDir
}

/**
 * Manifest for a skill that lived in the universal source dir.
 * `skillName` deliberately differs from the directory: it is the display name
 * out of SKILL.md frontmatter, and the two are not required to match.
 */
function sourceBackedManifest(dirName: string): object {
  return {
    schemaVersion: 2,
    kind: 'source-backed',
    deletedAt: 1700000000000,
    skillName: 'Frontmatter Display Name',
    sourcePath: join(sourceDir, dirName),
    symlinks: [],
  }
}

beforeEach(async () => {
  await rm(trashDir, { recursive: true, force: true })
  await mkdir(trashDir, { recursive: true })
  queuePruneMock.mockReset()
  resolveLockKeyMock.mockReset()
  resolveLockKeyMock.mockResolvedValue(null)
})

describe('evict lock-prune hook', () => {
  test('queues the lock key resolved from the source directory, not the display name', async () => {
    // Arrange
    // The manifest carries the SKILL.md frontmatter name. Sending that to
    // `skills remove` would no-op, because the lock is keyed by install name.
    const { evict } = await trashServiceModule
    const entryName = '1700000000000-task-aaaaaaaa'
    await stageTombstone(entryName, sourceBackedManifest('ce-review'))
    resolveLockKeyMock.mockResolvedValue('CE:Review')

    // Act
    await evict(tombstoneId(entryName))

    // Assert
    expect(resolveLockKeyMock).toHaveBeenCalledWith('ce-review')
    expect(queuePruneMock).toHaveBeenCalledWith('CE:Review')
  })

  test('queues nothing for a local-only tombstone', async () => {
    // Arrange
    // A local-only skill never lived in ~/.agents/skills, so the CLI never
    // tracked it and there is no lock record to remove.
    const { evict } = await trashServiceModule
    const entryName = '1700000000000-local-bbbbbbbb'
    await stageTombstone(entryName, {
      schemaVersion: 2,
      kind: 'local-only',
      deletedAt: 1700000000000,
      skillName: 'local-skill',
      localCopies: [
        { agentId: 'claude', linkPath: join(sharedHome, '.claude', 'skills') },
      ],
    })

    // Act
    await evict(tombstoneId(entryName))

    // Assert
    expect(queuePruneMock).not.toHaveBeenCalled()
  })

  test('still removes the entry and queues nothing when the manifest is corrupt', async () => {
    // Arrange
    const { evict } = await trashServiceModule
    const entryName = '1700000000000-corrupt-cccccccc'
    const entryDir = await stageTombstone(entryName, '{ not json at all')

    // Act
    await evict(tombstoneId(entryName))

    // Assert
    await expect(stat(entryDir)).rejects.toThrow()
    expect(queuePruneMock).not.toHaveBeenCalled()
  })

  test('does not queue a prune when the entry could not be removed', async () => {
    // Arrange
    // The tombstone survives, so restore is still possible. Pruning its record
    // now would strand a skill the user can still bring back.
    const entryName = '1700000000000-stuck-dddddddd'
    await stageTombstone(entryName, sourceBackedManifest('stuck'))
    resolveLockKeyMock.mockResolvedValue('stuck')
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.resetModules()
    vi.doMock('node:fs/promises', async () => {
      const actual =
        // eslint-disable-next-line @typescript-eslint/consistent-type-imports
        await vi.importActual<typeof import('node:fs/promises')>(
          'node:fs/promises',
        )
      return {
        ...actual,
        rm: async (
          path: string,
          options?: Parameters<typeof actual.rm>[1],
        ): Promise<void> => {
          if (String(path).endsWith(entryName)) {
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

    // Act
    await evict(tombstoneId(entryName))

    // Assert
    try {
      expect(queuePruneMock).not.toHaveBeenCalled()
    } finally {
      // Unconditional: a failed assertion used to skip these, leaking the
      // node:fs/promises mock into every test that ran after this one.
      vi.doUnmock('node:fs/promises')
      vi.resetModules()
      errorSpy.mockRestore()
    }
  })
})

describe('startupCleanup lock-prune hook', () => {
  test('queues a prune for a tombstone deleted seconds ago, because no restore UI survives a restart', async () => {
    // Arrange
    // The undo toast is session state. Holding a fresh tombstone for 24h only
    // kept its lock record alive, so `skills -g update` reinstalled the skill.
    const { startupCleanup } = await trashServiceModule
    const justNow = Date.now()
    const entryName = `${justNow}-fresh-eeeeeeee`
    const entryDir = await stageTombstone(
      entryName,
      sourceBackedManifest('fresh'),
    )
    resolveLockKeyMock.mockResolvedValue('fresh')

    // Act
    await startupCleanup()

    // Assert
    await expect(stat(entryDir)).rejects.toThrow()
    expect(queuePruneMock).toHaveBeenCalledWith('fresh')
  })

  test('restoring inside the undo window leaves the lock record alone', async () => {
    // Arrange
    // Undo is the whole reason eviction (not deletion) owns the prune. If
    // restore queued one too, the skill would come back untracked and
    // `skills -g update` would stop maintaining it.
    const { restore } = await trashServiceModule
    const entryName = '1700000000000-restore-cccccccc'
    await stageTombstone(entryName, sourceBackedManifest('theme-generator'))
    resolveLockKeyMock.mockResolvedValue('theme-generator')

    // Act
    await restore(tombstoneId(entryName))

    // Assert
    expect(queuePruneMock).not.toHaveBeenCalled()
  })

  test('leaves an entry flagged for manual recovery alone', async () => {
    // Arrange
    // Those entries hold the only surviving copy of the user's data.
    const { startupCleanup } = await trashServiceModule
    const entryName = '1700000000000-manual-ffffffff'
    const entryDir = await stageTombstone(
      entryName,
      sourceBackedManifest('manual'),
    )
    await writeFile(join(entryDir, '.manual-recovery'), 'stranded', 'utf-8')
    resolveLockKeyMock.mockResolvedValue('manual')

    // Act
    await startupCleanup()

    // Assert
    await stat(entryDir) // still there
    expect(queuePruneMock).not.toHaveBeenCalled()
  })
})
