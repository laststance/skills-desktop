import { mkdtempSync, realpathSync } from 'node:fs'
import {
  lstat,
  mkdir,
  readlink,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

/**
 * Restore-flow tests for the manifest target-containment branch added in the
 * review-fixes commit. These tests construct a trash entry + manifest on disk
 * by hand, then invoke `restore()` directly. We skip `moveToTrash` because
 * `validatePath` resolves symlinks (to prevent traversal) which makes it
 * reject live symlinks whose targets legitimately live outside the agent
 * base — the hand-built seam lets us isolate the containment logic.
 */

// mkdtempSync returns `/var/folders/...` on macOS but realpath is
// `/private/var/folders/...`. `validatePath` calls `realpathSync` internally
// so we canonicalize up front; otherwise every path would appear to escape.
const sharedHome = realpathSync(
  mkdtempSync(join(tmpdir(), 'skills-trash-restore-')),
)
const sharedSourceDir = join(sharedHome, '.agents', 'skills')
const sharedClaudeAgent = join(sharedHome, '.claude', 'skills')
const sharedTrashDir = join(sharedHome, '.agents', '.trash')

vi.mock('node:os', async () => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await vi.importActual<typeof import('node:os')>('node:os')
  return {
    ...actual,
    homedir: () => sharedHome,
  }
})

// `../constants` imports from the bare `'os'` specifier, not `'node:os'`.
// Mock both so AGENTS is computed against the tmp home at module init.
vi.mock('os', async () => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await vi.importActual<typeof import('os')>('os')
  return {
    ...actual,
    homedir: () => sharedHome,
  }
})

const trashServicePromise = (async () => import('./trashService'))()

/**
 * Shape of a manifest.symlinks[] entry — mirrors manifestSchema in
 * `ipc/ipc-schemas.ts` closely enough for the test harness without
 * importing the schema (keeps test fully hand-authored).
 */
interface TestSymlinkRecord {
  agentId: string
  linkPath: string
  target: string
}

interface TestLocalCopyRecord {
  agentId: string
  linkPath: string
}

/**
 * Materialize a fake trash entry on disk so `restore()` has something to
 * consume. Returns the tombstoneId the caller should pass to `restore()`.
 * @param params - Shape of the fake entry.
 * @param params.skillName - Skill directory basename.
 * @param params.symlinks - Per-link records to write into manifest.symlinks.
 * @returns The tombstone id (entry basename, matches `tombstoneIdSchema`).
 */
async function buildFakeTrashEntry(params: {
  skillName: string
  symlinks: TestSymlinkRecord[]
}): Promise<string> {
  const { skillName, symlinks } = params
  // Follow the on-disk naming convention: <unix_ms>-<name>-<8hex>.
  const tombstoneId = `${Date.now()}-${skillName}-deadbeef`
  const entryDir = join(sharedTrashDir, tombstoneId)
  const entrySourceDir = join(entryDir, 'source')
  const manifestPath = join(entryDir, 'manifest.json')

  await mkdir(entrySourceDir, { recursive: true })
  await writeFile(join(entrySourceDir, 'SKILL.md'), `# ${skillName}\n`, 'utf-8')

  const manifest = {
    schemaVersion: 1,
    deletedAt: Date.now(),
    skillName,
    sourcePath: join(sharedSourceDir, skillName),
    symlinks,
  }
  await writeFile(manifestPath, JSON.stringify(manifest), 'utf-8')
  return tombstoneId
}

/**
 * Materialize a fake local-only trash entry with staged agent folders.
 * @param params - Skill name and local copy records to stage.
 * @returns The tombstone id that can be passed to restore().
 * @example await buildFakeLocalOnlyTrashEntry({ skillName: 'task', localCopies: [] })
 */
async function buildFakeLocalOnlyTrashEntry(params: {
  skillName: string
  localCopies: TestLocalCopyRecord[]
}): Promise<string> {
  const { skillName, localCopies } = params
  const tombstoneId = `${Date.now()}-${skillName}-feedface`
  const entryDir = join(sharedTrashDir, tombstoneId)
  const localCopiesRoot = join(entryDir, 'local-copies')
  const manifestPath = join(entryDir, 'manifest.json')

  for (const copy of localCopies) {
    const stagedPath = join(localCopiesRoot, copy.agentId)
    await mkdir(stagedPath, { recursive: true })
    await writeFile(join(stagedPath, 'SKILL.md'), `# ${skillName}\n`, 'utf-8')
  }

  const manifest = {
    schemaVersion: 2,
    kind: 'local-only',
    deletedAt: Date.now(),
    skillName,
    localCopies,
  }
  await writeFile(manifestPath, JSON.stringify(manifest), 'utf-8')
  return tombstoneId
}

describe('trashService.restore target-containment', () => {
  beforeAll(async () => {
    await mkdir(sharedSourceDir, { recursive: true })
    await mkdir(sharedClaudeAgent, { recursive: true })
  })

  afterAll(async () => {
    await rm(sharedHome, { recursive: true, force: true })
  })

  afterEach(async () => {
    const { __clearEvictTimersForTests } = await trashServicePromise
    __clearEvictTimersForTests()
    await rm(sharedTrashDir, { recursive: true, force: true })
    await rm(sharedSourceDir, { recursive: true, force: true })
    await rm(sharedClaudeAgent, { recursive: true, force: true })
    await rm(join(sharedHome, '.config'), { recursive: true, force: true })
    await rm(join(sharedHome, 'dotfiles'), { recursive: true, force: true })
    await mkdir(sharedSourceDir, { recursive: true })
    await mkdir(sharedClaudeAgent, { recursive: true })
  })

  it('restores a symlink whose absolute target legitimately lives inside SOURCE_DIR', async () => {
    // Arrange
    // Control case. Without this passing, every "should skip" case below is
    // meaningless — if the happy path plants nothing we're testing a broken
    // pipeline rather than the containment check.
    const { restore } = await trashServicePromise
    const skillName = 'baseline-skill'
    const linkPath = join(sharedClaudeAgent, skillName)
    const target = join(sharedSourceDir, skillName)
    const tombstone = await buildFakeTrashEntry({
      skillName,
      symlinks: [{ agentId: 'claude-code', linkPath, target }],
    })

    // Act
    const result = await restore(tombstone as never)

    // Assert
    expect(result.outcome).toBe('restored')
    if (result.outcome === 'restored') {
      expect(result.symlinksRestored).toBeGreaterThanOrEqual(1)
    }
    // Source dir re-planted.
    await stat(join(sharedSourceDir, skillName))
    // Symlink re-planted.
    await stat(linkPath)
  })

  it('refuses source-backed restore when a dangling symlink occupies the source path', async () => {
    // Arrange
    const { restore } = await trashServicePromise
    const skillName = 'source-path-dangling-collision'
    const linkPath = join(sharedClaudeAgent, skillName)
    const sourcePath = join(sharedSourceDir, skillName)
    const tombstone = await buildFakeTrashEntry({
      skillName,
      symlinks: [{ agentId: 'claude-code', linkPath, target: sourcePath }],
    })
    await symlink(join(sharedSourceDir, 'missing-target'), sourcePath)

    // Act
    const result = await restore(tombstone as never)

    // Assert
    expect(result).toEqual({
      outcome: 'error',
      error: {
        message: 'A skill already exists at the original path',
        code: 'EEXIST',
      },
    })
    expect((await lstat(sourcePath)).isSymbolicLink()).toBe(true)
    await expect(readlink(sourcePath)).resolves.toBe(
      join(sharedSourceDir, 'missing-target'),
    )
    await expect(
      stat(join(sharedTrashDir, tombstone, 'source', 'SKILL.md')),
    ).resolves.toBeTruthy()
  })

  it('restores a Devin symlink whose relative target depends on physical .config parent', async () => {
    // Arrange
    const { restore } = await trashServicePromise
    const skillName = 'devin-relative-restore'
    const physicalConfigDir = join(sharedHome, 'dotfiles', '.config')
    const physicalDevinSkillsDir = join(physicalConfigDir, 'devin', 'skills')
    const logicalConfigDir = join(sharedHome, '.config')
    const logicalDevinSkillsDir = join(logicalConfigDir, 'devin', 'skills')
    const linkPath = join(logicalDevinSkillsDir, skillName)
    const target = relative(
      physicalDevinSkillsDir,
      join(sharedSourceDir, skillName),
    )
    await mkdir(physicalDevinSkillsDir, { recursive: true })
    await symlink(physicalConfigDir, logicalConfigDir)
    const tombstone = await buildFakeTrashEntry({
      skillName,
      symlinks: [{ agentId: 'devin', linkPath, target }],
    })

    // Act
    const result = await restore(tombstone as never)

    // Assert
    expect(result.outcome).toBe('restored')
    if (result.outcome === 'restored') {
      expect(result.symlinksRestored).toBeGreaterThanOrEqual(1)
    }
    expect((await lstat(linkPath)).isSymbolicLink()).toBe(true)
    await expect(readlink(linkPath)).resolves.toBe(target)
    await expect(stat(join(sharedSourceDir, skillName))).resolves.toBeTruthy()
  })

  it('recreates a missing agent skills parent before restoring a recorded symlink', async () => {
    // Arrange
    const { restore } = await trashServicePromise
    const skillName = 'missing-agent-parent'
    const linkPath = join(sharedClaudeAgent, skillName)
    const target = join(sharedSourceDir, skillName)
    const tombstone = await buildFakeTrashEntry({
      skillName,
      symlinks: [{ agentId: 'claude-code', linkPath, target }],
    })
    await rm(sharedClaudeAgent, { recursive: true, force: true })

    // Act
    const result = await restore(tombstone as never)

    // Assert
    expect(result.outcome).toBe('restored')
    if (result.outcome === 'restored') {
      expect(result.symlinksRestored).toBe(1)
      expect(result.symlinksSkipped).toBe(0)
    }
    expect((await lstat(linkPath)).isSymbolicLink()).toBe(true)
    await expect(readlink(linkPath)).resolves.toBe(target)
  })

  it('refuses to plant a tampered symlink whose absolute target escapes SOURCE_DIR', async () => {
    // Arrange
    const { restore } = await trashServicePromise
    const skillName = 'target-abs-escape'
    const linkPath = join(sharedClaudeAgent, skillName)
    const tombstone = await buildFakeTrashEntry({
      skillName,
      symlinks: [{ agentId: 'claude-code', linkPath, target: '/etc/passwd' }],
    })

    // Act
    const result = await restore(tombstone as never)

    // Assert
    expect(result.outcome).toBe('restored')
    if (result.outcome === 'restored') {
      // Containment check must skip this link — 0 restored, 1 skipped.
      expect(result.symlinksRestored).toBe(0)
      expect(result.symlinksSkipped).toBeGreaterThanOrEqual(1)
    }
    await expect(stat(linkPath)).rejects.toThrow()
  })

  it('refuses to plant a tampered symlink whose relative target traverses out of SOURCE_DIR', async () => {
    // Arrange
    const { restore } = await trashServicePromise
    const skillName = 'target-rel-escape'
    const linkPath = join(sharedClaudeAgent, skillName)
    // Relative `../../../..` resolved against `dirname(linkPath)` (the agent
    // dir) climbs well outside SOURCE_DIR — classic symlink-based escape.
    const tombstone = await buildFakeTrashEntry({
      skillName,
      symlinks: [
        {
          agentId: 'claude-code',
          linkPath,
          target: '../../../../../etc/passwd',
        },
      ],
    })

    // Act
    const result = await restore(tombstone as never)

    // Assert
    expect(result.outcome).toBe('restored')
    if (result.outcome === 'restored') {
      expect(result.symlinksRestored).toBe(0)
      expect(result.symlinksSkipped).toBeGreaterThanOrEqual(1)
    }
    await expect(stat(linkPath)).rejects.toThrow()
  })

  it('refuses to plant a tampered symlink that points inside homedir but outside SOURCE_DIR', async () => {
    // Arrange
    const { restore } = await trashServicePromise
    const skillName = 'target-sibling-dir'
    const linkPath = join(sharedClaudeAgent, skillName)
    // Target lives inside the test home but outside SOURCE_DIR — the old
    // code accepted this; the containment check must reject it.
    const tombstone = await buildFakeTrashEntry({
      skillName,
      symlinks: [
        {
          agentId: 'claude-code',
          linkPath,
          target: join(sharedClaudeAgent, 'unrelated-skill'),
        },
      ],
    })

    // Act
    const result = await restore(tombstone as never)

    // Assert
    expect(result.outcome).toBe('restored')
    if (result.outcome === 'restored') {
      expect(result.symlinksRestored).toBe(0)
      expect(result.symlinksSkipped).toBeGreaterThanOrEqual(1)
    }
    await expect(stat(linkPath)).rejects.toThrow()
  })

  it('plants the legit link and skips the tampered one when a manifest mixes both', async () => {
    // Arrange
    // Belt-and-suspenders: a manifest with one legit + one tampered entry
    // must plant exactly one link. Catches regressions where the check
    // accidentally short-circuits the whole loop on the first bad entry.
    const { restore } = await trashServicePromise
    const skillName = 'mixed-manifest'
    const linkPathA = join(sharedClaudeAgent, skillName)
    const linkPathB = join(sharedHome, '.cursor', 'skills', skillName)
    await mkdir(join(sharedHome, '.cursor', 'skills'), { recursive: true })

    const tombstone = await buildFakeTrashEntry({
      skillName,
      symlinks: [
        {
          agentId: 'claude-code',
          linkPath: linkPathA,
          target: join(sharedSourceDir, skillName), // legit
        },
        {
          agentId: 'cursor',
          linkPath: linkPathB,
          target: '/etc/passwd', // tampered
        },
      ],
    })

    // Act
    const result = await restore(tombstone as never)

    // Assert
    expect(result.outcome).toBe('restored')
    if (result.outcome === 'restored') {
      expect(result.symlinksRestored).toBe(1)
      expect(result.symlinksSkipped).toBeGreaterThanOrEqual(1)
    }
    await stat(linkPathA)
    await expect(stat(linkPathB)).rejects.toThrow()
  })

  it('skips a recorded symlink whose agent id no longer exists in the agent registry', async () => {
    // Arrange
    // A tampered/stale manifest names an agent that is not in AGENTS; that record
    // must be skipped without aborting the rest of the restore.
    const { restore } = await trashServicePromise
    const skillName = 'unknown-agent-skip'
    const linkPath = join(sharedClaudeAgent, skillName)
    const tombstone = await buildFakeTrashEntry({
      skillName,
      symlinks: [
        {
          agentId: 'this-agent-does-not-exist',
          linkPath,
          target: join(sharedSourceDir, skillName),
        },
      ],
    })

    // Act
    const result = await restore(tombstone as never)

    // Assert
    expect(result.outcome).toBe('restored')
    if (result.outcome === 'restored') {
      expect(result.symlinksRestored).toBe(0)
      expect(result.symlinksSkipped).toBe(1)
    }
    // The source is still restored even though no symlink was planted.
    await stat(join(sharedSourceDir, skillName))
    await expect(stat(linkPath)).rejects.toThrow()
  })

  it('skips a recorded symlink whose link path falls outside its declared agent directory', async () => {
    // Arrange
    // The manifest claims agent 'claude-code' but the linkPath lives outside the
    // claude-code base, so the per-link validation skips it.
    const { restore } = await trashServicePromise
    const skillName = 'linkpath-escapes-agent'
    const escapingLinkPath = join(sharedHome, '.cursor', 'skills', skillName)
    await mkdir(join(sharedHome, '.cursor', 'skills'), { recursive: true })
    const tombstone = await buildFakeTrashEntry({
      skillName,
      symlinks: [
        {
          agentId: 'claude-code',
          linkPath: escapingLinkPath,
          target: join(sharedSourceDir, skillName),
        },
      ],
    })

    // Act
    const result = await restore(tombstone as never)

    // Assert
    expect(result.outcome).toBe('restored')
    if (result.outcome === 'restored') {
      expect(result.symlinksRestored).toBe(0)
      expect(result.symlinksSkipped).toBe(1)
    }
    await stat(join(sharedSourceDir, skillName))
    await expect(stat(escapingLinkPath)).rejects.toThrow()
  })

  it('skips a recorded symlink whose source target no longer exists on disk', async () => {
    // Arrange
    // The target resolves inside SOURCE_DIR (passes containment) but the file is
    // absent, so the existence probe skips the link instead of planting a
    // dangling symlink.
    const { restore } = await trashServicePromise
    const skillName = 'target-absent-skip'
    const linkPath = join(sharedClaudeAgent, skillName)
    const tombstone = await buildFakeTrashEntry({
      skillName,
      symlinks: [
        {
          agentId: 'claude-code',
          linkPath,
          target: join(sharedSourceDir, 'absent-target-name'),
        },
      ],
    })

    // Act
    const result = await restore(tombstone as never)

    // Assert
    expect(result.outcome).toBe('restored')
    if (result.outcome === 'restored') {
      expect(result.symlinksRestored).toBe(0)
      expect(result.symlinksSkipped).toBe(1)
    }
    await stat(join(sharedSourceDir, skillName))
    await expect(stat(linkPath)).rejects.toThrow()
  })

  it('skips a recorded symlink whose agent slot is already occupied', async () => {
    // Arrange
    // The target exists and is valid, but something already sits at linkPath, so
    // restore must skip rather than overwrite the existing entry.
    const { restore } = await trashServicePromise
    const skillName = 'slot-occupied-skip'
    const linkPath = join(sharedClaudeAgent, skillName)
    const tombstone = await buildFakeTrashEntry({
      skillName,
      symlinks: [
        {
          agentId: 'claude-code',
          linkPath,
          target: join(sharedSourceDir, skillName),
        },
      ],
    })
    // Pre-occupy the destination so the free-slot lstat succeeds.
    await mkdir(linkPath, { recursive: true })
    await writeFile(join(linkPath, 'SKILL.md'), '# occupied\n', 'utf-8')

    // Act
    const result = await restore(tombstone as never)

    // Assert
    expect(result.outcome).toBe('restored')
    if (result.outcome === 'restored') {
      expect(result.symlinksRestored).toBe(0)
      expect(result.symlinksSkipped).toBe(1)
    }
    // The pre-existing folder is untouched, not replaced by a symlink.
    expect((await lstat(linkPath)).isDirectory()).toBe(true)
  })

  it('skips a local-only copy whose agent id no longer exists in the agent registry', async () => {
    // Arrange
    // A local-only manifest names an unknown agent; that staged copy is skipped
    // and the entry is kept for manual recovery.
    const { restore } = await trashServicePromise
    const skillName = 'local-unknown-agent'
    const linkPath = join(sharedClaudeAgent, skillName)
    const tombstone = await buildFakeLocalOnlyTrashEntry({
      skillName,
      localCopies: [{ agentId: 'this-agent-does-not-exist', linkPath }],
    })

    // Act
    const result = await restore(tombstone as never)

    // Assert
    expect(result.outcome).toBe('restored')
    if (result.outcome === 'restored') {
      expect(result.symlinksRestored).toBe(0)
      expect(result.symlinksSkipped).toBe(1)
    }
    // The staged copy is preserved under the entry for manual recovery.
    const entryDir = join(sharedTrashDir, tombstone)
    await expect(stat(entryDir)).resolves.toBeTruthy()
  })

  it('skips a local-only copy whose link path falls outside its declared agent directory', async () => {
    // Arrange
    // The manifest claims agent 'claude-code' but the linkPath escapes that base,
    // so the validation skips restoring the staged folder.
    const { restore } = await trashServicePromise
    const skillName = 'local-linkpath-escapes'
    const escapingLinkPath = join(sharedHome, '.cursor', 'skills', skillName)
    await mkdir(join(sharedHome, '.cursor', 'skills'), { recursive: true })
    const tombstone = await buildFakeLocalOnlyTrashEntry({
      skillName,
      localCopies: [{ agentId: 'claude-code', linkPath: escapingLinkPath }],
    })

    // Act
    const result = await restore(tombstone as never)

    // Assert
    expect(result.outcome).toBe('restored')
    if (result.outcome === 'restored') {
      expect(result.symlinksRestored).toBe(0)
      expect(result.symlinksSkipped).toBe(1)
    }
    await expect(stat(escapingLinkPath)).rejects.toThrow()
  })

  it('skips a local-only copy whose destination agent slot is already occupied', async () => {
    // Arrange
    // Something already sits at the destination linkPath, so the free-slot lstat
    // succeeds and restore skips rather than overwriting it.
    const { restore } = await trashServicePromise
    const skillName = 'local-slot-occupied'
    const linkPath = join(sharedClaudeAgent, skillName)
    const tombstone = await buildFakeLocalOnlyTrashEntry({
      skillName,
      localCopies: [{ agentId: 'claude-code', linkPath }],
    })
    await mkdir(linkPath, { recursive: true })
    await writeFile(join(linkPath, 'SKILL.md'), '# occupied\n', 'utf-8')

    // Act
    const result = await restore(tombstone as never)

    // Assert
    expect(result.outcome).toBe('restored')
    if (result.outcome === 'restored') {
      expect(result.symlinksRestored).toBe(0)
      expect(result.symlinksSkipped).toBe(1)
    }
    expect((await lstat(linkPath)).isDirectory()).toBe(true)
    await expect(stat(join(linkPath, 'SKILL.md'))).resolves.toBeTruthy()
  })

  it('keeps local-only staged folders when destination collision skips restore', async () => {
    // Arrange
    const { restore } = await trashServicePromise
    const skillName = 'local-partial-restore'
    const linkPath = join(sharedClaudeAgent, skillName)
    const tombstone = await buildFakeLocalOnlyTrashEntry({
      skillName,
      localCopies: [{ agentId: 'claude-code', linkPath }],
    })
    await mkdir(linkPath, { recursive: true })
    await writeFile(join(linkPath, 'SKILL.md'), '# occupied\n', 'utf-8')

    // Act
    const result = await restore(tombstone as never)

    // Assert
    expect(result.outcome).toBe('restored')
    if (result.outcome === 'restored') {
      expect(result.symlinksRestored).toBe(0)
      expect(result.symlinksSkipped).toBe(1)
    }
    const entryDir = join(sharedTrashDir, tombstone)
    await expect(stat(entryDir)).resolves.toBeTruthy()
    await expect(
      stat(join(entryDir, 'local-copies', 'claude-code', 'SKILL.md')),
    ).resolves.toBeTruthy()
    await expect(stat(join(entryDir, 'manifest.json'))).resolves.toBeTruthy()
  })
})
