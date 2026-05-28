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

  it('baseline: legit absolute target inside SOURCE_DIR is restored', async () => {
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

    const result = await restore(tombstone as never)
    expect(result.outcome).toBe('restored')
    if (result.outcome === 'restored') {
      expect(result.symlinksRestored).toBeGreaterThanOrEqual(1)
    }
    // Source dir re-planted.
    await stat(join(sharedSourceDir, skillName))
    // Symlink re-planted.
    await stat(linkPath)
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

  it('skips symlink when manifest target absolute-escapes SOURCE_DIR', async () => {
    const { restore } = await trashServicePromise
    const skillName = 'target-abs-escape'
    const linkPath = join(sharedClaudeAgent, skillName)
    const tombstone = await buildFakeTrashEntry({
      skillName,
      symlinks: [{ agentId: 'claude-code', linkPath, target: '/etc/passwd' }],
    })

    const result = await restore(tombstone as never)
    expect(result.outcome).toBe('restored')
    if (result.outcome === 'restored') {
      // Containment check must skip this link — 0 restored, 1 skipped.
      expect(result.symlinksRestored).toBe(0)
      expect(result.symlinksSkipped).toBeGreaterThanOrEqual(1)
    }
    await expect(stat(linkPath)).rejects.toThrow()
  })

  it('skips symlink when relative target escapes SOURCE_DIR via parent traversal', async () => {
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

    const result = await restore(tombstone as never)
    expect(result.outcome).toBe('restored')
    if (result.outcome === 'restored') {
      expect(result.symlinksRestored).toBe(0)
      expect(result.symlinksSkipped).toBeGreaterThanOrEqual(1)
    }
    await expect(stat(linkPath)).rejects.toThrow()
  })

  it('skips symlink when target points at an unrelated path inside homedir (but outside SOURCE_DIR)', async () => {
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

    const result = await restore(tombstone as never)
    expect(result.outcome).toBe('restored')
    if (result.outcome === 'restored') {
      expect(result.symlinksRestored).toBe(0)
      expect(result.symlinksSkipped).toBeGreaterThanOrEqual(1)
    }
    await expect(stat(linkPath)).rejects.toThrow()
  })

  it('mixed manifest: skips tampered entries but plants legit ones', async () => {
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

    const result = await restore(tombstone as never)
    expect(result.outcome).toBe('restored')
    if (result.outcome === 'restored') {
      expect(result.symlinksRestored).toBe(1)
      expect(result.symlinksSkipped).toBeGreaterThanOrEqual(1)
    }
    await stat(linkPathA)
    await expect(stat(linkPathB)).rejects.toThrow()
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
