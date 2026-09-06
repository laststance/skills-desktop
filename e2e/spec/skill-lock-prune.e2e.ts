import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

import type { Page } from '@playwright/test'

import { SNAPSHOT_LOCK_FILE } from '../constants'
import { test, expect } from '../fixtures/electron-app'
import { isSnapshotOffline } from '../fixtures/isolated-home'

/**
 * End-to-end coverage for the stale `.skill-lock.json` detection and prune
 * guards, driven through the real preload IPC surface
 * (`window.electron.skills.scanStaleLockEntries` /
 * `window.electron.skills.pruneLockEntries`).
 *
 * Why this file exists: the unit suite in `skillLockService.test.ts` stages
 * exactly the one agent directory each case names. The shipped code instead
 * walks every entry of `AGENT_DEFINITIONS` against a real HOME. If
 * `installDir` were read one directory level off, the unit tests stay green
 * while the guard either refuses every prune (feature silently dead) or waves
 * through a delegation that recursively deletes a real agent directory. Only
 * an integrated run against a populated HOME can tell those apart.
 *
 * Spawn budget: every guard short-circuits BEFORE `skillsCliService.removeSkills`,
 * so the refusal specs cost no child process. Exactly one spec below drives the
 * real `npx skills remove` path, because "the lock key actually disappears" is
 * the user-visible bug this feature exists to fix — a lock record for a deleted
 * skill makes `skills -g update` reinstall it.
 */

/** Lock keys and directory names this spec owns. Fresh per test HOME. */
const CONTROL_STALE_KEY = 'lock-prune-control-gone'

/**
 * Overwrite the global skill lock with exactly the given keys.
 *
 * `rmSync` first is load-bearing, not defensive: the isolated HOME is
 * `cp -al` hardlinked from the snapshot, so writing over the existing lock
 * in place would mutate the shared inode and corrupt every later test.
 * Unlinking breaks the link so `writeFileSync` allocates a new inode.
 *
 * @param isolatedHome - Test HOME from the Electron fixture.
 * @param keys - Raw lock keys to record, in the CLI's v3 entry shape.
 * @returns Absolute path of the lock file that was written.
 * @example writeLockKeys('/tmp/home', ['old-skill'])
 */
function writeLockKeys(isolatedHome: string, keys: readonly string[]): string {
  const lockPath = join(isolatedHome, SNAPSHOT_LOCK_FILE)
  const skills = Object.fromEntries(
    keys.map((key) => [
      key,
      {
        source: 'microsoft/azure-skills',
        sourceType: 'github',
        sourceUrl: 'https://github.com/microsoft/azure-skills.git',
        skillPath: `skills/${key}/SKILL.md`,
        skillFolderHash: '0000000000000000000000000000000000000000',
        installedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]),
  )
  mkdirSync(join(isolatedHome, '.agents'), { recursive: true })
  rmSync(lockPath, { force: true })
  writeFileSync(lockPath, JSON.stringify({ version: 3, skills }), 'utf-8')
  return lockPath
}

/**
 * Write raw bytes as the lock file, for the corrupt-lock case.
 * @param isolatedHome - Test HOME from the Electron fixture.
 * @param contents - Exact file body to write.
 * @example writeRawLock('/tmp/home', '{ not json')
 */
function writeRawLock(isolatedHome: string, contents: string): void {
  const lockPath = join(isolatedHome, SNAPSHOT_LOCK_FILE)
  mkdirSync(join(isolatedHome, '.agents'), { recursive: true })
  rmSync(lockPath, { force: true })
  writeFileSync(lockPath, contents, 'utf-8')
}

/**
 * Read the lock keys currently on disk, so a prune result can be checked
 * against the file the CLI actually rewrote rather than only the IPC reply.
 * @param isolatedHome - Test HOME from the Electron fixture.
 * @returns Sorted raw lock keys.
 * @example readLockKeys('/tmp/home') // => ['azure-ai']
 */
function readLockKeys(isolatedHome: string): string[] {
  const parsed = JSON.parse(
    readFileSync(join(isolatedHome, SNAPSHOT_LOCK_FILE), 'utf-8'),
  ) as { skills: Record<string, unknown> }
  return Object.keys(parsed.skills).sort()
}

/**
 * Create a real source skill directory under `~/.agents/skills`.
 * @param isolatedHome - Test HOME from the Electron fixture.
 * @param dirName - Sanitized directory name to create.
 * @returns Absolute path of the created source directory.
 * @example stageSourceSkill('/tmp/home', 'ce-review')
 */
function stageSourceSkill(isolatedHome: string, dirName: string): string {
  const sourcePath = join(isolatedHome, '.agents', 'skills', dirName)
  mkdirSync(sourcePath, { recursive: true })
  writeFileSync(join(sourcePath, 'SKILL.md'), `# ${dirName}\n`)
  return sourcePath
}

/**
 * Stage a trash tombstone so the named skill counts as still restorable.
 * `deletedAt` is now, not a fixed past timestamp, so the entry is genuinely
 * inside its undo window and no eviction sweep can race the assertion.
 * @param isolatedHome - Test HOME from the Electron fixture.
 * @param dirName - Sanitized source directory name the tombstone shadows.
 * @example stageTombstone('/tmp/home', 'undoable-skill')
 */
function stageTombstone(isolatedHome: string, dirName: string): void {
  const deletedAt = Date.now()
  const entryDir = join(
    isolatedHome,
    '.agents',
    '.trash',
    `${deletedAt}-${dirName}-aaaaaaaa`,
  )
  mkdirSync(entryDir, { recursive: true })
  writeFileSync(
    join(entryDir, 'manifest.json'),
    JSON.stringify({
      schemaVersion: 2,
      kind: 'source-backed',
      deletedAt,
      skillName: 'Display Name Not The Directory',
      sourcePath: join(isolatedHome, '.agents', 'skills', dirName),
      symlinks: [],
    }),
    'utf-8',
  )
}

/**
 * Invoke `skills:lock:scanStale` through preload, the same call the dashboard makes.
 * @param appWindow - Playwright page for the Electron renderer.
 * @returns Scan status plus the stale lock keys main reported.
 * @example await scanStaleLockEntries(page) // => { status: 'ok', names: ['old'] }
 */
async function scanStaleLockEntries(appWindow: Page) {
  return appWindow.evaluate(async () =>
    window.electron.skills.scanStaleLockEntries(),
  )
}

/**
 * Invoke `skills:lock:prune` through preload with the exact keys given.
 * @param appWindow - Playwright page for the Electron renderer.
 * @param names - Raw lock keys to request a prune for.
 * @returns Pruned, skipped and failed keys as main classified them.
 * @example await pruneLockEntries(page, ['old']) // => { pruned: ['old'], skipped: [], failed: [] }
 */
async function pruneLockEntries(appWindow: Page, names: string[]) {
  return appWindow.evaluate(
    async (requested) =>
      window.electron.skills.pruneLockEntries({ names: requested }),
    names,
  )
}

test('reports only the lock record whose skill directory was deleted outside the app', async ({
  appWindow,
  isolatedHome,
}) => {
  // Arrange: two tracked keys, one still on disk, plus an untracked local skill.
  writeLockKeys(isolatedHome, [CONTROL_STALE_KEY, 'lock-prune-present'])
  stageSourceSkill(isolatedHome, 'lock-prune-present')
  stageSourceSkill(isolatedHome, 'lock-prune-local-only')

  // Act
  const result = await scanStaleLockEntries(appWindow)

  // Assert: only the tracked-and-missing record is stale. A skill that is
  // present stays out, and a skill the lock never knew about is never invented.
  expect(result).toEqual({
    status: 'ok',
    names: [CONTROL_STALE_KEY],
    unprunable: [],
  })
})

test('refuses to call the whole lock stale when the skills source root is missing', async ({
  appWindow,
  isolatedHome,
}) => {
  // Arrange: the root is gone, so every per-skill probe would report ENOENT.
  writeLockKeys(isolatedHome, [CONTROL_STALE_KEY, 'lock-prune-present'])
  rmSync(join(isolatedHome, '.agents', 'skills'), {
    recursive: true,
    force: true,
  })

  // Act
  const result = await scanStaleLockEntries(appWindow)

  // Assert: unavailable, never `ok` with the entire lock listed for deletion.
  expect(result).toEqual({ status: 'unavailable' })
})

test('keeps a lock key out of the stale list when only its sanitized form is on disk', async ({
  appWindow,
  isolatedHome,
}) => {
  // Arrange: the CLI keys the lock by raw install name but writes the
  // sanitized name to disk, so `ce:review` legitimately lives at `ce-review`.
  writeLockKeys(isolatedHome, ['lock-prune:review', CONTROL_STALE_KEY])
  stageSourceSkill(isolatedHome, 'lock-prune-review')

  // Act
  const result = await scanStaleLockEntries(appWindow)

  // Assert: the control proves the scan ran; the divergent key is not stale.
  expect(result).toEqual({
    status: 'ok',
    names: [CONTROL_STALE_KEY],
    unprunable: [],
  })
})

test('reports both lock keys that sanitize to one directory name as blocked, never as deletable', async ({
  appWindow,
  isolatedHome,
}) => {
  // Arrange: `lock-prune:dup` and `lock-prune/dup` both sanitize to
  // `lock-prune-dup`, so one directory cannot answer for either key.
  writeLockKeys(isolatedHome, [
    'lock-prune:dup',
    'lock-prune/dup',
    CONTROL_STALE_KEY,
  ])

  // Act
  const result = await scanStaleLockEntries(appWindow)

  // Assert: pruning a collided key could strand the twin that still exists, so
  // neither is offered — but the pair is named, not dropped, or the user has no
  // way to learn why `skills -g update` keeps bringing them back.
  expect(result).toEqual({
    status: 'ok',
    names: [CONTROL_STALE_KEY],
    unprunable: [
      { name: 'lock-prune/dup', reason: 'name-collision' },
      { name: 'lock-prune:dup', reason: 'name-collision' },
    ],
  })
})

test('keeps a skill inside its undo window out of the stale list', async ({
  appWindow,
  isolatedHome,
}) => {
  // Arrange: source moved to the trash, tombstone still restorable.
  writeLockKeys(isolatedHome, ['lock-prune-undoable', CONTROL_STALE_KEY])
  stageTombstone(isolatedHome, 'lock-prune-undoable')

  // Act
  const result = await scanStaleLockEntries(appWindow)

  // Assert: offering to prune it would strand the skill Undo brings back.
  expect(result).toEqual({
    status: 'ok',
    names: [CONTROL_STALE_KEY],
    unprunable: [],
  })
})

test('refuses to report a corrupt lock as zero stale records', async ({
  appWindow,
  isolatedHome,
}) => {
  // Arrange: a truncated lock, the shape a SIGTERM mid-write leaves behind.
  writeRawLock(isolatedHome, '{ "version": 3, "skills": { "half-writ')

  // Act
  const result = await scanStaleLockEntries(appWindow)

  // Assert: unavailable, so the UI never renders a reassuring "0 stale".
  expect(result).toEqual({ status: 'unavailable' })
})

test('reports no stale records when the lock tracks nothing', async ({
  appWindow,
  isolatedHome,
}) => {
  // Arrange
  writeLockKeys(isolatedHome, [])

  // Act
  const result = await scanStaleLockEntries(appWindow)

  // Assert
  expect(result).toEqual({ status: 'ok', names: [], unprunable: [] })
})

test('refuses to prune a lock key that still owns a real directory inside an agent', async ({
  appWindow,
  isolatedHome,
}) => {
  // Arrange: source gone, but a real (non-symlink) directory of the same name
  // sits in an agent install dir. `skills remove --global` would `rm -rf` it.
  //
  // Paired with the broken-symlink spec at the bottom of this file: both stage
  // the identical source-absent state and differ only in what sits under
  // `.claude/skills`, so the opposite outcomes pin the refusal to the agent
  // probe. That pairing matters because `.agents` is itself an `installDir`
  // (the 16 universal-source agents), meaning the guard also probes SOURCE_DIR
  // — if that probe were what refused, this spec and that one could not
  // disagree.
  writeLockKeys(isolatedHome, ['lock-prune-agent-owned'])
  const agentSkillPath = join(
    isolatedHome,
    '.claude',
    'skills',
    'lock-prune-agent-owned',
  )
  mkdirSync(agentSkillPath, { recursive: true })
  writeFileSync(join(agentSkillPath, 'SKILL.md'), '# Real agent-owned bytes\n')

  // Act
  const result = await pruneLockEntries(appWindow, ['lock-prune-agent-owned'])

  // Assert: refused, the lock untouched, and the agent's real files intact.
  expect(result).toEqual({
    pruned: [],
    skipped: [],
    failed: ['lock-prune-agent-owned'],
  })
  expect(readLockKeys(isolatedHome)).toEqual(['lock-prune-agent-owned'])
  expect(existsSync(join(agentSkillPath, 'SKILL.md'))).toBe(true)
})

test('refuses to prune a lock key that is still restorable from the trash', async ({
  appWindow,
  isolatedHome,
}) => {
  // Arrange: a delete landed after the scan listed this key as stale.
  writeLockKeys(isolatedHome, ['lock-prune-still-undoable'])
  stageTombstone(isolatedHome, 'lock-prune-still-undoable')

  // Act
  const result = await pruneLockEntries(appWindow, [
    'lock-prune-still-undoable',
  ])

  // Assert: skipped rather than pruned, so Undo still has a lock record to return to.
  expect(result).toEqual({
    pruned: [],
    skipped: ['lock-prune-still-undoable'],
    failed: [],
  })
  expect(readLockKeys(isolatedHome)).toEqual(['lock-prune-still-undoable'])
})

test('refuses to prune anything when the skills source root is missing', async ({
  appWindow,
  isolatedHome,
}) => {
  // Arrange: an unmounted or renamed root makes every key look provably absent.
  writeLockKeys(isolatedHome, ['lock-prune-orphan-a', 'lock-prune-orphan-b'])
  rmSync(join(isolatedHome, '.agents', 'skills'), {
    recursive: true,
    force: true,
  })

  // Act
  const result = await pruneLockEntries(appWindow, [
    'lock-prune-orphan-a',
    'lock-prune-orphan-b',
  ])

  // Assert: the whole batch fails closed instead of emptying the lock.
  expect(result).toEqual({
    pruned: [],
    skipped: [],
    failed: ['lock-prune-orphan-a', 'lock-prune-orphan-b'],
  })
  expect(readLockKeys(isolatedHome)).toEqual([
    'lock-prune-orphan-a',
    'lock-prune-orphan-b',
  ])
})

test('removes the lock key of a deleted skill whose only agent trace is a broken symlink', async ({
  appWindow,
  isolatedHome,
}) => {
  test.skip(
    isSnapshotOffline(),
    'drives the real `npx skills remove`; runner is offline',
  )
  // The only spec here that spawns the CLI. Give it room for the npx resolve.
  test.setTimeout(120_000)

  // Arrange: the exact shape of the reported bug — the skill is deleted, the
  // agent side is a dangling symlink, and the lock record survives and would
  // make `skills -g update` reinstall it.
  const deletedSourcePath = join(
    isolatedHome,
    '.agents',
    'skills',
    'lock-prune-reinstalled',
  )
  writeLockKeys(isolatedHome, ['lock-prune-reinstalled'])
  const agentSkillsDir = join(isolatedHome, '.claude', 'skills')
  mkdirSync(agentSkillsDir, { recursive: true })
  symlinkSync(deletedSourcePath, join(agentSkillsDir, 'lock-prune-reinstalled'))

  // Act
  const result = await pruneLockEntries(appWindow, ['lock-prune-reinstalled'])

  // Assert: a dangling symlink is not a reason to refuse, and the record is
  // actually gone from the file the CLI reads on its next update.
  expect(result).toEqual({
    pruned: ['lock-prune-reinstalled'],
    skipped: [],
    failed: [],
  })
  expect(readLockKeys(isolatedHome)).toEqual([])
})
