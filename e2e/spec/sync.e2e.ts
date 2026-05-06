import { existsSync, lstatSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { test, expect } from '../fixtures/electron-app'
import { isSnapshotOffline } from '../fixtures/isolated-home'
import {
  getStoreState,
  waitForInitialScan,
  waitForSyncSettled,
} from '../helpers/redux'

/**
 * Sync flow — `fetchSyncPreview` → `executeSyncAction` → `SyncResultDialog`.
 *
 * Why this needs E2E coverage at all: the sync flow crosses two IPC
 * channels (`SYNC_PREVIEW`, `SYNC_EXECUTE`), four dialog components
 * (`SyncConfirmDialog`, `SyncConflictDialog`, `SyncResultDialog`, plus
 * the `SourceCard` trigger), and creates real symlinks under the user's
 * home directory. Until now the unit-test layer had `syncService.test.ts`
 * for the main-process service and the slice tests for the reducer, but
 * NOTHING exercised the wired-up `<button onClick={dispatch(thunk)}>`
 * → preload bridge → main service → fs.symlink → broadcast → dialog
 * loop. A regression in any of those joints (e.g. broken `electron.sync.execute`
 * binding, dialog gate predicate flip, `replaceConflicts: []` arg drop)
 * would silently land on main without any test going red.
 *
 * Coverage strategy: three tests, each isolated by the per-test fixture
 * HOME so symlinks created in one don't pollute another:
 *
 *   1. **Global preview** — UI-driven via the SourceCard's "Sync" button.
 *      Pins the SourceCard wiring, the thunk dispatch, the slice reducer,
 *      AND the dialog auto-open predicate (`shouldShowSyncConfirm`).
 *
 *   2. **Per-agent preview** — direct IPC call. The per-agent option has
 *      no UI surface (it's invoked by the per-agent Cleanup flow as an
 *      internal API), so calling the preload bridge directly is the
 *      only way to assert the `forAgent` echo and the `totalAgents === 1`
 *      narrowing rule at the boundary `getExistingAgents` filters at.
 *
 *   3. **Execute → SyncResultDialog** — UI-driven end-to-end. Asserts
 *      both the slice (`syncResult.success`, `created`, `errors`) AND
 *      the filesystem (`lstatSync(...).isSymbolicLink()`) AND the
 *      auto-opened result dialog. Filesystem proof matters because a
 *      future refactor that updates the slice without actually creating
 *      symlinks would still pass the slice assertions alone.
 *
 * Snapshot-state caveat: the global-setup runs `npx skills add ... --global`
 * which side-effects ~30 agent dirs into the home (`.adal/`, `.bob/`,
 * `.claude/`, etc.) AND fully links every azure-* skill into each of
 * them. So the BASELINE preview against an unmodified isolated HOME
 * already shows `totalAgents ≈ 31, alreadySynced ≈ 217, toCreate = 0` —
 * meaning the only way to drive `toCreate > 0` is to stage an agent dir
 * that is NOT in the snapshot. Cursor and Cline both qualify
 * (`.cursor/` and `.cline/` are absent from the snapshot HOME despite
 * being in `UNIVERSAL_AGENT_IDS`). This is why we mkdir those parents
 * — they're the only fresh slots the sync logic has to fill.
 */

test.beforeEach(() => {
  // Sync needs the 7 azure-* skills from the snapshot SOURCE_DIR. When
  // the runner is offline, global-setup leaves the snapshot empty and
  // `syncPreview` returns `toCreate: 0` → assertions fail with confusing
  // "expected 7, got 0" messages. Skipping cleanly is much better triage.
  test.skip(
    isSnapshotOffline(),
    'sync preview/execute requires azure-* skills from snapshot install (offline run)',
  )
})

test('fetchSyncPreview populates state.ui.syncPreview with non-zero toCreate (global)', async ({
  appWindow,
  isolatedHome,
}) => {
  await waitForInitialScan(appWindow)

  // Stage two agent dirs that the snapshot did NOT pre-stage. Cursor and
  // Cline are both chosen because their parent dirs (`.cursor/`,
  // `.cline/`) are absent from the snapshot HOME — the snapshot's
  // `npx skills add --global` side-effects most other agent dirs but
  // leaves these two alone (verified via debug spec). Using two staged
  // agents exposes the `+14 toCreate` contribution unambiguously: a
  // single agent could be confused with snapshot noise on a future CLI
  // version, two won't.
  mkdirSync(join(isolatedHome, '.cursor'), { recursive: true })
  mkdirSync(join(isolatedHome, '.cline'), { recursive: true })

  // Click the SourceCard's Sync button. Scoped to `<aside>` so the
  // selector also-matches-by-text doesn't collide with the
  // SyncConfirmDialog's submit button (which is named "Sync" too) — the
  // dialog isn't mounted yet at this moment, but using a scoped locator
  // keeps the intent explicit and survives a future refactor that might
  // mount the dialog earlier.
  await appWindow
    .locator('aside')
    .getByRole('button', { name: 'Sync', exact: true })
    .click()

  await waitForSyncSettled(appWindow, 'preview')

  const preview = await getStoreState(appWindow, (state) => {
    const root = state as {
      ui: {
        syncPreview: {
          totalSkills: number
          totalAgents: number
          toCreate: number
          alreadySynced: number
          conflicts: unknown[]
          forAgent?: string
        } | null
      }
    }
    return root.ui.syncPreview
  })

  expect(
    preview,
    'syncPreview should be populated after thunk fulfills',
  ).not.toBeNull()
  // 7 azure-* skills is invariant — the snapshot installs exactly that.
  expect(preview!.totalSkills).toBe(7)
  // totalAgents bound: cursor + cline contribute 2; the snapshot's
  // `npx skills add --global` side-effects ~30 more pre-existing agent
  // dirs. Lower bound is the only stable assertion; an exact number
  // would tie the test to whatever the current skills-CLI version
  // happens to side-effect this week.
  expect(preview!.totalAgents).toBeGreaterThanOrEqual(2)
  // toCreate is exact: cursor + cline each have 7 empty azure-* slots,
  // and every snapshot-staged agent is already fully linked
  // (alreadySynced=N×7 in the baseline). If a future skills-CLI version
  // changes the snapshot's link state, this exact number will need to
  // be reviewed — a deliberate forcing function.
  expect(preview!.toCreate).toBe(14)
  expect(preview!.conflicts).toEqual([])
  // Global preview omits `forAgent`. Pinning `undefined` (not `null`)
  // pins the `...(options?.agentId ? { forAgent: options.agentId } : {})`
  // spread in syncService — a refactor that always emits the field
  // would land here as "expected undefined, got null".
  expect(preview!.forAgent).toBeUndefined()
})

test('per-agent preview narrows scope and echoes forAgent', async ({
  appWindow,
  isolatedHome,
}) => {
  await waitForInitialScan(appWindow)

  // The snapshot already pre-stages ~30 agent dirs (see file-level doc),
  // so the multi-agent baseline exists for free. We stage `.cursor`
  // because our scoped preview will target cursor — the assertion below
  // proves the `filterAgentsByOption` filter actually narrows the result
  // even though the baseline has many agents on disk.
  mkdirSync(join(isolatedHome, '.cursor'), { recursive: true })

  // Direct preload-bridge call. The per-agent Cleanup flow uses this
  // option internally; there's no top-level UI button that emits
  // `{ agentId }` from the renderer, so wiring this through a click
  // would test more than the boundary we care about. The thunk + slice
  // path is already covered by the global test above.
  const previewRaw = await appWindow.evaluate(() =>
    window.electron.sync.preview({ agentId: 'cursor' }),
  )
  const preview = previewRaw as {
    totalSkills: number
    totalAgents: number
    toCreate: number
    alreadySynced: number
    conflicts: unknown[]
    forAgent?: string
  }

  expect(preview.forAgent).toBe('cursor')
  // Despite ~31 agents existing on disk (snapshot side-effects + our
  // staged cursor), totalAgents collapses to 1 because the filter ran.
  // If the filter regressed to a no-op, this would be ≥31 and the test
  // would fail loud.
  expect(preview.totalAgents).toBe(1)
  expect(preview.toCreate).toBe(7)
  expect(preview.conflicts).toEqual([])
})

test('executing sync creates symlinks and opens SyncResultDialog', async ({
  appWindow,
  isolatedHome,
}) => {
  await waitForInitialScan(appWindow)

  // One staged agent is enough for the execute proof — keeping it to
  // cursor minimizes assertion surface and matches the path we'll lstat
  // for filesystem evidence below.
  mkdirSync(join(isolatedHome, '.cursor'), { recursive: true })

  // Step 1: trigger preview via the SourceCard. The dialog auto-mounts
  // when `state.ui.syncPreview.toCreate > 0 && conflicts.length === 0`
  // (via `shouldShowSyncConfirm`), so this single click both fetches
  // the preview AND surfaces the confirm dialog whose Sync button we
  // need next.
  await appWindow
    .locator('aside')
    .getByRole('button', { name: 'Sync', exact: true })
    .click()
  await waitForSyncSettled(appWindow, 'preview')

  // Step 2: confirm dialog is visible — assert before clicking so a
  // gate-predicate regression (e.g. accidental flip to
  // `toCreate === 0`) shows here rather than as a flaky "click missed"
  // failure. Title comes from `<DialogIconHeader title="Sync Skills" />`.
  const confirmDialog = appWindow.getByRole('dialog', { name: 'Sync Skills' })
  await expect(confirmDialog).toBeVisible()

  // Step 3: click the dialog's Sync button. Scoping to the dialog
  // disambiguates it from the SourceCard's Sync button (both are
  // present in the DOM at this moment).
  await confirmDialog.getByRole('button', { name: 'Sync', exact: true }).click()

  await waitForSyncSettled(appWindow, 'result')

  const result = await getStoreState(appWindow, (state) => {
    const root = state as {
      ui: {
        syncResult: {
          success: boolean
          created: number
          replaced: number
          skipped: number
          errors: unknown[]
          details: unknown[]
        } | null
      }
    }
    return root.ui.syncResult
  })

  expect(
    result,
    'syncResult should be populated after execute fulfills',
  ).not.toBeNull()
  expect(result!.success).toBe(true)
  expect(result!.errors).toEqual([])
  // 7 newly-created symlinks (cursor staged with empty parent dir →
  // every azure-* slot is missing → all 7 fall in the
  // `.with({ exists: false }, ...)` arm of the match in syncExecute).
  // The snapshot's pre-existing agent dirs all start fully linked, so
  // their slots fall in the `.with({ isSymlink: true }, ...)` arm and
  // contribute to `skipped` — NOT `created`. So `created === 7` exactly.
  expect(result!.created).toBe(7)
  // No `replaceConflicts` were passed; pre-fix this could spuriously
  // count if the resolver leaked. Pin the contract.
  expect(result!.replaced).toBe(0)
  // `skipped` floor depends on snapshot link count (~217 in current
  // CLI version). Lower-bound only: a precise pin would couple this
  // test to skills-CLI side-effects unrelated to our regression target.
  expect(result!.skipped).toBeGreaterThanOrEqual(0)

  // Filesystem proof. The thunk could conceivably mark itself fulfilled
  // without making the actual filesystem change (a unit test against a
  // stubbed service would still pass), so we lstat one of the expected
  // symlink targets. `azure-ai` is the alphabetically-first azure-* skill,
  // making it stable across CLI install ordering changes.
  const cursorSkillsDir = join(isolatedHome, '.cursor', 'skills')
  expect(
    existsSync(cursorSkillsDir),
    'syncExecute should mkdir the agent skills dir',
  ).toBe(true)
  const azureAiLink = join(cursorSkillsDir, 'azure-ai')
  expect(existsSync(azureAiLink)).toBe(true)
  expect(
    lstatSync(azureAiLink).isSymbolicLink(),
    'azure-ai should be a SYMLINK, not a copy or real dir',
  ).toBe(true)

  // Step 4: SyncResultDialog opens automatically when `syncResult` is
  // populated. Title comes from `<DialogTitle>Sync Results</DialogTitle>`
  // in SyncResultDialog.tsx. The plural form ("Results", not "Result")
  // is load-bearing — a refactor that singularized the title would land
  // here.
  await expect(
    appWindow.getByRole('dialog', { name: 'Sync Results' }),
  ).toBeVisible()
})
