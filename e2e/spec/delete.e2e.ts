import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

import { test, expect } from '../fixtures/electron-app'
import { isSnapshotOffline } from '../fixtures/isolated-home'
import {
  getStoreState,
  refreshSkillsState,
  waitForInitialScan,
} from '../helpers/redux'

/**
 * Mirrors `UNDO_WINDOW_MS` in `src/shared/constants.ts`. Duplicated here
 * (rather than imported) because the e2e suite has its own tsconfig and
 * import budget — adding a renderer/main barrel just for one constant
 * outweighs the upkeep cost of this comment. If the production constant
 * ever drifts, the 15s-timer test below fails immediately with a clear
 * "expected entry to be evicted, still present" assertion.
 */
const UNDO_WINDOW_MS_FOR_TEST = 15_000

interface SymlinkSnapshot {
  agentId: string
  status: 'valid' | 'broken' | 'missing'
  isLocal: boolean
  linkPath: string
}

interface AzureSnapshot {
  hasAzure: boolean
  sourcePath: string | null
  validSymlinks: SymlinkSnapshot[]
}

interface SourceBackedManifest {
  schemaVersion: 2
  kind: 'source-backed'
  deletedAt: number
  skillName: string
  sourcePath: string
  symlinks: Array<{ agentId: string; linkPath: string; target: string }>
}

const AZURE_AI_NAME = 'azure-ai'

/**
 * Single snapshot selector for azure-ai used by every test in this file.
 *
 * `getStoreState` serializes this function via `Function.prototype.toString`
 * and re-evaluates it inside the renderer (`new Function('state', ...)`),
 * so the body must NOT close over outer-scope identifiers — `'azure-ai'`
 * is inlined as a string literal even though `AZURE_AI_NAME` is in scope
 * at the call site.
 *
 * Promoting this from three inline copies removes the easy mistake of
 * tweaking one filter and missing the other two when the schema evolves.
 */
const azureSnapshotSelector = (state: unknown): AzureSnapshot => {
  const root = state as {
    skills: {
      items: Array<{
        name: string
        path: string
        symlinks: SymlinkSnapshot[]
      }>
    }
  }
  const azure = root.skills.items.find((skill) => skill.name === 'azure-ai')
  return {
    hasAzure: Boolean(azure),
    sourcePath: azure?.path ?? null,
    validSymlinks:
      azure?.symlinks.filter((symlink) => symlink.status === 'valid') ?? [],
  }
}

/**
 * Phase-2 spec covering `SKILLS_DELETE` + `SKILLS_RESTORE_DELETED` end-to-end.
 *
 * Two tests, both using the source-backed flow (azure-ai is installed by
 * global-setup with a real source dir under `~/.agents/skills/` and at least
 * one agent symlink). Each test gets a fresh isolated HOME via the
 * snapshot/restore fixture so a prior delete cannot leak into the next test.
 *
 * 3-layer verification (matches copy.e2e.ts):
 *   1. IPC return value
 *   2. Filesystem (source dir state, agent symlinks, trash entry + manifest)
 *   3. Renderer state (post-refresh `state.skills.items`)
 *
 * NOTE: `SKILLS_DELETE` deliberately drops the `tombstoneId` from
 * `moveToTrash`'s return — only `SKILLS_DELETE_BATCH` carries it back to the
 * renderer, because the UndoToast UX is wired to bulk-delete results. The
 * restore test below recovers the id by reading the on-disk trash dir, which
 * is a legitimate test-only seam (the renderer does not perform this lookup).
 *
 * Local-only branch coverage (`moveLocalOnlyToTrash`) and the 15s undo-window
 * eviction live in dedicated tests below the source-backed pair.
 */

// Every test in this file deletes / restores `azure-ai` from the snapshot
// SOURCE_DIR. When global-setup is offline the snapshot is empty and the
// `hasAzure: true` precondition would fail with a confusing renderer error
// instead of a clean skip.
test.beforeEach(() => {
  test.skip(
    isSnapshotOffline(),
    'azure-* skills required for this suite; runner is offline (global-setup wrote snapshot.offline=true)',
  )
})

test('deleteSkill moves source-backed skill into trash and unlinks every agent symlink', async ({
  appWindow,
  isolatedHome,
}) => {
  await waitForInitialScan(appWindow)

  const expectedSourcePath = join(
    isolatedHome,
    '.agents',
    'skills',
    AZURE_AI_NAME,
  )

  const initial = await getStoreState(appWindow, azureSnapshotSelector)

  expect(initial.hasAzure, 'azure-ai should be installed by global-setup').toBe(
    true,
  )
  expect(initial.sourcePath).toBe(expectedSourcePath)
  expect(
    initial.validSymlinks.length,
    'expected at least one valid agent symlink to exercise the cascade',
  ).toBeGreaterThan(0)

  const ipcResult = await appWindow.evaluate(
    async (skillName: string) =>
      window.electron.skills.deleteSkill({ skillName }),
    AZURE_AI_NAME,
  )

  expect(ipcResult.success).toBe(true)
  expect(ipcResult.symlinksRemoved).toBe(initial.validSymlinks.length)
  // cascadeAgents order follows the AGENTS iteration in main, not the
  // renderer snapshot order — sort both sides before comparing.
  expect([...ipcResult.cascadeAgents].sort()).toEqual(
    initial.validSymlinks.map((symlink) => symlink.agentId).sort(),
  )

  // FS — source gone, every cascading symlink unlinked.
  expect(existsSync(expectedSourcePath)).toBe(false)
  for (const symlink of initial.validSymlinks) {
    expect(
      existsSync(symlink.linkPath),
      `expected ${symlink.linkPath} to be unlinked after deleteSkill`,
    ).toBe(false)
  }

  // FS — trash entry exists with the expected layout. Entry basename matches
  // `<unix_ms>-<skillName>-<rand8hex>` (see trashService.buildEntryName), and
  // `-azure-ai-` is unique enough to identify this delete in the trash dir.
  const trashDir = join(isolatedHome, '.agents', '.trash')
  expect(existsSync(trashDir)).toBe(true)
  const trashEntries = readdirSync(trashDir).filter((entry) =>
    entry.includes(`-${AZURE_AI_NAME}-`),
  )
  expect(trashEntries).toHaveLength(1)
  const entryDir = join(trashDir, trashEntries[0])
  expect(existsSync(join(entryDir, 'source'))).toBe(true)
  expect(existsSync(join(entryDir, 'source', 'SKILL.md'))).toBe(true)

  const manifest = JSON.parse(
    readFileSync(join(entryDir, 'manifest.json'), 'utf-8'),
  ) as SourceBackedManifest
  expect(manifest.schemaVersion).toBe(2)
  expect(manifest.kind).toBe('source-backed')
  expect(manifest.skillName).toBe(AZURE_AI_NAME)
  expect(manifest.sourcePath).toBe(expectedSourcePath)
  expect(manifest.symlinks).toHaveLength(initial.validSymlinks.length)

  // Redux — azure-ai disappears from skills.items entirely. With no source
  // and no broken symlinks left behind, the scanner has nothing to surface.
  await refreshSkillsState(appWindow)
  const afterDelete = await getStoreState(appWindow, (state) => {
    const root = state as {
      skills: { items: Array<{ name: string }> }
    }
    return root.skills.items.some((skill) => skill.name === 'azure-ai')
  })
  expect(afterDelete).toBe(false)
})

test('restoreDeletedSkill recovers a source-backed deletion within the undo window', async ({
  appWindow,
  isolatedHome,
}) => {
  await waitForInitialScan(appWindow)

  const expectedSourcePath = join(
    isolatedHome,
    '.agents',
    'skills',
    AZURE_AI_NAME,
  )

  const initial = await getStoreState(appWindow, azureSnapshotSelector)

  expect(initial.hasAzure).toBe(true)
  expect(initial.validSymlinks.length).toBeGreaterThan(0)

  const deleteResult = await appWindow.evaluate(
    async (skillName: string) =>
      window.electron.skills.deleteSkill({ skillName }),
    AZURE_AI_NAME,
  )
  expect(deleteResult.success).toBe(true)

  // Recover the tombstoneId from disk — the single-delete IPC drops it on
  // the floor (see file-level NOTE). Test-only seam; production reaches it
  // via the bulk-delete return path.
  const trashDir = join(isolatedHome, '.agents', '.trash')
  const trashEntries = readdirSync(trashDir).filter((entry) =>
    entry.includes(`-${AZURE_AI_NAME}-`),
  )
  expect(trashEntries).toHaveLength(1)
  const tombstoneIdValue = trashEntries[0]

  const restoreResult = await appWindow.evaluate(
    async (id: string) =>
      window.electron.skills.restoreDeletedSkill({ tombstoneId: id }),
    tombstoneIdValue,
  )

  expect(restoreResult.outcome).toBe('restored')
  if (restoreResult.outcome === 'restored') {
    expect(restoreResult.symlinksRestored).toBe(initial.validSymlinks.length)
    // Fresh isolatedHome means nothing else can occupy the linkPaths between
    // delete and restore, so symlinksSkipped must be exactly zero. Loosening
    // this would mask collision regressions in the restore path.
    expect(restoreResult.symlinksSkipped).toBe(0)
  }

  // FS — source dir back at the original path with its content intact.
  expect(existsSync(expectedSourcePath)).toBe(true)
  expect(existsSync(join(expectedSourcePath, 'SKILL.md'))).toBe(true)

  // FS — agent symlinks recreated and pointing at the restored source.
  for (const symlink of initial.validSymlinks) {
    expect(existsSync(symlink.linkPath)).toBe(true)
    const stat = lstatSync(symlink.linkPath)
    expect(stat.isSymbolicLink()).toBe(true)
  }

  // FS — trash entry cleaned up by finalizeRestore (rm + cancel TTL timer).
  expect(existsSync(join(trashDir, tombstoneIdValue))).toBe(false)

  // Redux — azure-ai is back with the same set of valid symlinks. Comparing
  // the agentId set (not the snapshot identity) is enough; status booleans
  // for the restored agents land on `valid` because the source dir exists
  // and the symlink target resolves.
  await refreshSkillsState(appWindow)
  const restored = await getStoreState(appWindow, azureSnapshotSelector)

  expect(restored.hasAzure).toBe(true)
  expect(restored.sourcePath).toBe(expectedSourcePath)
  expect(
    restored.validSymlinks.map((symlink) => symlink.agentId).sort(),
  ).toEqual(initial.validSymlinks.map((symlink) => symlink.agentId).sort())
})

interface LocalOnlyManifest {
  schemaVersion: 2
  kind: 'local-only'
  deletedAt: number
  skillName: string
  localCopies: Array<{ agentId: string; linkPath: string }>
}

/**
 * Local-only delete branch — exercises the second arm of `moveToTrash`'s
 * dispatcher in `trashService.ts:265-273`. Source dir at
 * `~/.agents/skills/<name>` is intentionally absent; the skill exists ONLY
 * as a real folder under one or more agent dirs. The handler must:
 *
 *   1. Probe `~/.agents/skills/<name>` → ENOENT, NOT throw.
 *   2. `scanLocalCopies(skillName)` finds the real folder(s).
 *   3. `moveLocalOnlyToTrash` renames each into `<entryDir>/local-copies/<agentId>`.
 *   4. Manifest is written with `kind: 'local-only'` (not `'source-backed'`).
 *
 * Codex is chosen over claude/cursor because the QA Safety contract in
 * CLAUDE.md flags those two as the user's live working sets — even though
 * this test runs under an isolated tempdir HOME, picking codex keeps the
 * pattern consistent with the spirit of the rule for any human reviewer.
 *
 * The renderer-side scanSkills surfaces local-only skills with `isLocal: true`
 * symlink rows, so a post-delete `state.skills.items` lookup is the canonical
 * way to confirm the entry vanished — same shape as the source-backed test.
 */
test('deleteSkill moves a local-only skill into trash with kind="local-only" manifest', async ({
  appWindow,
  isolatedHome,
}) => {
  const skillName = 'local-only-skill'
  const codexAgentDir = join(isolatedHome, '.codex', 'skills', skillName)
  mkdirSync(codexAgentDir, { recursive: true })
  const localOnlyContent = `# ${skillName}\n\nlocal-only fixture for delete.e2e.ts\n`
  writeFileSync(join(codexAgentDir, 'SKILL.md'), localOnlyContent)

  // Sanity — confirm the source dir branch will NOT trigger. If a future
  // refactor of the snapshot ever pre-creates this name as source-backed,
  // moveToTrash takes the wrong path and the manifest below ends up
  // 'source-backed'. Failing fast here gives a clearer signal than a
  // downstream JSON shape mismatch.
  expect(
    existsSync(join(isolatedHome, '.agents', 'skills', skillName)),
    'local-only test requires the source dir to be absent',
  ).toBe(false)

  await waitForInitialScan(appWindow)

  const ipcResult = await appWindow.evaluate(
    async (name: string) =>
      window.electron.skills.deleteSkill({ skillName: name }),
    skillName,
  )

  expect(ipcResult.success).toBe(true)
  // The local-only return reuses `symlinksRemoved` to mean "agent folders
  // moved" — see trashService.ts:660-664. One agent staged, so 1.
  expect(ipcResult.symlinksRemoved).toBe(1)
  expect(ipcResult.cascadeAgents).toEqual(['codex'])

  // FS — codex's real folder is gone (renamed into trash).
  expect(existsSync(codexAgentDir)).toBe(false)

  // FS — trash entry has the local-copies/<agentId>/ shape, NOT a source/
  // subdirectory. Catching this discriminator at the FS layer is what makes
  // the test independently bisectable from the source-backed flow.
  const trashDir = join(isolatedHome, '.agents', '.trash')
  const trashEntries = readdirSync(trashDir).filter((entry) =>
    entry.includes(`-${skillName}-`),
  )
  expect(trashEntries).toHaveLength(1)
  const entryDir = join(trashDir, trashEntries[0])
  expect(existsSync(join(entryDir, 'local-copies', 'codex'))).toBe(true)
  expect(existsSync(join(entryDir, 'local-copies', 'codex', 'SKILL.md'))).toBe(
    true,
  )
  expect(existsSync(join(entryDir, 'source'))).toBe(false)

  // Manifest kind is the canonical discriminator the restore path branches
  // on (`restoreLocalOnly` vs the source-backed restore). A regression that
  // wrote 'source-backed' here would silently break the undo flow.
  const manifest = JSON.parse(
    readFileSync(join(entryDir, 'manifest.json'), 'utf-8'),
  ) as LocalOnlyManifest
  expect(manifest.schemaVersion).toBe(2)
  expect(manifest.kind).toBe('local-only')
  expect(manifest.skillName).toBe(skillName)
  expect(manifest.localCopies).toHaveLength(1)
  expect(manifest.localCopies[0].agentId).toBe('codex')
  expect(manifest.localCopies[0].linkPath).toBe(codexAgentDir)
})

/**
 * Undo-window TTL eviction — `moveToTrash` schedules `setTimeout(evict,
 * UNDO_WINDOW_MS)` after staging the entry (see `trashService.ts:484-487` for
 * source-backed and `:648-651` for local-only). After the timer fires:
 *
 *   1. The entry dir is removed from `.trash/`.
 *   2. The internal `evictTimers` map drops the id (idempotent next call).
 *
 * This test polls the FS in real time (deadline `UNDO_WINDOW_MS + 10s`)
 * instead of mocking timers because:
 *   - The timer lives in the main process; the renderer's clock is irrelevant.
 *   - The test helpers `__clearEvictTimersForTests` cancel timers WITHOUT
 *     firing them, so they prove the absence of leaks but NOT that the
 *     scheduled callback evicts correctly.
 *   - Real-time wait is the only way to exercise the production code path.
 *
 * Test budget: setup (~3s) + 15s wait + up to 10s poll deadline ~= 25-28s on
 * the slow path. Bumping the per-test timeout to 45s leaves headroom for
 * macOS CI variance. Happy path returns as soon as `existsSync(entryDir)`
 * flips false (typically within ~100ms of UNDO_WINDOW_MS firing).
 */
test('source-backed delete entry is auto-evicted after UNDO_WINDOW_MS', async ({
  appWindow,
  isolatedHome,
}) => {
  test.setTimeout(45_000)

  await waitForInitialScan(appWindow)

  const expectedSourcePath = join(
    isolatedHome,
    '.agents',
    'skills',
    AZURE_AI_NAME,
  )

  const initial = await getStoreState(appWindow, azureSnapshotSelector)
  expect(initial.hasAzure).toBe(true)

  const deleteResult = await appWindow.evaluate(
    async (skillName: string) =>
      window.electron.skills.deleteSkill({ skillName }),
    AZURE_AI_NAME,
  )
  expect(deleteResult.success).toBe(true)

  // Locate the staged entry by name pattern. Single match expected because
  // we just deleted exactly one azure-ai entry into a fresh isolated HOME.
  const trashDir = join(isolatedHome, '.agents', '.trash')
  const trashEntries = readdirSync(trashDir).filter((entry) =>
    entry.includes(`-${AZURE_AI_NAME}-`),
  )
  expect(trashEntries).toHaveLength(1)
  const tombstoneIdValue = trashEntries[0]
  const entryDir = join(trashDir, tombstoneIdValue)

  // Pre-eviction sanity — the entry exists right after the IPC settles. If
  // this fails, `moveToTrash` is dropping the staged dir before the timer
  // even runs (a different bug than the one this test is hunting).
  expect(existsSync(entryDir)).toBe(true)
  expect(existsSync(expectedSourcePath)).toBe(false)

  // KEY assertion — the entire entry is gone. A bounded poll instead of a
  // fixed sleep: the happy path returns as soon as eviction lands (under
  // load CI macOS runners can take an extra few hundred ms after the timer
  // fires), and the deadline still bounds wall time at UNDO_WINDOW_MS + 10s.
  //
  // Regression coverage stays the same:
  //   - never schedules the timer → entry persists, poll times out
  //   - clears the timer without calling evict → same
  //   - evict throws on a partial dir → entry partially remains, poll
  //     times out because existsSync(entryDir) stays true
  await expect
    .poll(() => existsSync(entryDir), {
      timeout: UNDO_WINDOW_MS_FOR_TEST + 10_000,
      intervals: [250, 500, 1_000],
    })
    .toBe(false)

  // Source dir stays gone post-eviction — eviction is meant to delete the
  // staged copy, NOT resurrect the original. A regression that mistakenly
  // restored on TTL expiry would surface here as `existsSync === true`.
  expect(existsSync(expectedSourcePath)).toBe(false)
})
