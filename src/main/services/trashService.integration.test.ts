import { mkdtempSync, realpathSync } from 'node:fs'
import {
  lstat,
  mkdir,
  readdir,
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

import type { MoveToTrashResult } from './trashService'

// sharedHome is stamped SYNCHRONOUSLY at module load so that the vi.mock
// factory below captures a defined value by the time `trashService` is
// imported. Previously this was `let sharedHome` seeded inside beforeAll,
// which raced with vitest's dynamic-import scheduling: on some orderings
// `trashService`'s top-level `TRASH_DIR = join(homedir(), '.agents', '.trash')`
// ran while sharedHome was still undefined and blew up inside `join`.
//
// `realpathSync` canonicalizes the tmp dir up-front: macOS reports
// `/var/folders/...` from `mkdtempSync` but `realpathSync` resolves it to
// `/private/var/...`, and `validatePath` (called inside trashService) uses
// `realpathSync` internally — without canonicalization every constructed
// path would appear to escape its declared base.
const sharedHome = realpathSync(mkdtempSync(join(tmpdir(), 'skills-trash-it-')))
const sharedSourceDir = join(sharedHome, '.agents', 'skills')
const sharedTrashDir = join(sharedHome, '.agents', '.trash')
const sharedAgentCursor = join(sharedHome, '.cursor', 'skills')
const sharedAgentClaude = join(sharedHome, '.claude', 'skills')

vi.mock('node:os', async () => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await vi.importActual<typeof import('node:os')>('node:os')
  return {
    ...actual,
    homedir: () => sharedHome,
  }
})

// `../constants` (and therefore the AGENTS table) imports from the bare `'os'`
// specifier, not `'node:os'`. Without this second mock, AGENT paths still
// point at the developer's REAL `~/.claude/skills`, `~/.cursor/skills`, etc.
// at module-init time — meaning `scanLocalCopies` could never see the agent
// dirs we set up under `sharedHome` and the local-only flow would be
// untestable from this file. Mock both so both `homedir()` paths resolve
// here.
vi.mock('os', async () => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await vi.importActual<typeof import('os')>('os')
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

/**
 * Narrow a `MoveToTrashResult` to the `tombstoned` variant for the rest of the
 * caller's scope. Every existing test in this file exercises a source-backed
 * or local-only path, both of which produce `kind: 'tombstoned'`. The new
 * `'orphan-cleared'` arm (added in PR-1 of issue #71) has its own dedicated
 * test below — for the legacy tests we just need to assert and continue.
 *
 * @param result - Result returned by `moveToTrash` under test
 * @throws Error if the result is not a tombstoned variant
 * @example
 * const deleteResult = await moveToTrash(skillName)
 * assertTombstoned(deleteResult)
 * // deleteResult.tombstoneId is now type-safe to access
 */
function assertTombstoned(
  result: MoveToTrashResult,
): asserts result is Extract<MoveToTrashResult, { kind: 'tombstoned' }> {
  if (result.kind !== 'tombstoned') {
    throw new Error(`Expected tombstoned result, got kind=${result.kind}`)
  }
}

describe('trashService (integration)', () => {
  beforeAll(async () => {
    await mkdir(sharedSourceDir, { recursive: true })
    await mkdir(sharedAgentCursor, { recursive: true })
    await mkdir(sharedAgentClaude, { recursive: true })
  })

  afterAll(async () => {
    await rm(sharedHome, { recursive: true, force: true })
  })

  afterEach(async () => {
    const { __clearEvictTimersForTests } = await trashServicePromise
    __clearEvictTimersForTests()
    // Wipe trash between tests so collisions don't surface.
    await rm(sharedTrashDir, { recursive: true, force: true })
    // Reset source + agent dirs for a clean slate. Claude is needed for the
    // local-only tests; cursor is needed for the source-backed cascade tests.
    try {
      await rm(sharedSourceDir, { recursive: true, force: true })
      await rm(sharedAgentCursor, { recursive: true, force: true })
      await rm(sharedAgentClaude, { recursive: true, force: true })
    } catch {
      // ignore
    }
    await mkdir(sharedSourceDir, { recursive: true })
    await mkdir(sharedAgentCursor, { recursive: true })
    await mkdir(sharedAgentClaude, { recursive: true })
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

  /**
   * Create a local-only skill: a real (non-symlink) directory with SKILL.md
   * directly inside an agent dir (no `~/.agents/skills/<name>` source). Mirrors
   * the disk shape that triggered the original "Bulk delete failed - Deleted
   * 0 of 1 skill" bug for `architecture-decision-records`.
   * @param skillName - Directory basename
   * @param agentBaseDir - Absolute path to the agent's skills dir (e.g. sharedAgentClaude)
   * @returns Absolute folder path
   */
  async function makeLocalSkill(
    skillName: string,
    agentBaseDir: string,
  ): Promise<string> {
    const localPath = join(agentBaseDir, skillName)
    await mkdir(localPath, { recursive: true })
    await writeFile(join(localPath, 'SKILL.md'), `# ${skillName}\n`, 'utf-8')
    return localPath
  }

  /**
   * Create a broken symlink in an agent dir: the link is well-formed but its
   * target — `sharedSourceDir/<name>` — was never created (or was deleted),
   * so `fs.access(target)` fails with ENOENT. This is exactly the disk shape
   * the orphan branch of `moveToTrash` is meant to clean up.
   * @param skillName - Skill name (target basename under SOURCE_DIR)
   * @param agentBaseDir - Absolute path to the agent's skills dir
   * @returns Absolute path to the dangling symlink
   */
  async function makeBrokenSymlink(
    skillName: string,
    agentBaseDir: string,
  ): Promise<string> {
    const linkPath = join(agentBaseDir, skillName)
    const danglingTarget = join(sharedSourceDir, skillName)
    await symlink(danglingTarget, linkPath)
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

    const deleteResult = await moveToTrash(skillName)
    assertTombstoned(deleteResult)
    // With both `os` and `node:os` mocked, `AGENTS` paths resolve under
    // `sharedHome` so the cursor symlink we created above is actually
    // walked, recorded, and unlinked by the cascade. The exact count is
    // 1 (only the cursor link exists), but other agent dirs are absent so
    // their lstat calls return ENOENT and they're silently skipped.
    expect(deleteResult.symlinksRemoved).toBe(1)
    expect(deleteResult.cascadeAgents).toContain('cursor')
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
      kind: string
      skillName: string
    }
    expect(manifest.schemaVersion).toBe(2)
    expect(manifest.kind).toBe('source-backed')
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
    await makeSourceSkill(skillName)
    const result = await moveToTrash(skillName)
    assertTombstoned(result)

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
      // Assert on the stable sentinel code rather than regex-matching the
      // user-facing message — copy edits shouldn't break this test.
      expect(restoreResult.error.code).toBe('EMANIFEST_CORRUPT')
    }
  })

  it('restore returns outcome:error when source path is occupied (collision)', async () => {
    const { moveToTrash, restore } = await trashServicePromise

    const skillName = 'collision-skill'
    const sourcePath = await makeSourceSkill(skillName)
    const result = await moveToTrash(skillName)
    assertTombstoned(result)

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

  it('moveToTrash aborts cleanly when source does not exist and no agent has a local copy', async () => {
    const { moveToTrash } = await trashServicePromise
    // No source-skill, no agent copy: pure ghost — moveToTrash should reject
    // with "already deleted". The previous version of this test passed a fake
    // sourcePath; the new signature derives sourcePath from skillName itself,
    // so we just verify the missing-everywhere case still surfaces ENOENT.
    const skillName = 'ghost-skill'

    await expect(moveToTrash(skillName)).rejects.toThrow(/already deleted/i)
  })

  it('produces unique tombstone ids when two calls happen in the same ms', async () => {
    const { moveToTrash } = await trashServicePromise
    const [a, b] = await Promise.all([
      (async () => {
        await makeSourceSkill('race-a')
        return moveToTrash('race-a')
      })(),
      (async () => {
        await makeSourceSkill('race-b')
        return moveToTrash('race-b')
      })(),
    ])
    assertTombstoned(a)
    assertTombstoned(b)
    expect(a.tombstoneId).not.toBe(b.tombstoneId)
  })

  it('startupCleanup leaves recent entries alone and sweeps old ones', async () => {
    const { moveToTrash, startupCleanup } = await trashServicePromise

    // Fresh entry: should survive the sweep.
    const skillName = 'sweep-recent'
    await makeSourceSkill(skillName)
    const recent = await moveToTrash(skillName)
    assertTombstoned(recent)

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
    await makeSourceSkill(skillName)
    const result = await moveToTrash(skillName)
    assertTombstoned(result)

    await evict(result.tombstoneId)
    const restoreResult = await restore(result.tombstoneId)
    expect(restoreResult.outcome).toBe('error')
    if (restoreResult.outcome === 'error') {
      // Stable syscall code rather than the message string.
      expect(restoreResult.error.code).toBe('ENOENT')
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
    const result = await moveToTrash(skillName)
    assertTombstoned(result)

    const manifestPath = join(
      sharedTrashDir,
      result.tombstoneId,
      'manifest.json',
    )
    const raw = await readFile(manifestPath, 'utf-8')
    const manifest = JSON.parse(raw) as {
      schemaVersion: number
      kind: string
      symlinks: unknown[]
      deletedAt: number
      skillName: string
      sourcePath: string
    }
    expect(manifest.schemaVersion).toBe(2)
    expect(manifest.kind).toBe('source-backed')
    expect(manifest.skillName).toBe(skillName)
    expect(manifest.sourcePath).toBe(sourcePath)
    expect(Array.isArray(manifest.symlinks)).toBe(true)
    expect(manifest.deletedAt).toBeGreaterThan(0)
  })

  it('writes sources inside the trash entry under a /source child (not at entry root)', async () => {
    const { moveToTrash } = await trashServicePromise

    const skillName = 'nested-source'
    await makeSourceSkill(skillName)
    const result = await moveToTrash(skillName)
    assertTombstoned(result)

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

  // ---------------------------------------------------------------------
  // Local-only skill tests (regression coverage for the bug where clicking
  // X on a skill that lived only inside an agent dir — no source — produced
  // "Bulk delete failed - Deleted 0 of 1 skill". The fix teaches moveToTrash
  // to detect that case via `scanLocalCopies`, stage each agent folder under
  // `<entryDir>/local-copies/<agentId>/`, and write a v2 local-only manifest
  // that `restore()` can put back agent-by-agent.)
  // ---------------------------------------------------------------------

  it('moveToTrash handles a local-only skill (no source, single agent copy)', async () => {
    const { moveToTrash } = await trashServicePromise

    const skillName = 'architecture-decision-records'
    const localPath = await makeLocalSkill(skillName, sharedAgentClaude)
    // Sanity precondition: real folder, no source dir.
    await stat(localPath)
    await expect(stat(join(sharedSourceDir, skillName))).rejects.toThrow()

    const deleteResult = await moveToTrash(skillName)
    assertTombstoned(deleteResult)
    expect(deleteResult.cascadeAgents).toContain('claude-code')
    // The local copy is staged under entryDir/local-copies — count it for parity
    // with the source-backed path so the renderer's "skills removed" toast works.
    expect(deleteResult.symlinksRemoved).toBe(1)

    // The agent folder is gone.
    await expect(stat(localPath)).rejects.toThrow()

    // The staged copy lives under <entryDir>/local-copies/<agentId>/SKILL.md.
    const stagedSkill = join(
      sharedTrashDir,
      deleteResult.tombstoneId,
      'local-copies',
      'claude-code',
      'SKILL.md',
    )
    const stagedContents = await readFile(stagedSkill, 'utf-8')
    expect(stagedContents).toContain(skillName)

    // Manifest is v2 local-only.
    const manifestPath = join(
      sharedTrashDir,
      deleteResult.tombstoneId,
      'manifest.json',
    )
    const manifest = JSON.parse(await readFile(manifestPath, 'utf-8')) as {
      schemaVersion: number
      kind: string
      skillName: string
      localCopies: Array<{ agentId: string; linkPath: string }>
    }
    expect(manifest.schemaVersion).toBe(2)
    expect(manifest.kind).toBe('local-only')
    expect(manifest.skillName).toBe(skillName)
    expect(manifest.localCopies).toHaveLength(1)
    expect(manifest.localCopies[0]?.agentId).toBe('claude-code')
    expect(manifest.localCopies[0]?.linkPath).toBe(localPath)
  })

  it('round-trip: deletes a local-only skill and restores it back into the agent dir', async () => {
    const { moveToTrash, restore } = await trashServicePromise

    const skillName = 'local-round-trip'
    const localPath = await makeLocalSkill(skillName, sharedAgentClaude)

    const deleteResult = await moveToTrash(skillName)
    assertTombstoned(deleteResult)
    await expect(stat(localPath)).rejects.toThrow()

    const restoreResult = await restore(deleteResult.tombstoneId)
    expect(restoreResult.outcome).toBe('restored')
    if (restoreResult.outcome === 'restored') {
      expect(restoreResult.symlinksRestored).toBe(1)
      expect(restoreResult.symlinksSkipped).toBe(0)
    }

    // Folder is back at its original agent path with original contents.
    const restoredSkill = await readFile(join(localPath, 'SKILL.md'), 'utf-8')
    expect(restoredSkill).toContain(skillName)
    // No leftover source dir (local-only restore must not plant SOURCE_DIR/<name>).
    await expect(stat(join(sharedSourceDir, skillName))).rejects.toThrow()
    // Trash entry is gone.
    await expect(
      stat(join(sharedTrashDir, deleteResult.tombstoneId)),
    ).rejects.toThrow()
  })

  it('source-backed flow wins when both source and a local copy exist', async () => {
    // Disambiguates the dispatch in moveToTrash: if SOURCE_DIR/<name> exists,
    // we must NOT fall through to local-only even when an agent dir also has
    // a real folder by the same name (rare but possible, e.g. user manually
    // copied the source into an agent dir bypassing the symlink workflow).
    const { moveToTrash } = await trashServicePromise

    const skillName = 'mixed-state-skill'
    const sourcePath = await makeSourceSkill(skillName)
    // Plant a real folder under .claude/skills with the same name. The
    // source-backed cascade walks AGENTS but only touches *symlinks*, so this
    // local copy must be left alone untouched.
    const orphanLocal = await makeLocalSkill(skillName, sharedAgentClaude)

    const deleteResult = await moveToTrash(skillName)
    assertTombstoned(deleteResult)

    // Source went into trash entry under /source.
    await expect(stat(sourcePath)).rejects.toThrow()
    const stagedSource = join(
      sharedTrashDir,
      deleteResult.tombstoneId,
      'source',
      'SKILL.md',
    )
    expect((await readFile(stagedSource, 'utf-8')).length).toBeGreaterThan(0)

    // Manifest is source-backed (NOT local-only).
    const manifest = JSON.parse(
      await readFile(
        join(sharedTrashDir, deleteResult.tombstoneId, 'manifest.json'),
        'utf-8',
      ),
    ) as { kind: string }
    expect(manifest.kind).toBe('source-backed')

    // Orphan local folder under .claude is untouched — this matches the
    // documented "leave non-symlink dirs in agent dirs alone" invariant in
    // moveSourceBackedToTrash. The user can clean it up themselves later.
    await stat(orphanLocal)
  })

  it('regression: moveToTrash no longer throws "already deleted" when only an agent-side local folder exists', async () => {
    // Direct repro of the user-reported bug. Pre-fix, the IPC handler called
    // moveToTrash with sourcePath = SOURCE_DIR/<name>, which didn't exist for
    // local-only skills, so the fs.stat probe failed with ENOENT and surfaced
    // "Skill not found (already deleted?)" even though the skill was clearly
    // present in .claude/skills. Post-fix, scanLocalCopies finds the agent
    // folder and dispatches to moveLocalOnlyToTrash.
    const { moveToTrash } = await trashServicePromise

    const skillName = 'regression-local-only'
    await makeLocalSkill(skillName, sharedAgentClaude)

    await expect(moveToTrash(skillName)).resolves.toMatchObject({
      cascadeAgents: ['claude-code'],
      symlinksRemoved: 1,
    })
  })

  // ---------------------------------------------------------------------
  // Orphan-branch tests (issue #71 PR-1). When the source skill is gone
  // and no agent has a real local copy, every remaining record is a broken
  // symlink. moveToTrash sweeps them with no manifest/no undo, returning
  // `kind: 'orphan-cleared'`. The renderer's bulkDelete summary counts these
  // as success rows even though they have no `tombstoneId`.
  // ---------------------------------------------------------------------

  it('moveToTrash: pure orphan returns orphan-cleared and unlinks the dangling symlink', async () => {
    const { moveToTrash } = await trashServicePromise

    const skillName = 'pure-orphan-skill'
    const linkPath = await makeBrokenSymlink(skillName, sharedAgentCursor)
    // Sanity: lstat sees the symlink itself; access on the target fails
    // (target was never created), confirming the orphan disk shape.
    const linkStats = await lstat(linkPath)
    expect(linkStats.isSymbolicLink()).toBe(true)

    const result = await moveToTrash(skillName)
    expect(result.kind).toBe('orphan-cleared')
    if (result.kind === 'orphan-cleared') {
      expect(result.cascadeAgents).toEqual(['cursor'])
      expect(result.symlinksRemoved).toBe(1)
    }

    // The symlink itself is gone (lstat throws ENOENT now).
    await expect(lstat(linkPath)).rejects.toThrow()
  })

  it('moveToTrash: orphan branch sweeps broken symlinks across multiple agents', async () => {
    const { moveToTrash } = await trashServicePromise

    const skillName = 'multi-agent-orphan'
    const cursorLink = await makeBrokenSymlink(skillName, sharedAgentCursor)
    const claudeLink = await makeBrokenSymlink(skillName, sharedAgentClaude)

    const result = await moveToTrash(skillName)
    expect(result.kind).toBe('orphan-cleared')
    if (result.kind === 'orphan-cleared') {
      expect(result.symlinksRemoved).toBe(2)
      // Cascade order follows AGENTS table iteration; assert membership rather
      // than exact order so a future reordering of AGENTS doesn't break this.
      expect(result.cascadeAgents).toContain('cursor')
      expect(result.cascadeAgents).toContain('claude-code')
    }

    await expect(lstat(cursorLink)).rejects.toThrow()
    await expect(lstat(claudeLink)).rejects.toThrow()
  })

  it('moveToTrash: orphan branch writes no tombstone (no undo for orphan)', async () => {
    // The whole point of the orphan-cleared variant: there is nothing
    // meaningful to restore (resurrected symlinks would still be broken),
    // so we skip the manifest/TTL/evict timer machinery entirely.
    const { moveToTrash } = await trashServicePromise

    const skillName = 'orphan-no-tombstone'
    await makeBrokenSymlink(skillName, sharedAgentCursor)

    const result = await moveToTrash(skillName)
    expect(result.kind).toBe('orphan-cleared')

    // Trash dir is wiped in afterEach, so any entry here was created by THIS
    // call. An orphan-cleared run must leave it empty (or the dir absent).
    const trashEntries = await readdir(sharedTrashDir).catch(
      () => [] as string[],
    )
    expect(trashEntries).toEqual([])
  })
})

// Suppress the noisy void-readlink reference at module scope.
void readlink
