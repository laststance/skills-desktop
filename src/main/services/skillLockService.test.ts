import { mkdtempSync, realpathSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import type { SkillName } from '@/shared/types'

// Stamped synchronously at module load: `main/constants` computes SOURCE_DIR
// and TRASH_DIR from homedir() at import time, so the value has to exist
// before the mock factory below is evaluated.
const sharedHome = realpathSync(mkdtempSync(join(tmpdir(), 'skills-lock-it-')))
const sourceDir = join(sharedHome, '.agents', 'skills')
const trashDir = join(sharedHome, '.agents', '.trash')
const lockPath = join(sharedHome, '.agents', '.skill-lock.json')

vi.mock('node:os', async () => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await vi.importActual<typeof import('node:os')>('node:os')
  return { ...actual, homedir: () => sharedHome }
})

// `main/constants` imports from the bare `'os'` specifier, so SOURCE_DIR and
// TRASH_DIR need this second mock or they still point at the real home dir.
vi.mock('os', async () => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await vi.importActual<typeof import('os')>('os')
  return { ...actual, homedir: () => sharedHome }
})

/**
 * Stands in for `npx skills remove`. Rewrites the lock exactly like the real
 * CLI does so the service's verify-by-re-reading-the-lock logic runs for real
 * instead of trusting a stubbed return value.
 */
const { removeSkillsMock } = vi.hoisted(() => ({
  removeSkillsMock:
    vi.fn<(names: readonly string[]) => Promise<{ success: boolean }>>(),
}))

vi.mock('./skillsCliService', () => ({
  skillsCliService: {
    removeSkills: async (names: readonly string[]) => removeSkillsMock(names),
  },
}))

const serviceModule = import('./skillLockService')

/**
 * Write a v3 lock containing the given keys, matching the CLI's on-disk shape.
 * @param names - Raw lock keys, exactly as `skills add` would record them.
 * @example await writeLock(['tdd-workflow'])
 */
async function writeLock(names: readonly string[]): Promise<void> {
  const skills = Object.fromEntries(
    names.map((name) => [
      name,
      { source: 'owner/repo', sourceUrl: 'https://example.com', agents: [] },
    ]),
  )
  await mkdir(join(sharedHome, '.agents'), { recursive: true })
  await writeFile(lockPath, JSON.stringify({ version: 3, skills }), 'utf-8')
}

/**
 * Create an installed skill directory under the mocked `~/.agents/skills`.
 * @param dirName - Directory basename, i.e. the sanitized lock key.
 * @example await makeSourceSkill('tdd-workflow')
 */
async function makeSourceSkill(dirName: string): Promise<void> {
  const dir = join(sourceDir, dirName)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'SKILL.md'), '# skill\n', 'utf-8')
}

/**
 * Stage a source-backed tombstone so the skill looks like it is inside its
 * undo window.
 * @param dirName - Basename of the source directory that was moved to trash.
 * @example await makeTombstone('tdd-workflow')
 */
async function makeTombstone(dirName: string): Promise<void> {
  const entryDir = join(trashDir, `1700000000000-${dirName}-aaaaaaaa`)
  await mkdir(entryDir, { recursive: true })
  await writeFile(
    join(entryDir, 'manifest.json'),
    JSON.stringify({
      schemaVersion: 2,
      kind: 'source-backed',
      deletedAt: 1700000000000,
      skillName: 'Display Name Not The Directory',
      sourcePath: join(sourceDir, dirName),
      symlinks: [],
    }),
    'utf-8',
  )
}

/** Read the lock keys straight off disk, bypassing the service under test. */
async function readLockKeys(): Promise<string[]> {
  const raw = await readFile(lockPath, 'utf-8')
  return Object.keys(JSON.parse(raw).skills)
}

beforeEach(async () => {
  await rm(join(sharedHome, '.agents'), { recursive: true, force: true })
  await mkdir(sourceDir, { recursive: true })
  removeSkillsMock.mockReset()
  // Default fake CLI: removes every requested key from the lock.
  removeSkillsMock.mockImplementation(async (names) => {
    const raw = await readFile(lockPath, 'utf-8')
    const lock = JSON.parse(raw)
    for (const name of names) delete lock.skills[name]
    await writeFile(lockPath, JSON.stringify(lock), 'utf-8')
    return { success: true }
  })
  const { __resetPruneQueueForTests } = await serviceModule
  __resetPruneQueueForTests()
})

afterEach(() => {
  delete process.env.XDG_STATE_HOME
})

describe('scanStaleLockEntries', () => {
  test('reports a lock record whose skill was deleted outside the app', async () => {
    // Arrange
    const { scanStaleLockEntries } = await serviceModule
    await writeLock(['deleted-in-finder', 'still-here'])
    await makeSourceSkill('still-here')

    // Act
    const result = await scanStaleLockEntries()

    // Assert
    expect(result).toEqual({ status: 'ok', names: ['deleted-in-finder'] })
  })

  test('settles a queued prune before counting, so it never offers work already in flight', async () => {
    // Arrange — evict() queues the prune behind a 500ms debounce. A scan fired
    // the moment the undo window closes would otherwise show a "Prune lock"
    // CTA for a record the trash is in the middle of removing.
    const { scanStaleLockEntries, queuePrune } = await serviceModule
    await writeLock(['evicted-skill'])
    queuePrune('evicted-skill')

    // Act
    const result = await scanStaleLockEntries()

    // Assert
    expect(result).toEqual({ status: 'ok', names: [] })
    expect(await readLockKeys()).toEqual([])
  })

  test('does not report a skill still waiting out its undo window in the trash', async () => {
    // Arrange
    // The source folder is already gone (moveToTrash renamed it away), but the
    // record is still doing its job: restore has to be able to put it back.
    const { scanStaleLockEntries } = await serviceModule
    await writeLock(['pending-undo'])
    await makeTombstone('pending-undo')

    // Act
    const result = await scanStaleLockEntries()

    // Assert
    expect(result).toEqual({ status: 'ok', names: [] })
  })

  test('reports unavailable rather than flagging every record when the source dir cannot be read', async () => {
    // Arrange
    // This is the destructive false positive: with the source side missing,
    // a naive diff offers to delete the user's entire lock.
    const { scanStaleLockEntries } = await serviceModule
    await writeLock(['skill-a', 'skill-b'])
    await rm(sourceDir, { recursive: true, force: true })

    // Act
    const result = await scanStaleLockEntries()

    // Assert
    expect(result).toEqual({ status: 'unavailable' })
  })

  test('reports unavailable rather than flagging a mid-undo skill when a trash entry cannot be read', async () => {
    // Arrange
    // The trash is the only proof a deleted skill is still restorable. Reading
    // an unreadable trash as "nothing staged" reports the record stale, and
    // Undo then puts the skill back with its lock record already pruned.
    const { scanStaleLockEntries } = await serviceModule
    await writeLock(['pending-undo'])
    // A directory where manifest.json belongs makes readFile fail with EISDIR:
    // an error that is emphatically not "absent", which is the distinction here.
    await mkdir(join(trashDir, '1700000000000-x-aaaaaaaa', 'manifest.json'), {
      recursive: true,
    })

    // Act
    const result = await scanStaleLockEntries()

    // Assert
    expect(result).toEqual({ status: 'unavailable' })
  })

  test('reports no stale entries when the lock predates the version the CLI reads', async () => {
    // Arrange
    // The CLI wipes any lock below version 3 on its next read, so these records
    // can never trigger a reinstall. Offering to prune them would be busywork.
    const { scanStaleLockEntries } = await serviceModule
    await mkdir(join(sharedHome, '.agents'), { recursive: true })
    await writeFile(
      lockPath,
      JSON.stringify({ version: 2, skills: { 'ancient-skill': {} } }),
      'utf-8',
    )

    // Act
    const result = await scanStaleLockEntries()

    // Assert
    expect(result).toEqual({ status: 'ok', names: [] })
  })

  test('reports unavailable rather than zero when the lock file is corrupt', async () => {
    // Arrange
    const { scanStaleLockEntries } = await serviceModule
    await mkdir(join(sharedHome, '.agents'), { recursive: true })
    await writeFile(lockPath, '{ this is not json', 'utf-8')

    // Act
    const result = await scanStaleLockEntries()

    // Assert
    expect(result).toEqual({ status: 'unavailable' })
  })

  test('reports no stale entries on a fresh install with no lock file', async () => {
    // Arrange
    const { scanStaleLockEntries } = await serviceModule

    // Act
    const result = await scanStaleLockEntries()

    // Assert
    expect(result).toEqual({ status: 'ok', names: [] })
  })

  test('matches a lock key against its sanitized directory name', async () => {
    // Arrange
    // The lock is keyed by the raw install name; the directory on disk is the
    // sanitized form. Comparing them literally would report this as deleted.
    const { scanStaleLockEntries } = await serviceModule
    await writeLock(['CE:Review'])
    await makeSourceSkill('ce-review')

    // Act
    const result = await scanStaleLockEntries()

    // Assert
    expect(result).toEqual({ status: 'ok', names: [] })
  })

  test('excludes both lock keys that normalize onto the same directory name', async () => {
    // Arrange
    // One directory cannot answer "is this record's skill gone" for two keys,
    // and prune is not allowed to guess about deletion.
    const { scanStaleLockEntries } = await serviceModule
    await writeLock(['Ambiguous', 'ambiguous'])

    // Act
    const result = await scanStaleLockEntries()

    // Assert
    expect(result).toEqual({ status: 'ok', names: [] })
  })

  test('does not report a skill whose folder exists but has no readable SKILL.md', async () => {
    // Arrange
    // Only a confirmed ENOENT/ENOTDIR proves absence. A folder we cannot fully
    // read is still a folder, and its record is still correct.
    const { scanStaleLockEntries } = await serviceModule
    await writeLock(['unreadable-contents'])
    await mkdir(join(sourceDir, 'unreadable-contents'), { recursive: true })

    // Act
    const result = await scanStaleLockEntries()

    // Assert
    expect(result).toEqual({ status: 'ok', names: [] })
  })

  test('reads the lock from XDG_STATE_HOME when the CLI would', async () => {
    // Arrange
    // Detection and prune have to agree on which file is the lock, or the app
    // reports drift against one file and edits another.
    const { scanStaleLockEntries } = await serviceModule
    const xdgHome = join(sharedHome, 'xdg-state')
    await mkdir(join(xdgHome, 'skills'), { recursive: true })
    await writeFile(
      join(xdgHome, 'skills', '.skill-lock.json'),
      JSON.stringify({ version: 3, skills: { 'xdg-only-skill': {} } }),
      'utf-8',
    )
    process.env.XDG_STATE_HOME = xdgHome

    // Act
    const result = await scanStaleLockEntries()

    // Assert
    expect(result).toEqual({ status: 'ok', names: ['xdg-only-skill'] })
  })
})

describe('pruneLockEntries', () => {
  test('removes the record and reports it pruned', async () => {
    // Arrange
    const { pruneLockEntries } = await serviceModule
    await writeLock(['gone-skill', 'kept-skill'])
    await makeSourceSkill('kept-skill')

    // Act
    const result = await pruneLockEntries(['gone-skill'] as SkillName[])

    // Assert
    expect(result).toEqual({
      pruned: ['gone-skill'],
      skipped: [],
      failed: [],
    })
    expect(await readLockKeys()).toEqual(['kept-skill'])
  })

  test('passes the raw lock key to the CLI, never the sanitized directory name', async () => {
    // Arrange
    // `removeSkillFromLock` looks the record up by raw name. Handing it the
    // sanitized form silently no-ops, and the verify step then reports a
    // permanent failure on a skill that is actually still tracked.
    const { pruneLockEntries } = await serviceModule
    await writeLock(['CE:Review'])

    // Act
    await pruneLockEntries(['CE:Review'] as SkillName[])

    // Assert
    expect(removeSkillsMock).toHaveBeenCalledWith(['CE:Review'])
  })

  test('drops a queued name when the skill was reinstalled before the batch ran', async () => {
    // Arrange
    // Deleting X then reinstalling X inside the undo window leaves a delete
    // request in flight that is no longer true. Acting on it destroys the
    // fresh copy, and the lock re-read would still call that a success.
    const { pruneLockEntries } = await serviceModule
    await writeLock(['reinstalled'])
    await makeSourceSkill('reinstalled')

    // Act
    const result = await pruneLockEntries(['reinstalled'] as SkillName[])

    // Assert
    expect(removeSkillsMock).not.toHaveBeenCalled()
    expect(result).toEqual({
      pruned: [],
      skipped: ['reinstalled'],
      failed: [],
    })
    expect(await readLockKeys()).toEqual(['reinstalled'])
  })

  test('reports failure when a record survives the CLI call despite a zero exit code', async () => {
    // Arrange
    // `skills remove` logs per-item failures and still exits 0, so success has
    // to be decided by re-reading the lock.
    const { pruneLockEntries } = await serviceModule
    await writeLock(['stubborn-record'])
    removeSkillsMock.mockResolvedValue({ success: true })

    // Act
    const result = await pruneLockEntries(['stubborn-record'] as SkillName[])

    // Assert
    expect(result).toEqual({
      pruned: [],
      skipped: [],
      failed: ['stubborn-record'],
    })
  })

  test('does not spawn the CLI when no requested name is still in the lock', async () => {
    // Arrange
    const { pruneLockEntries } = await serviceModule
    await writeLock(['unrelated'])

    // Act
    const result = await pruneLockEntries(['already-pruned'] as SkillName[])

    // Assert
    expect(removeSkillsMock).not.toHaveBeenCalled()
    expect(result.skipped).toEqual(['already-pruned'])
  })
})

describe('queuePrune', () => {
  test('collapses a bulk delete into one CLI call instead of one per skill', async () => {
    // Arrange
    // Each spawn does an unsynchronized read-modify-write on the same JSON
    // file, and the CLI reads a half-written lock as an EMPTY lock.
    const { queuePrune, flushPruneQueue } = await serviceModule
    await writeLock(['bulk-a', 'bulk-b', 'bulk-c'])

    // Act
    queuePrune('bulk-a')
    queuePrune('bulk-b')
    queuePrune('bulk-c')
    await flushPruneQueue()

    // Assert
    expect(removeSkillsMock).toHaveBeenCalledTimes(1)
    expect(removeSkillsMock).toHaveBeenCalledWith([
      'bulk-a',
      'bulk-b',
      'bulk-c',
    ])
    expect(await readLockKeys()).toEqual([])
  })
})

describe('runLockWrite', () => {
  test('runs overlapping lock writes one at a time', async () => {
    // Arrange
    // Two CLI children rewriting .skill-lock.json concurrently can truncate it,
    // and the CLI treats a truncated lock as an empty one.
    const { runLockWrite } = await serviceModule
    const order: string[] = []

    /** Records entry, yields the event loop, then records exit. */
    const recordOverlap = async (label: string): Promise<void> => {
      order.push(`${label}:start`)
      await new Promise((resolve) => setTimeout(resolve, 5))
      order.push(`${label}:end`)
    }

    // Act
    await Promise.all([
      runLockWrite(async () => recordOverlap('first')),
      runLockWrite(async () => recordOverlap('second')),
    ])

    // Assert
    expect(order).toEqual([
      'first:start',
      'first:end',
      'second:start',
      'second:end',
    ])
  })

  test('keeps the chain alive after an operation rejects', async () => {
    // Arrange
    const { runLockWrite } = await serviceModule

    // Act
    const failed = runLockWrite(async () => {
      throw new Error('install exploded')
    })
    const afterFailure = runLockWrite(async () => 'still running')

    // Assert
    await expect(failed).rejects.toThrow('install exploded')
    await expect(afterFailure).resolves.toBe('still running')
  })
})
