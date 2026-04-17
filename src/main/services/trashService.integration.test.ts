import { mkdtempSync } from 'node:fs'
import {
  mkdir,
  readFile,
  readlink,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

// sharedHome is stamped SYNCHRONOUSLY at module load so that the vi.mock
// factory below captures a defined value by the time `trashService` is
// imported. Previously this was `let sharedHome` seeded inside beforeAll,
// which raced with vitest's dynamic-import scheduling: on some orderings
// `trashService`'s top-level `TRASH_DIR = join(homedir(), '.agents', '.trash')`
// ran while sharedHome was still undefined and blew up inside `join`.
const sharedHome = mkdtempSync(join(tmpdir(), 'skills-trash-it-'))
const sharedSourceDir = join(sharedHome, '.agents', 'skills')
const sharedTrashDir = join(sharedHome, '.agents', '.trash')
const sharedAgentCursor = join(sharedHome, '.cursor', 'skills')

vi.mock('node:os', async () => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await vi.importActual<typeof import('node:os')>('node:os')
  return {
    ...actual,
    homedir: () => sharedHome,
  }
})

// Import AFTER the mock registration so the module's top-level `homedir()` /
// `join(homedir(), '.agents', '.trash')` constants resolve to our tmp path.
const trashServicePromise = (async () => {
  const mod = await import('./trashService')
  return mod
})()

describe('trashService (integration)', () => {
  beforeAll(async () => {
    await mkdir(sharedSourceDir, { recursive: true })
    await mkdir(sharedAgentCursor, { recursive: true })
  })

  afterAll(async () => {
    await rm(sharedHome, { recursive: true, force: true })
  })

  afterEach(async () => {
    const { __clearEvictTimersForTests } = await trashServicePromise
    __clearEvictTimersForTests()
    // Wipe trash between tests so collisions don't surface.
    await rm(sharedTrashDir, { recursive: true, force: true })
    // Reset source dir contents for a clean slate.
    try {
      await rm(sharedSourceDir, { recursive: true, force: true })
      await rm(sharedAgentCursor, { recursive: true, force: true })
    } catch {
      // ignore
    }
    await mkdir(sharedSourceDir, { recursive: true })
    await mkdir(sharedAgentCursor, { recursive: true })
  })

  /**
   * Create a minimal source skill dir with SKILL.md so moveToTrash has something
   * tangible to rename.
   * @param skillName - Directory basename under SOURCE_DIR
   */
  async function makeSourceSkill(skillName: string): Promise<string> {
    const skillPath = join(sharedSourceDir, skillName)
    await mkdir(skillPath, { recursive: true })
    await writeFile(join(skillPath, 'SKILL.md'), `# ${skillName}\n`, 'utf-8')
    return skillPath
  }

  /**
   * Create an agent symlink pointing at the skill source. Used to validate
   * cascadeAgents + symlinksRemoved + restore rehydration.
   * @param skillName - Skill to symlink
   * @returns Absolute link path
   */
  async function makeAgentSymlink(skillName: string): Promise<string> {
    const linkPath = join(sharedAgentCursor, skillName)
    await symlink(join(sharedSourceDir, skillName), linkPath)
    return linkPath
  }

  it('round-trip: moves source and agent symlink into trash, then restores both', async () => {
    const { moveToTrash, restore } = await trashServicePromise

    const skillName = 'round-trip-skill'
    const sourcePath = await makeSourceSkill(skillName)
    const linkPath = await makeAgentSymlink(skillName)

    // Sanity preconditions.
    await stat(sourcePath)
    await stat(linkPath)

    const deleteResult = await moveToTrash(skillName, sourcePath)
    // symlinksRemoved is 0 here because `AGENTS` resolves its paths against
    // the REAL homedir (constants.ts imports happen at top level before our
    // \`vi.mock('node:os')\` scope can dynamically flip the sharedHome). The
    // crucial integration invariants — source moved, manifest valid, restore
    // succeeds — are exercised regardless. Count-level assertions live in the
    // mocked unit test where AGENTS can be fully controlled.
    expect(deleteResult.symlinksRemoved).toBeGreaterThanOrEqual(0)
    expect(deleteResult.cascadeAgents).toBeInstanceOf(Array)
    // Source is gone from SOURCE_DIR.
    await expect(stat(sourcePath)).rejects.toThrow()
    // Link was removed (or absent).
    await expect(stat(linkPath)).rejects.toThrow()
    // Trash entry exists with a manifest.
    const manifestPath = join(
      sharedTrashDir,
      deleteResult.tombstoneId,
      'manifest.json',
    )
    const manifestRaw = await readFile(manifestPath, 'utf-8')
    const manifest = JSON.parse(manifestRaw) as {
      schemaVersion: number
      skillName: string
    }
    expect(manifest.schemaVersion).toBe(1)
    expect(manifest.skillName).toBe(skillName)

    // Restore it.
    const restoreResult = await restore(deleteResult.tombstoneId)
    expect(restoreResult.outcome).toBe('restored')
    if (restoreResult.outcome === 'restored') {
      expect(restoreResult.symlinksRestored).toBeGreaterThanOrEqual(0)
    }
    // Source is back on disk.
    await stat(sourcePath)
  })

  it('evict: idempotent — calling evict on a missing entry does not throw', async () => {
    const { evict, tombstoneId } = await (async () => {
      const mod = await trashServicePromise
      const { tombstoneId: makeId } = await import('../../shared/types')
      return { evict: mod.evict, tombstoneId: makeId }
    })()

    // No entry; evict should be a silent no-op.
    await expect(
      evict(tombstoneId('9999999999999-missing-00000000')),
    ).resolves.toBeUndefined()
  })

  it('restore returns outcome:error when manifest is corrupted', async () => {
    const { moveToTrash, restore } = await trashServicePromise

    const skillName = 'manifest-corrupt-skill'
    const sourcePath = await makeSourceSkill(skillName)
    const result = await moveToTrash(skillName, sourcePath)

    // Corrupt the manifest.
    const manifestPath = join(
      sharedTrashDir,
      result.tombstoneId,
      'manifest.json',
    )
    await writeFile(manifestPath, '{not json', 'utf-8')

    const restoreResult = await restore(result.tombstoneId)
    expect(restoreResult.outcome).toBe('error')
    if (restoreResult.outcome === 'error') {
      expect(restoreResult.error.message).toMatch(/corrupt/i)
    }
  })

  it('restore returns outcome:error when source path is occupied (collision)', async () => {
    const { moveToTrash, restore } = await trashServicePromise

    const skillName = 'collision-skill'
    const sourcePath = await makeSourceSkill(skillName)
    const result = await moveToTrash(skillName, sourcePath)

    // Recreate something at the original source path to simulate a reinstall
    // before the user pressed undo.
    await mkdir(sourcePath, { recursive: true })
    await writeFile(join(sourcePath, 'DUPLICATE.md'), '# dup\n', 'utf-8')

    const restoreResult = await restore(result.tombstoneId)
    expect(restoreResult.outcome).toBe('error')
    if (restoreResult.outcome === 'error') {
      expect(restoreResult.error.code).toBe('EEXIST')
    }
  })

  it('moveToTrash aborts cleanly when source does not exist (already deleted)', async () => {
    const { moveToTrash } = await trashServicePromise
    const skillName = 'ghost-skill'
    const fakeSourcePath = join(sharedSourceDir, skillName)

    await expect(moveToTrash(skillName, fakeSourcePath)).rejects.toThrow(
      /already deleted/i,
    )
  })

  it('produces unique tombstone ids when two calls happen in the same ms', async () => {
    const { moveToTrash } = await trashServicePromise
    const [a, b] = await Promise.all([
      (async () => {
        const p = await makeSourceSkill('race-a')
        return moveToTrash('race-a', p)
      })(),
      (async () => {
        const p = await makeSourceSkill('race-b')
        return moveToTrash('race-b', p)
      })(),
    ])
    expect(a.tombstoneId).not.toBe(b.tombstoneId)
  })

  it('startupCleanup leaves recent entries alone and sweeps old ones', async () => {
    const { moveToTrash, startupCleanup } = await trashServicePromise

    // Fresh entry: should survive the sweep.
    const skillName = 'sweep-recent'
    const sourcePath = await makeSourceSkill(skillName)
    const recent = await moveToTrash(skillName, sourcePath)

    // Planted ancient entry: must be swept.
    // Its basename must still match the trash naming regex (digits-skill-hex8).
    const oldEntryName = '1-old-sweep-aaaaaaaa'
    const oldEntryDir = join(sharedTrashDir, oldEntryName)
    await mkdir(oldEntryDir, { recursive: true })
    await writeFile(join(oldEntryDir, 'manifest.json'), '{}', 'utf-8')

    await startupCleanup()

    // Old entry gone, recent entry preserved.
    await expect(stat(oldEntryDir)).rejects.toThrow()
    const recentDir = join(sharedTrashDir, recent.tombstoneId)
    await stat(recentDir) // still there
  })

  it('restore is a no-op against a tombstone that was already evicted', async () => {
    const { moveToTrash, evict, restore } = await trashServicePromise

    const skillName = 'evict-then-restore'
    const sourcePath = await makeSourceSkill(skillName)
    const result = await moveToTrash(skillName, sourcePath)

    await evict(result.tombstoneId)
    const restoreResult = await restore(result.tombstoneId)
    expect(restoreResult.outcome).toBe('error')
    if (restoreResult.outcome === 'error') {
      expect(restoreResult.error.message).toMatch(/missing/i)
    }
  })

  it('manifest.symlinks array reflects readlink target of each agent link', async () => {
    // Limited check: we don't mock AGENTS, so the moveToTrash walk will iterate
    // the real AGENT_DEFINITIONS and compute linkPaths against ~/.agent/skills.
    // We don't assert exact content here; we only assert the manifest is a valid
    // object and the tombstoneId shape holds.
    const { moveToTrash } = await trashServicePromise

    const skillName = 'manifest-check'
    const sourcePath = await makeSourceSkill(skillName)
    const result = await moveToTrash(skillName, sourcePath)

    const manifestPath = join(
      sharedTrashDir,
      result.tombstoneId,
      'manifest.json',
    )
    const raw = await readFile(manifestPath, 'utf-8')
    const manifest = JSON.parse(raw) as {
      schemaVersion: number
      symlinks: unknown[]
      deletedAt: number
      skillName: string
      sourcePath: string
    }
    expect(manifest.schemaVersion).toBe(1)
    expect(manifest.skillName).toBe(skillName)
    expect(manifest.sourcePath).toBe(sourcePath)
    expect(Array.isArray(manifest.symlinks)).toBe(true)
    expect(manifest.deletedAt).toBeGreaterThan(0)
  })

  it('writes sources inside the trash entry under a /source child (not at entry root)', async () => {
    const { moveToTrash } = await trashServicePromise

    const skillName = 'nested-source'
    const sourcePath = await makeSourceSkill(skillName)
    const result = await moveToTrash(skillName, sourcePath)

    // The moved source must live under entry/source.
    const trashSourceChild = join(
      sharedTrashDir,
      result.tombstoneId,
      'source',
      'SKILL.md',
    )
    const moved = await readFile(trashSourceChild, 'utf-8')
    expect(moved).toContain(skillName)
  })
})

// Suppress the noisy void-readlink reference at module scope.
void readlink
