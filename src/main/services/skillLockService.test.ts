import { mkdtempSync, realpathSync } from 'node:fs'
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest'

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

/**
 * Stage a trash entry that failed its automatic restore, exactly as
 * `trashService` leaves one: the marker is written while no manifest exists,
 * because both source-backed writers run before the manifest is created.
 * @param dirName - Basename of the source directory the entry was staged from.
 * @param withManifest - Also write a valid manifest (a shape today's writers never produce).
 * @example await makeManualRecoveryEntry('stuck-skill')
 */
async function makeManualRecoveryEntry(
  dirName: string,
  withManifest = false,
): Promise<void> {
  if (withManifest) await makeTombstone(dirName)
  const entryDir = join(trashDir, `1700000000000-${dirName}-aaaaaaaa`)
  await mkdir(entryDir, { recursive: true })
  await writeFile(
    join(entryDir, '.manual-recovery'),
    'manual recovery required\nreason: test\n',
    'utf-8',
  )
}

/**
 * Give an agent a REAL directory (not a symlink) under a skill name, the state
 * that makes `skills remove --global` destructive.
 * @param dirName - Sanitized skill directory name.
 * @example await makeAgentOwnedDir('agent-owned')
 */
async function makeAgentOwnedDir(dirName: string): Promise<void> {
  const dir = join(sharedHome, '.claude', 'skills', dirName)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'SKILL.md'), '# local\n', 'utf-8')
}

/** Read the lock keys straight off disk, bypassing the service under test. */
async function readLockKeys(): Promise<string[]> {
  const raw = await readFile(lockPath, 'utf-8')
  return Object.keys(JSON.parse(raw).skills)
}

beforeEach(async () => {
  await rm(join(sharedHome, '.agents'), { recursive: true, force: true })
  // `.claude` too: the agent-copy tests stage a real directory there, and one
  // surviving into a later test would refuse every prune that followed it.
  // Clearing both trees here is what lets those tests skip their own cleanup.
  await rm(join(sharedHome, '.claude'), { recursive: true, force: true })
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
  // Clear on the way in as well as out: the afterEach only protects tests that
  // run after one of ours, not against a value already in the dev's shell.
  delete process.env.XDG_STATE_HOME
})

afterEach(() => {
  delete process.env.XDG_STATE_HOME
})

// `sharedHome` is created once at module load and every test writes inside it,
// so nothing may remove it until the file is done. Without this each run leaves
// another `skills-lock-it-*` directory behind in the system temp dir.
afterAll(async () => {
  await rm(sharedHome, { recursive: true, force: true })
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
    expect(result).toEqual({
      status: 'ok',
      names: ['deleted-in-finder'],
      unprunable: [],
    })
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
    expect(result).toEqual({ status: 'ok', names: [], unprunable: [] })
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
    expect(result).toEqual({ status: 'ok', names: [], unprunable: [] })
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
    expect(result).toEqual({ status: 'ok', names: [], unprunable: [] })
  })

  test('reports unavailable when the lock was written by a CLI newer than this build', async () => {
    // Arrange
    // A version we have never seen may key its records differently, so
    // `sanitizeName` can no longer say which directory answers for a record.
    // Reporting `ok` would offer every entry in it for deletion.
    const { scanStaleLockEntries } = await serviceModule
    await mkdir(join(sharedHome, '.agents'), { recursive: true })
    await writeFile(
      lockPath,
      JSON.stringify({ version: 4, skills: { 'future-skill': {} } }),
      'utf-8',
    )

    // Act
    const result = await scanStaleLockEntries()

    // Assert
    expect(result).toEqual({ status: 'unavailable' })
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
    expect(result).toEqual({ status: 'ok', names: [], unprunable: [] })
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
    expect(result).toEqual({ status: 'ok', names: [], unprunable: [] })
  })

  test('reports both lock keys that normalize onto the same directory name as blocked rather than dropping them', async () => {
    // Arrange
    // One directory cannot answer "is this record's skill gone" for two keys,
    // so neither may be offered for deletion. Dropping them silently is what
    // left the pair unprunable forever with nothing in the UI saying why.
    const { scanStaleLockEntries } = await serviceModule
    await writeLock(['Ambiguous', 'ambiguous'])

    // Act
    const result = await scanStaleLockEntries()

    // Assert
    expect(result).toEqual({
      status: 'ok',
      names: [],
      unprunable: [
        { name: 'Ambiguous', reason: 'name-collision' },
        { name: 'ambiguous', reason: 'name-collision' },
      ],
    })
  })

  test('blocks a record an agent still holds a real folder for instead of offering it for deletion', async () => {
    // Arrange
    // `skills remove --global` rm -rf's <agent>/skills/<name> with no symlink
    // check, so delegating here would delete the user's own files. Offering the
    // record anyway meant the only way to learn that was to click Remove and
    // read a failure, forever.
    const { scanStaleLockEntries } = await serviceModule
    await writeLock(['agent-owned'])
    await makeAgentOwnedDir('agent-owned')

    // Act
    const result = await scanStaleLockEntries()

    // Assert
    expect(result).toEqual({
      status: 'ok',
      names: [],
      unprunable: [{ name: 'agent-owned', reason: 'agent-copy' }],
    })
  })

  test('still offers a record whose only agent copy is a symlink', async () => {
    // Arrange
    // The guard is about REAL directories. A symlink is what a normal install
    // leaves behind, so treating it as blocking would make every stale record
    // unprunable and the feature would do nothing at all.
    const { scanStaleLockEntries } = await serviceModule
    await writeLock(['linked-only'])
    await mkdir(join(sharedHome, '.claude', 'skills'), { recursive: true })
    await symlink(
      join(sourceDir, 'linked-only'),
      join(sharedHome, '.claude', 'skills', 'linked-only'),
    )

    // Act
    const result = await scanStaleLockEntries()

    // Assert
    expect(result).toEqual({
      status: 'ok',
      names: ['linked-only'],
      unprunable: [],
    })
  })

  test('keeps scanning when a trash entry was left for manual recovery with no manifest', async () => {
    // Arrange
    // Both source-backed writers of the marker run BEFORE the manifest exists,
    // so the entry reads as ENOENT. Without the marker check that looks like one
    // of our own entries caught mid-write and takes the whole scan to
    // `unavailable` — permanently, because startup cleanup never sweeps a marked
    // entry. The feature would be dead for that user with no way back.
    const { scanStaleLockEntries } = await serviceModule
    await writeLock(['stuck-skill'])
    await makeManualRecoveryEntry('stuck-skill')

    // Act
    const result = await scanStaleLockEntries()

    // Assert
    expect(result).toEqual({
      status: 'ok',
      names: ['stuck-skill'],
      unprunable: [],
    })
  })

  test('stops treating a manual-recovery entry as a live undo window', async () => {
    // Arrange
    // Its automatic restore already failed for good, so counting it as "still
    // restorable" only kept the lock record alive for `skills -g update` to
    // reinstall a skill the user deleted.
    const { scanStaleLockEntries } = await serviceModule
    await writeLock(['stuck-skill'])
    await makeManualRecoveryEntry('stuck-skill', true)

    // Act
    const result = await scanStaleLockEntries()

    // Assert
    expect(result).toEqual({
      status: 'ok',
      names: ['stuck-skill'],
      unprunable: [],
    })
  })

  test('still holds a record back for an ordinary tombstone inside its undo window', async () => {
    // Arrange
    // The discriminating case for the two tests above: without the marker, a
    // staged delete is restorable and its record must NOT be reported stale.
    const { scanStaleLockEntries } = await serviceModule
    await writeLock(['undoable'])
    await makeTombstone('undoable')

    // Act
    const result = await scanStaleLockEntries()

    // Assert
    expect(result).toEqual({ status: 'ok', names: [], unprunable: [] })
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
    expect(result).toEqual({ status: 'ok', names: [], unprunable: [] })
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
    expect(result).toEqual({
      status: 'ok',
      names: ['xdg-only-skill'],
      unprunable: [],
    })
  })

  test('treats a trash entry still being staged as unreadable rather than foreign', async () => {
    // Arrange
    // `moveToTrash` renames the source in BEFORE writing manifest.json, so one
    // of our own entries caught in that window has no manifest. Reading that as
    // a foreign file would report a skill whose undo is still live as stale.
    const { scanStaleLockEntries } = await serviceModule
    await writeLock(['mid-staging'])
    await mkdir(join(trashDir, '1700000000000-mid-staging-bbbbbbbb'), {
      recursive: true,
    })

    // Act
    const result = await scanStaleLockEntries()

    // Assert
    expect(result).toEqual({ status: 'unavailable' })
  })
  test('reports the lock as unavailable when the file exists but cannot be read', async () => {
    // Arrange: a directory where the lock file belongs makes readFile throw
    // EISDIR — a real error, not the benign "no lock yet" ENOENT.
    const { scanStaleLockEntries } = await serviceModule
    await mkdir(lockPath, { recursive: true })

    // Act
    const result = await scanStaleLockEntries()

    // Assert
    expect(result).toEqual({ status: 'unavailable' })
  })

  test('reports the scan as unavailable when the trash directory cannot be listed', async () => {
    // Arrange: a self-referential symlink makes readdir throw ELOOP. ENOTDIR
    // would NOT work here — `isMissingPathError` counts it as proof of
    // absence, so it takes the benign "no trash yet" branch by design.
    const { scanStaleLockEntries } = await serviceModule
    await writeLock(['deleted-in-finder'])
    await symlink('.trash', trashDir)

    // Act
    const result = await scanStaleLockEntries()

    // Assert: no record can be called stale while half the picture is missing.
    expect(result).toEqual({ status: 'unavailable' })
  })

  test('treats a trash entry with an unparseable manifest as holding nothing back', async () => {
    // Arrange: Undo reads the same manifest, so an entry it cannot parse
    // cannot restore this skill either.
    const { scanStaleLockEntries } = await serviceModule
    await writeLock(['deleted-in-finder'])
    const entryDir = join(trashDir, '1700000000000-deleted-in-finder-aaaaaaaa')
    await mkdir(entryDir, { recursive: true })
    await writeFile(join(entryDir, 'manifest.json'), '{ truncated', 'utf-8')

    // Act
    const result = await scanStaleLockEntries()

    // Assert
    expect(result).toEqual({
      status: 'ok',
      names: ['deleted-in-finder'],
      unprunable: [],
    })
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

  test('keeps the lock of a newer, still-undoable deletion when an older eviction prunes the same name', async () => {
    // Arrange
    // Delete X, reinstall X, delete X again. The first eviction already queued
    // a prune for X; by the time it runs, the second delete owns a tombstone
    // the user can still Undo. Pruning on "source is absent" alone strands
    // that restore with no lock record.
    const { pruneLockEntries } = await serviceModule
    await writeLock(['same-name'])
    await makeTombstone('same-name')

    // Act
    const result = await pruneLockEntries(['same-name'] as SkillName[])

    // Assert
    expect(removeSkillsMock).not.toHaveBeenCalled()
    expect(result).toEqual({
      pruned: [],
      skipped: ['same-name'],
      failed: [],
    })
    expect(await readLockKeys()).toEqual(['same-name'])
  })

  test('refuses to delegate a name that still owns a real directory inside an agent', async () => {
    // Arrange
    // `skills remove --global` rm -rf's <agent globalSkillsDir>/<name> for every
    // agent with no symlink check, and only universal-source agents point that
    // at ~/.agents/skills. A real directory under ~/.claude/skills is the
    // user's own content, which the app's delete deliberately preserves.
    const { pruneLockEntries } = await serviceModule
    const agentOwnedDir = join(sharedHome, '.claude', 'skills', 'agent-owned')
    await writeLock(['agent-owned'])
    await mkdir(agentOwnedDir, { recursive: true })
    await writeFile(join(agentOwnedDir, 'SKILL.md'), '# local\n', 'utf-8')

    // Act
    const result = await pruneLockEntries(['agent-owned'] as SkillName[])

    // Assert
    expect(removeSkillsMock).not.toHaveBeenCalled()
    expect(result).toEqual({
      pruned: [],
      skipped: [],
      failed: ['agent-owned'],
    })
    expect(await readLockKeys()).toEqual(['agent-owned'])
  })

  test('still prunes when the agent-side path is only a symlink to the deleted source', async () => {
    // Arrange
    // The guard must use lstat, not stat: stat follows the link and would
    // report this healthy symlink as a directory, refusing every real prune.
    const { pruneLockEntries } = await serviceModule
    const agentSkillsDir = join(sharedHome, '.claude', 'skills')
    await writeLock(['linked-only'])
    await mkdir(agentSkillsDir, { recursive: true })
    await symlink(
      join(sourceDir, 'linked-only'),
      join(agentSkillsDir, 'linked-only'),
    )

    // Act
    const result = await pruneLockEntries(['linked-only'] as SkillName[])

    // Assert
    expect(removeSkillsMock).toHaveBeenCalledWith(['linked-only'])
    expect(result).toEqual({
      pruned: ['linked-only'],
      skipped: [],
      failed: [],
    })
  })

  test('refuses to prune every record when the source root itself is gone', async () => {
    // Arrange
    // An unmounted volume or a renamed root makes every per-skill stat ENOENT.
    // Without a root probe that reads as "the user deleted everything" and
    // wipes the whole lock.
    const { pruneLockEntries } = await serviceModule
    await writeLock(['first-skill', 'second-skill'])
    await rm(sourceDir, { recursive: true, force: true })

    // Act
    const result = await pruneLockEntries([
      'first-skill',
      'second-skill',
    ] as SkillName[])

    // Assert
    expect(removeSkillsMock).not.toHaveBeenCalled()
    expect(result).toEqual({
      pruned: [],
      skipped: [],
      failed: ['first-skill', 'second-skill'],
    })
    expect(await readLockKeys()).toEqual(['first-skill', 'second-skill'])
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
  test('fails every requested name when the lock itself cannot be read', async () => {
    // Arrange
    const { pruneLockEntries } = await serviceModule
    await mkdir(lockPath, { recursive: true })

    // Act
    const result = await pruneLockEntries(['whatever'])

    // Assert: without the lock there is no way to prove a removal is safe.
    expect(result).toEqual({
      pruned: [],
      skipped: [],
      failed: ['whatever'],
    })
    expect(removeSkillsMock).not.toHaveBeenCalled()
  })

  test('reports a delegated name as failed when the lock is unreadable after the CLI runs', async () => {
    // Arrange: the real CLI rewrites the lock with a plain writeFile, so a
    // kill mid-write leaves bytes that no longer parse.
    const { pruneLockEntries } = await serviceModule
    await writeLock(['half-written'])
    removeSkillsMock.mockImplementation(async () => {
      await writeFile(lockPath, '{ "version": 3, "skills": { ', 'utf-8')
      return { success: true }
    })

    // Act
    const result = await pruneLockEntries(['half-written'])

    // Assert: unverifiable is reported as failed, never as pruned.
    expect(result).toEqual({
      pruned: [],
      skipped: [],
      failed: ['half-written'],
    })
  })

  test('reports a name as failed, not skipped, when the trash cannot be read', async () => {
    // Arrange: an unreadable trash means we cannot tell whether this record is
    // still restorable, so the delete is refused. A self-referential symlink
    // gives ELOOP; ENOTDIR would be read as "no trash yet" by design.
    const { pruneLockEntries } = await serviceModule
    await writeLock(['gone-from-disk'])
    await symlink('.trash', trashDir)

    // Act
    const result = await pruneLockEntries(['gone-from-disk'] as SkillName[])

    // Assert: `skipped` means "nothing to do here" and the UI reports it as a
    // benign no-op. This record is still stale and still needs the user's
    // attention, so it belongs in `failed`.
    expect(result).toEqual({
      pruned: [],
      skipped: [],
      failed: ['gone-from-disk'],
    })
    expect(removeSkillsMock).not.toHaveBeenCalled()
  })

  test('reports a name as failed, not skipped, when its source dir cannot be stat-ed', async () => {
    // Arrange: a self-referential symlink makes stat throw ELOOP, so absence
    // can be neither proven nor ruled out. ENOTDIR would be read as "provably
    // absent" by design, which is why it cannot stand in here.
    const { pruneLockEntries } = await serviceModule
    await writeLock(['unreadable'])
    await symlink('unreadable', join(sourceDir, 'unreadable'))

    // Act
    const result = await pruneLockEntries(['unreadable'] as SkillName[])

    // Assert: `skipped` would tell the user the skill came back and hide the
    // record. It is still stale and still unverifiable, so it goes to `failed`.
    expect(result).toEqual({
      pruned: [],
      skipped: [],
      failed: ['unreadable'],
    })
    expect(removeSkillsMock).not.toHaveBeenCalled()
  })

  test('refuses a name another lock key started sharing a directory with after the scan', async () => {
    // Arrange
    // The scan offered `Ambiguous` while it was the only key sanitizing to
    // `ambiguous`. A second key arriving before the user confirms makes the
    // directory ambiguous, and upstream `removeSkillFromLock` is last-write-wins
    // over sanitized names — delegating now would delete the OTHER record.
    const { pruneLockEntries } = await serviceModule
    await writeLock(['Ambiguous', 'ambiguous'])

    // Act
    const result = await pruneLockEntries(['Ambiguous'] as SkillName[])

    // Assert
    expect(removeSkillsMock).not.toHaveBeenCalled()
    expect(result).toEqual({
      pruned: [],
      skipped: [],
      // Still stale and still unresolved, so it belongs in `failed`, which the
      // UI surfaces, and never in `skipped`, which reads as a benign no-op.
      failed: ['Ambiguous'],
    })
    expect(await readLockKeys()).toEqual(['Ambiguous', 'ambiguous'])
  })

  test('prunes the names it could verify and still reports the unverifiable one as failed', async () => {
    // Arrange: the shape "Remove all" produces — one batch, mixed outcomes. An
    // unverifiable name must not veto the rest, and must not vanish from the
    // report once the CLI call succeeds for the others.
    const { pruneLockEntries } = await serviceModule
    await writeLock(['unreadable', 'gone-from-disk'])
    await symlink('unreadable', join(sourceDir, 'unreadable'))

    // Act
    const result = await pruneLockEntries([
      'unreadable',
      'gone-from-disk',
    ] as SkillName[])

    // Assert
    expect(result).toEqual({
      pruned: ['gone-from-disk'],
      skipped: [],
      failed: ['unreadable'],
    })
    expect(removeSkillsMock).toHaveBeenCalledWith(['gone-from-disk'])
    expect(await readLockKeys()).toEqual(['unreadable'])
  })
})

describe('resolveLockKeyForDirectory', () => {
  test('waits out an in-flight lock rewrite instead of reading a half-written file', async () => {
    // Arrange
    // The CLI's `writeSkillLock` is a plain `writeFile`, so a reader that does
    // not join the write mutex can land on the truncated middle of it. Here a
    // null is unrecoverable rather than merely wrong: this runs from trash
    // eviction, and the tombstone that would re-queue the prune is already gone.
    const { pruneLockEntries, resolveLockKeyForDirectory } = await serviceModule
    await writeLock(['CE:Review', 'gone-from-disk'])
    await makeSourceSkill('ce-review')
    let announceTruncated: () => void
    const lockIsTruncated = new Promise<void>((resolve) => {
      announceTruncated = resolve
    })
    removeSkillsMock.mockImplementation(async (names) => {
      const raw = await readFile(lockPath, 'utf-8')
      const lock = JSON.parse(raw)
      for (const name of names) delete lock.skills[name]
      const finalContent = JSON.stringify(lock)
      // Reproduce the window a non-atomic write leaves open on disk.
      await writeFile(lockPath, finalContent.slice(0, 12), 'utf-8')
      announceTruncated()
      await new Promise((resolve) => setTimeout(resolve, 20))
      await writeFile(lockPath, finalContent, 'utf-8')
      return { success: true }
    })

    // Act
    const pruning = pruneLockEntries(['gone-from-disk'] as SkillName[])
    await lockIsTruncated
    const resolved = await resolveLockKeyForDirectory('ce-review')
    await pruning

    // Assert — the truncated bytes were on disk when this call was made; only
    // serializing behind the write turns them back into the raw key.
    expect(resolved).toBe('CE:Review')
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
  test('flushes the queued batch once the debounce window elapses', async () => {
    // Arrange: nothing else drives the timer, so this is the only coverage of
    // the debounce actually firing rather than a direct flush call. Real
    // timers, not fake ones: the callback is `void flushPruneQueue()`, so
    // advancing fake timers returns before the fs work it starts has run.
    const { queuePrune } = await serviceModule
    await writeLock(['debounced-skill'])

    // Act
    queuePrune('debounced-skill')

    // Assert: wait on the effect, not the call. `removeSkillsMock` is async and
    // rewrites the lock in its body, so waiting for the invocation alone lets
    // the read below race its `writeFile` — which is what it did on CI.
    await vi.waitFor(async () => {
      expect(await readLockKeys()).toEqual([])
    })
    expect(removeSkillsMock).toHaveBeenCalledWith(['debounced-skill'])
  })

  test('logs the surviving names when a queued prune does not remove them', async () => {
    // Arrange: `skills remove` exits 0 even when a removal failed, so the
    // service verifies by re-reading and must say so when the key survives.
    const { queuePrune, flushPruneQueue } = await serviceModule
    await writeLock(['stubborn-skill'])
    removeSkillsMock.mockImplementation(async () => ({ success: true }))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    // Act
    queuePrune('stubborn-skill')
    await flushPruneQueue()

    // Assert
    expect(consoleError).toHaveBeenCalledWith(
      'skillLockService: prune failed',
      expect.objectContaining({ failed: ['stubborn-skill'] }),
    )
    expect(await readLockKeys()).toEqual(['stubborn-skill'])
    consoleError.mockRestore()
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
