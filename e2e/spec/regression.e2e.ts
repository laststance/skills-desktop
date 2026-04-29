import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'

import { test, expect } from '../fixtures/electron-app'
import {
  getStoreState,
  refreshSkillsState,
  waitForInitialScan,
  waitForSelectionCount,
} from '../helpers/redux'

interface SymlinkSnapshot {
  agentId: string
  status: 'valid' | 'broken' | 'missing'
  isLocal: boolean
  linkPath: string
}

const AZURE_AI_NAME = 'azure-ai'

/**
 * Phase-2 final spec — three regressions, each guarding a separate fix that
 * shipped in the recent release window:
 *
 * 1. Selection clear on tab/agent switch (commit 2f05684) — `redux/listener.ts`
 *    bridges `setActiveTab` / `selectAgent` to `clearSelection()`. Without it
 *    the SelectionToolbar commits Delete/Unlink against invisible ticks the
 *    user can no longer audit.
 *
 * 2. Cline/Warp aliasing fix (commit 3d20085) — pre-fix `cline.path === SOURCE_DIR`
 *    made `scanAllLocalSkills` surface every source skill as `isLocal: true`
 *    under cline/warp. Post-fix `scanDir` diverges to `.cline` / `.warp` so the
 *    scanner reads each agent's own home dir, not the universal source.
 *
 * 3. IRON RULE multi-agent path collision — `SHARED_AGENT_PATHS` adds any
 *    `agent.path` shared by ≥2 agent definitions (amp/kimi-cli/replit all
 *    resolve to `.config/agents/skills`). `isSharedAgentPath` stage 1 catches
 *    this without realpath, distinct from the symlink-alias path covered in
 *    `unlink-agent.e2e.ts` Test 3 (stages 2/3).
 *
 * Each test runs in a fresh isolated HOME so cross-test pollution can't make
 * one regression silently mask another.
 */

test('selection survives no further than a tab switch or agent switch (regression 2f05684)', async ({
  appWindow,
}) => {
  await waitForInitialScan(appWindow)

  // Tab-switch leg — toggle one azure-* skill into the selection, flip the
  // active tab, expect listener middleware to dispatch clearSelection.
  await appWindow.evaluate((skillName: string) => {
    const store = window.__store__ ?? window.__store
    store?.dispatch({ type: 'skills/toggleSelection', payload: skillName })
  }, AZURE_AI_NAME)
  await waitForSelectionCount(appWindow, 1)

  await appWindow.evaluate(() => {
    const store = window.__store__ ?? window.__store
    store?.dispatch({ type: 'ui/setActiveTab', payload: 'marketplace' })
  })
  await waitForSelectionCount(appWindow, 0)

  // Agent-switch leg — same matcher set in listener.ts, different action.
  // Re-tick the selection to prove the listener fires on a second action and
  // not just once per session.
  await appWindow.evaluate(() => {
    const store = window.__store__ ?? window.__store
    store?.dispatch({ type: 'ui/setActiveTab', payload: 'installed' })
  })
  await appWindow.evaluate((skillName: string) => {
    const store = window.__store__ ?? window.__store
    store?.dispatch({ type: 'skills/toggleSelection', payload: skillName })
  }, AZURE_AI_NAME)
  await waitForSelectionCount(appWindow, 1)

  await appWindow.evaluate(() => {
    const store = window.__store__ ?? window.__store
    store?.dispatch({ type: 'ui/selectAgent', payload: 'cursor' })
  })
  await waitForSelectionCount(appWindow, 0)
})

/**
 * Phase-4 D1 (issue #114) — selection clears when `fetchSyncPreview.pending`
 * fires. This is the THIRD leg of the listener matcher in `redux/listener.ts:79`
 * (`isAnyOf(setActiveTab, selectAgent, fetchSyncPreview.pending)`); the test
 * above pins the first two legs but the thunk leg has been silently uncovered.
 *
 * Why a separate test rather than appending to the leg-1+leg-2 case: the
 * behaviour under test diverges from the others in two ways. First, the action
 * payload comes from a thunk lifecycle (RTK auto-generates `.type`,
 * `.meta.requestStatus`, etc.) rather than a hand-rolled sync action — a
 * regression that swapped `fetchSyncPreview.pending` for the wrong action
 * creator (e.g. the `executeSyncAction.pending` thunk, which has near-identical
 * shape but does NOT belong in the matcher) would slip past leg-1+leg-2
 * coverage. Second, this leg is the pre-flight clear before a long-running
 * conflict-detection IPC; if the listener stops firing here, every conflict
 * dialog opens with stale selection state and the user's Delete/Unlink button
 * commits against the prior tab's ticks. Worth its own row.
 *
 * Implementation note — synthetic vs. genuine thunk dispatch:
 *
 * RTK's `dispatch(thunkFn())` synchronously dispatches a `.pending` action with
 * shape `{ type: 'ui/fetchSyncPreview/pending', meta: {...} }` BEFORE awaiting
 * the IPC. The listener uses `isAnyOf(fetchSyncPreview.pending)` which RTK
 * compiles to `(action) => action.type === 'ui/fetchSyncPreview/pending'` — i.e.,
 * pure type-string matching. Dispatching the same action shape directly is
 * functionally identical for the matcher contract under test.
 *
 * We pick this over a UI-driven click (e.g. `getByRole('button', { name: 'Sync' })`)
 * because the existing leg-1/leg-2 test already uses synthetic dispatch for
 * `setActiveTab` / `selectAgent` and the spec stays consistent. UI-driven would
 * also bring brittleness (button visibility / disabled state during the test's
 * isolated-HOME bootstrap) that this test doesn't need to absorb.
 */
test('selection clears on fetchSyncPreview.pending — third listener-matcher leg (regression 2f05684 follow-up)', async ({
  appWindow,
}) => {
  await waitForInitialScan(appWindow)

  // Tick one azure-* skill so the listener has something to clear. Leg-1/-2
  // test re-ticks between dispatches; we don't need that here because there's
  // exactly one matcher leg under test.
  await appWindow.evaluate((skillName: string) => {
    const store = window.__store__ ?? window.__store
    store?.dispatch({ type: 'skills/toggleSelection', payload: skillName })
  }, AZURE_AI_NAME)
  await waitForSelectionCount(appWindow, 1)

  // Dispatch the exact action shape RTK builds when a real thunk fires .pending.
  // `meta.requestStatus: 'pending'` is what RTK's internal action creators add;
  // we mirror it for fidelity even though `isAnyOf` only inspects `.type`. If a
  // future RTK version ever switched `isAnyOf` to also match on
  // `meta.requestStatus`, this test stays correct without modification.
  await appWindow.evaluate(() => {
    const store = window.__store__ ?? window.__store
    store?.dispatch({
      type: 'ui/fetchSyncPreview/pending',
      meta: {
        arg: undefined,
        requestId: 'e2e-d1-listener',
        requestStatus: 'pending',
      },
    })
  })
  await waitForSelectionCount(appWindow, 0)

  // Negative control — `executeSyncAction.pending` has the same shape family
  // but is intentionally NOT in the matcher (only fetchSyncPreview.pending is).
  // Re-tick the selection, dispatch the wrong-thunk pending action, and confirm
  // selection STAYS at 1. Without this leg, a regression that broadened the
  // matcher to `isAnyOf(..., fetchSyncPreview.pending, executeSyncAction.pending)`
  // would silently pass — losing the "selection clears on PREVIEW only, not on
  // every sync-related thunk" contract that the listener encodes.
  await appWindow.evaluate((skillName: string) => {
    const store = window.__store__ ?? window.__store
    store?.dispatch({ type: 'skills/toggleSelection', payload: skillName })
  }, AZURE_AI_NAME)
  await waitForSelectionCount(appWindow, 1)

  await appWindow.evaluate(() => {
    const store = window.__store__ ?? window.__store
    store?.dispatch({
      type: 'ui/executeSyncAction/pending',
      meta: {
        arg: { replaceConflicts: [] },
        requestId: 'e2e-d1-negative',
        requestStatus: 'pending',
      },
    })
  })
  // Assert selection count remains 1 after the wrong-thunk dispatch. Direct
  // synchronous read instead of `waitForSelectionCount` because we need to
  // assert STABILITY (the listener should NOT have cleared); a wait helper
  // would silently succeed if the count happened to be 1 at the moment of
  // sampling but would be cleared shortly after.
  const selectedAfterWrongPending = await getStoreState(appWindow, (state) => {
    const root = state as {
      skills: { selectedSkillNames: string[] }
    }
    return root.skills.selectedSkillNames.length
  })
  expect(selectedAfterWrongPending).toBe(1)
})

test('cline/warp do NOT report universal source skills as their own local skills (regression 3d20085)', async ({
  appWindow,
  isolatedHome,
}) => {
  await waitForInitialScan(appWindow)

  // FS truth — universal source has azure-ai but neither cline nor warp's
  // own scanDir does. If post-fix scanner reads the right place, cline/warp
  // symlink entries should reflect this asymmetry rather than mirror SOURCE_DIR.
  expect(
    existsSync(join(isolatedHome, '.agents', 'skills', AZURE_AI_NAME)),
  ).toBe(true)
  // Cline/Warp scanDirs may not exist in the snapshot HOME at all — the
  // skills CLI only creates `~/.cline/skills` and `~/.warp/skills` when an
  // agent is targeted via `--agent`, and global-setup intentionally does not.
  // Skipping `readdirSync` when the dir is absent is sound: a non-existent
  // dir trivially cannot contain `azure-ai`, so the contrapositive of the
  // assertion still holds. The block runs only when the layout *could*
  // contain a false-positive.
  const clineDirExists = existsSync(join(isolatedHome, '.cline', 'skills'))
  const warpDirExists = existsSync(join(isolatedHome, '.warp', 'skills'))
  if (clineDirExists) {
    expect(
      readdirSync(join(isolatedHome, '.cline', 'skills')).includes(
        AZURE_AI_NAME,
      ),
    ).toBe(false)
  }
  if (warpDirExists) {
    expect(
      readdirSync(join(isolatedHome, '.warp', 'skills')).includes(
        AZURE_AI_NAME,
      ),
    ).toBe(false)
  }

  const azureSymlinks = await getStoreState(
    appWindow,
    (state): SymlinkSnapshot[] => {
      const root = state as {
        skills: {
          items: Array<{ name: string; symlinks: SymlinkSnapshot[] }>
        }
      }
      const azure = root.skills.items.find((skill) => skill.name === 'azure-ai')
      return azure?.symlinks ?? []
    },
  )

  // The load-bearing assertion. Pre-fix would have set
  //   { status: 'valid', isLocal: true, linkPath: '<HOME>/.agents/skills/azure-ai' }
  // because cline.path === SOURCE_DIR caused `checkLinkOrLocal` to lstat the
  // real source dir as if it belonged to cline. Post-fix the linkPath must
  // route through each agent's own scanDir, and `isLocal` must stay false
  // (the agent has no real folder of its own — at most a missing symlink).
  for (const agentId of ['cline', 'warp']) {
    const entry = azureSymlinks.find((symlink) => symlink.agentId === agentId)
    expect(
      entry,
      `azure-ai symlink for ${agentId} must be present`,
    ).toBeDefined()
    if (!entry) continue
    expect(
      entry.isLocal,
      `${agentId} must NOT surface azure-ai as local — pre-fix bug indicator`,
    ).toBe(false)
    expect(
      entry.linkPath,
      `${agentId} linkPath must point at its own scanDir, not SOURCE_DIR`,
    ).not.toContain(`${isolatedHome}/.agents/skills/`)
  }

  // Sanity — the source-side row for azure-ai still exists, so the regression
  // would fail closed (assertion above) rather than silently skip.
  await refreshSkillsState(appWindow)
  const stillPresent = await getStoreState(appWindow, (state) => {
    const root = state as { skills: { items: Array<{ name: string }> } }
    return root.skills.items.some((skill) => skill.name === 'azure-ai')
  })
  expect(stillPresent).toBe(true)
})

test('removeAllFromAgent refuses on a multi-agent shared scanDir (.config/agents/skills)', async ({
  appWindow,
  isolatedHome,
}) => {
  // Pre-stage the shared scanDir as a real directory with a sentinel entry —
  // amp, kimi-cli, replit all resolve to this path, so SHARED_AGENT_PATHS
  // includes it via the multi-agent collision pass in main/constants.ts.
  // No symlinking required: stage 1 (`SHARED_AGENT_PATHS.has(resolved)`) of
  // `isSharedAgentPath` short-circuits before any realpath fallback runs.
  const sharedScanDir = join(isolatedHome, '.config', 'agents', 'skills')
  mkdirSync(sharedScanDir, { recursive: true })
  const sentinelPath = join(sharedScanDir, 'iron-rule-sentinel.md')
  writeFileSync(sentinelPath, '# sentinel\n')

  await waitForInitialScan(appWindow)

  const result = await appWindow.evaluate(
    async (args: { agentId: string; agentPath: string }) =>
      window.electron.skills.removeAllFromAgent(args),
    { agentId: 'amp', agentPath: sharedScanDir },
  )

  expect(result.success).toBe(false)
  expect(result.removedCount).toBe(0)
  expect(result.error).toMatch(/Refusing to delete a shared skills folder/)

  // FS — the sentinel still exists. If the IRON RULE check ever migrates to
  // run AFTER `shell.trashItem`, this assertion fails immediately because the
  // dir would be in macOS Trash. Keeps the order-of-operations contract
  // verifiable without inspecting the OS Trash bin.
  expect(existsSync(sharedScanDir)).toBe(true)
  expect(existsSync(sentinelPath)).toBe(true)
})

/**
 * Phase-4 B1 (issue #114) — IRON RULE refusal preserves BOTH symlink aliases
 * and legitimate per-agent local skills inside a shared scanDir.
 *
 * The previous test verifies the refusal copy + the trivial sentinel survives.
 * This one extends the layout to the realistic case a user might hit: an
 * agent dir that mixes
 *
 *   - a symlink alias to `~/.agents/skills/<name>` (universal source bytes)
 *   - a real local-skill directory with its own SKILL.md (per-agent bytes)
 *
 * The contract: refusal is *all-or-nothing*. The handler must NOT selectively
 * unlink aliases while keeping local skills, NOR rm the local skill while
 * sparing aliases. A regression that introduced "smart" partial-cleanup logic
 * would break this — and a regression that moved `isSharedAgentPath` after
 * `shell.trashItem` would silently trash the entire mixed directory.
 *
 * The shared scanDir is `.config/agents/skills/` (multi-agent collision via
 * `SHARED_AGENT_PATHS`). Stage 1 of `isSharedAgentPath` short-circuits before
 * any realpath fallback runs, so this test specifically covers the
 * "non-aliased shared path with rich contents" axis — distinct from
 * `unlink-agent.e2e.ts` Test 3 (stage 2/3 via symlink-alias scanDir).
 */
test('removeAllFromAgent refusal leaves both aliased symlinks and local skill bytes untouched', async ({
  appWindow,
  isolatedHome,
}) => {
  const sharedScanDir = join(isolatedHome, '.config', 'agents', 'skills')
  mkdirSync(sharedScanDir, { recursive: true })

  // Source skill the alias points at — the global-setup scan creates this.
  const aliasTargetPath = join(isolatedHome, '.agents', 'skills', AZURE_AI_NAME)
  expect(
    existsSync(aliasTargetPath),
    `expected snapshot SOURCE_DIR to contain ${AZURE_AI_NAME}; global-setup may have changed`,
  ).toBe(true)

  // Pre-stage mixed contents inside the shared dir.
  const aliasLinkPath = join(sharedScanDir, 'b1-azure-alias')
  symlinkSync(aliasTargetPath, aliasLinkPath)

  const localSkillDirPath = join(sharedScanDir, 'b1-local-only')
  mkdirSync(localSkillDirPath, { recursive: true })
  const localSkillContents = '# b1-local-only\n\nLocal-only fixture skill.\n'
  writeFileSync(join(localSkillDirPath, 'SKILL.md'), localSkillContents)

  await waitForInitialScan(appWindow)

  const result = await appWindow.evaluate(
    async (args: { agentId: string; agentPath: string }) =>
      window.electron.skills.removeAllFromAgent(args),
    { agentId: 'amp', agentPath: sharedScanDir },
  )

  expect(result.success).toBe(false)
  expect(result.removedCount).toBe(0)
  expect(result.error).toMatch(/Refusing to delete a shared skills folder/)

  // FS — the alias still resolves to the source target, the local skill is
  // byte-for-byte intact, and the source target itself is unchanged. Reading
  // the local SKILL.md back is the load-bearing assertion: a regression that
  // truncated, renamed, or trash-routed the local dir would surface here.
  expect(lstatSync(aliasLinkPath).isSymbolicLink()).toBe(true)
  expect(existsSync(aliasTargetPath)).toBe(true)
  expect(existsSync(localSkillDirPath)).toBe(true)
  expect(existsSync(join(localSkillDirPath, 'SKILL.md'))).toBe(true)
  expect(readFileSync(join(localSkillDirPath, 'SKILL.md'), 'utf-8')).toBe(
    localSkillContents,
  )
})

/**
 * Phase-4 B2 (issue #114) — IRON RULE refusal must trigger even when
 * SOURCE_DIR itself is a symlink (macOS firmlink edge).
 *
 * On macOS, paths like `/var → /private/var` are firmlinks: a path can be
 * structurally a symlink while pretending to be a real directory. If a user's
 * `~/.agents/skills/` is hosted on a synced volume or a development setup
 * routes it via symlink, `resolve(SOURCE_DIR)` and `realpath(SOURCE_DIR)`
 * diverge — and the IRON RULE refusal must still fire.
 *
 * Layout staged below:
 *   - `<HOME>/.agents-real/skills/`  (real dir, holds the snapshot bytes)
 *   - `<HOME>/.agents/skills`        (symlink → .agents-real/skills)
 *   - `<HOME>/.cursor/skills`        (symlink → .agents/skills, two hops)
 *
 * `isSharedAgentPath('<HOME>/.cursor/skills')` walks all three stages:
 *   - Stage 1: SHARED_AGENT_PATHS keyed by resolve()-form (no realpath). Miss.
 *   - Stage 2: realpath(input) = .agents-real/skills. SHARED_AGENT_PATHS holds
 *             resolve(SOURCE_DIR) = .agents/skills (literal join, no realpath
 *             at construction time). Miss.
 *   - Stage 3: forward-realpath each shared path. realpath(.agents/skills) =
 *             .agents-real/skills, matches realInput. HIT — returns true.
 *
 * Without stage 3 the refusal would NOT fire and `shell.trashItem` would
 * cascade through SOURCE_DIR's symlink and wipe `.agents-real/skills/`,
 * destroying every universal agent's source bytes. The existing
 * `unlink-agent.e2e.ts` Test 3 covers stage 2 only (single-hop alias).
 */
test('removeAllFromAgent refusal still fires when SOURCE_DIR itself is a symlink (firmlink edge)', async ({
  appWindow,
  isolatedHome,
}) => {
  // Wait for the renderer's initial scan BEFORE renaming SOURCE_DIR.
  // The scanner reads SOURCE_DIR's contents; renaming mid-scan would race
  // and could surface as a flaky ENOENT in the renderer's fetchSkills
  // thunk — distinct from the IPC contract we're actually testing here.
  await waitForInitialScan(appWindow)

  const symbolicSourceDir = join(isolatedHome, '.agents', 'skills')
  const realSourceDirParent = join(isolatedHome, '.agents-real')
  const realSourceDir = join(realSourceDirParent, 'skills')

  // Sanity — confirm fixture state is clean before the rename. A previous
  // test leaving `.agents-real` behind (cross-test pollution from a
  // before-fix rmSync that skipped the dir) would silently merge into our
  // fixture and we'd be testing whatever residue was there.
  expect(
    existsSync(realSourceDirParent),
    `expected ${realSourceDirParent} to be absent — isolated home leaked across tests`,
  ).toBe(false)

  // Step 1: relocate the snapshot's source bytes to .agents-real/skills/.
  // renameSync is sound here because cp -al -based snapshots create real
  // directories (only files are hardlinked); moving the directory entry
  // doesn't touch the file inodes underneath.
  mkdirSync(realSourceDirParent, { recursive: true })
  renameSync(symbolicSourceDir, realSourceDir)

  // Step 2: turn .agents/skills into a symlink → .agents-real/skills. From
  // the app's perspective SOURCE_DIR is unchanged in path; realpath()
  // diverges, which is the firmlink edge under test.
  symlinkSync(realSourceDir, symbolicSourceDir)
  expect(lstatSync(symbolicSourceDir).isSymbolicLink()).toBe(true)

  // Step 3: stage cursor as a second symlink hop → SOURCE_DIR (which itself
  // resolves through one more hop to realSourceDir). Two-hop chain is what
  // proves stage 3 of `isSharedAgentPath` keeps walking past stage 2's miss.
  const cursorAgentPath = join(isolatedHome, '.cursor', 'skills')
  expect(
    existsSync(cursorAgentPath),
    `cursor scanDir ${cursorAgentPath} unexpectedly exists pre-stage`,
  ).toBe(false)
  mkdirSync(dirname(cursorAgentPath), { recursive: true })
  symlinkSync(symbolicSourceDir, cursorAgentPath)

  const realSourceContentsBefore = readdirSync(realSourceDir).sort()
  expect(
    realSourceContentsBefore.length,
    'expected the relocated SOURCE_DIR to retain the snapshot contents',
  ).toBeGreaterThan(0)

  const result = await appWindow.evaluate(
    async (args: { agentId: string; agentPath: string }) =>
      window.electron.skills.removeAllFromAgent(args),
    { agentId: 'cursor', agentPath: cursorAgentPath },
  )

  expect(result.success).toBe(false)
  expect(result.removedCount).toBe(0)
  expect(result.error).toMatch(/Refusing to delete a shared skills folder/)

  // FS — every link still in place, every byte in realSourceDir untouched.
  // If stage 3 ever regresses (e.g. someone "optimizes" the loop away because
  // it's the slow path), `shell.trashItem(cursorAgentPath)` would route
  // through both hops to realSourceDir and wipe it. Comparing the directory
  // listings is the load-bearing assertion against that catastrophic outcome.
  expect(lstatSync(symbolicSourceDir).isSymbolicLink()).toBe(true)
  expect(lstatSync(cursorAgentPath).isSymbolicLink()).toBe(true)
  expect(readdirSync(realSourceDir).sort()).toEqual(realSourceContentsBefore)
})
