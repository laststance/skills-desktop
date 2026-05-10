import { existsSync, lstatSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { test, expect } from '../fixtures/electron-app'
import { isSnapshotOffline } from '../fixtures/isolated-home'
import {
  getStoreState,
  refreshSkillsState,
  waitForInitialScan,
} from '../helpers/redux'

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

const AZURE_AI_NAME = 'azure-ai'

/**
 * Snapshot selector for azure-ai. Mirrors `azureSnapshotSelector` in
 * delete.e2e.ts. Inlined here (rather than imported from a shared helper)
 * because `getStoreState` serializes the function via `Function.prototype.toString`
 * — the body must NOT close over outer-scope identifiers, so the literal
 * `'azure-ai'` is hard-coded inside.
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
 * UI-driven coverage for the Undo button on the post-bulk-delete sonner toast.
 *
 * The companion spec `delete.e2e.ts` already verifies the IPC layer
 * (`SKILLS_DELETE` + `SKILLS_RESTORE_DELETED`) end-to-end. This file
 * complements it by exercising the renderer click chain that real users hit:
 *
 *   bulk select → toolbar Delete → confirm dialog Delete → Undo button
 *
 * The user requirement was explicit: "Undoしたあとちゃんとファイルが復元されているか、
 * は重要度が高い" — file restoration is the load-bearing assertion. So the
 * post-Undo checks focus on the FS:
 *   - source dir + SKILL.md back at the original path
 *   - every originally-valid agent symlink restored AS A REAL SYMLINK
 *     (via `lstatSync().isSymbolicLink()`, not just `existsSync`)
 *   - trash entry cleaned up by `finalizeRestore`
 *   - Redux `state.skills.items` re-populated post-rescan
 *
 * Single-skill scope by design: the Undo flow is a single dispatch regardless
 * of selection size, and the FS restoration logic is identical per-tombstone.
 * Multi-skill bulk timing edges (≥10 → progress event) are out of scope here;
 * delete.e2e.ts owns the bulk-delete IPC contract.
 */

test.beforeEach(() => {
  test.skip(
    isSnapshotOffline(),
    'azure-ai required from snapshot; runner is offline (global-setup wrote snapshot.offline=true)',
  )
})

test('UI: clicking Undo on the bulk-delete toast restores azure-ai files and symlinks', async ({
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
  const trashDir = join(isolatedHome, '.agents', '.trash')

  const initial = await getStoreState(appWindow, azureSnapshotSelector)
  expect(initial.hasAzure, 'azure-ai should be installed by global-setup').toBe(
    true,
  )
  expect(initial.sourcePath).toBe(expectedSourcePath)
  expect(
    initial.validSymlinks.length,
    'expected at least one valid agent symlink so restore actually has work to do',
  ).toBeGreaterThan(0)

  // Drive Redux directly into the bulk-select + selected state. Action types
  // are inlined string literals because the dispatch re-evaluates inside the
  // renderer where the slice action creators are out of scope.
  //
  // Order matters: SelectionToolbar gates on BOTH `bulkSelectMode === true`
  // AND `selectedSkillNames.length > 0` (see SelectionToolbar.tsx). Toggling
  // selection before entering bulk mode would briefly violate the invariant
  // and the toolbar would not render — the next `getByRole('button')` lookup
  // would then time out instead of failing fast.
  await appWindow.evaluate(() => {
    const store = window.__store__ ?? window.__store
    store?.dispatch({ type: 'ui/enterBulkSelectMode' })
    store?.dispatch({ type: 'skills/toggleSelection', payload: 'azure-ai' })
  })

  // Toolbar primary button — global view, single skill selected. The label is
  // sourced from `getToolbarState({ view: 'global', countKind: 'single' })` in
  // bulkDeleteHelpers.ts; matching the exact aria-label keeps the test
  // resilient to visual-label tweaks ("Delete skill" → "Remove skill") that
  // would not change the underlying intent.
  await appWindow
    .getByRole('button', { name: 'Delete selected skill permanently' })
    .click()

  // Confirm dialog mounts via Radix `<Dialog>`. The title is dynamic
  // ("Delete 1 skill?"); the destructive Delete button has the unambiguous
  // exact name "Delete" — the toolbar's button uses an aria-label so it
  // does NOT collide here.
  await appWindow
    .getByRole('heading', { name: 'Delete 1 skill?' })
    .waitFor({ state: 'visible', timeout: 5_000 })
  await appWindow.getByRole('button', { name: 'Delete', exact: true }).click()

  // Wait for the source dir to be moved to trash. This is the smallest signal
  // the click chain reached `moveToTrash` — polling Redux is unreliable here
  // because the bulk thunk's fulfilled state and the rescan-fetch race.
  await expect
    .poll(() => existsSync(expectedSourcePath), { timeout: 10_000 })
    .toBe(false)

  // The UndoToast is rendered via sonner's default-styled wrapper into a
  // portal under document.body. The Undo button's aria-label is generated
  // by UndoToast.tsx as `Undo delete of N <skill|skills>`; matching the
  // prefix keeps the test stable across pluralization tweaks.
  const undoButton = appWindow.getByRole('button', {
    name: /^Undo delete of \d+ skills?$/,
  })
  await undoButton.waitFor({ state: 'visible', timeout: 5_000 })
  await undoButton.click()

  // PRIMARY ASSERTION — the source directory comes back at exactly the same
  // path with the SKILL.md content restored. `lstatSync` (not stat) on the
  // source path so a regression that restores a *symlink* in place of the
  // real directory would show up as `isSymbolicLink() === true` here.
  await expect
    .poll(() => existsSync(expectedSourcePath), { timeout: 10_000 })
    .toBe(true)
  expect(existsSync(join(expectedSourcePath, 'SKILL.md'))).toBe(true)
  expect(lstatSync(expectedSourcePath).isDirectory()).toBe(true)

  // PRIMARY ASSERTION — every originally-valid agent symlink is back AS A
  // SYMLINK. Using `existsSync` alone would silently pass if restore wrote
  // a real file at the link path; `lstatSync().isSymbolicLink()` catches
  // that regression. This is the load-bearing check the user called out.
  for (const symlink of initial.validSymlinks) {
    expect(
      existsSync(symlink.linkPath),
      `expected ${symlink.linkPath} to exist after Undo`,
    ).toBe(true)
    expect(
      lstatSync(symlink.linkPath).isSymbolicLink(),
      `expected ${symlink.linkPath} to be a symlink after Undo (not a regular file)`,
    ).toBe(true)
  }

  // Trash entry cleaned up by `finalizeRestore` (rm + cancel TTL timer).
  // A residual entry would leave a phantom undo target around indefinitely.
  const residualTrashEntries = existsSync(trashDir)
    ? readdirSync(trashDir).filter((entry) =>
        entry.includes(`-${AZURE_AI_NAME}-`),
      )
    : []
  expect(
    residualTrashEntries,
    'restore must remove the trash entry — leftover would leak undo targets',
  ).toEqual([])

  // Redux — azure-ai is back with the same set of valid symlinks. Comparing
  // the agentId set (not the snapshot identity) is enough: status booleans
  // for restored agents land on `valid` because the source dir exists and
  // the symlink target resolves. `refreshSkillsState` is needed because the
  // `handleUndoDelete` callback in MainContent calls `refreshAllData` but
  // the renderer's listener races the test's evaluation; an explicit refresh
  // collapses the race.
  await refreshSkillsState(appWindow)
  const restored = await getStoreState(appWindow, azureSnapshotSelector)

  expect(restored.hasAzure).toBe(true)
  expect(restored.sourcePath).toBe(expectedSourcePath)
  expect(
    restored.validSymlinks.map((symlink) => symlink.agentId).sort(),
  ).toEqual(initial.validSymlinks.map((symlink) => symlink.agentId).sort())
})
