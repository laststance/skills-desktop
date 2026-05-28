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
import { isSnapshotOffline } from '../fixtures/isolated-home'
import { expectIronRuleRefusal } from '../helpers/iron-rule'
import {
  dispatchAction,
  getSelectionCount,
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

interface E2EFilesystemIdentity {
  kind: 'directory' | 'symlink' | 'file' | 'other'
  dev: number
  ino: number
  size: number
  ctimeMs: number
  mtimeMs: number
}

const AZURE_AI_NAME = 'azure-ai'

/**
 * Skip only tests whose assertion target comes from the snapshot install.
 * @returns void; Playwright marks the current test skipped when offline.
 * @example skipWhenAzureSnapshotOffline()
 */
function skipWhenAzureSnapshotOffline(): void {
  test.skip(
    isSnapshotOffline(),
    'azure-* skills required for this test; runner is offline (global-setup wrote snapshot.offline=true)',
  )
}

/**
 * Stage a minimal source skill inside the isolated HOME before renderer scans.
 * @param isolatedHome - Test HOME from the Electron fixture.
 * @param skillName - Skill folder name to create under ~/.agents/skills.
 * @returns Absolute source skill directory path.
 * @example stageSourceSkill('/tmp/home', 'fixture-skill')
 */
function stageSourceSkill(isolatedHome: string, skillName: string): string {
  const sourcePath = join(isolatedHome, '.agents', 'skills', skillName)
  mkdirSync(sourcePath, { recursive: true })
  writeFileSync(join(sourcePath, 'SKILL.md'), `# ${skillName}\n`)
  return sourcePath
}

/**
 * Build the reviewed directory identity required by removeAllFromAgent IPC.
 * @param path - Reviewed agent skills path.
 * @returns Serializable identity copied from Node lstat metadata.
 * @example filesystemIdentityForPath('/tmp/home/.config/agents/skills')
 */
function filesystemIdentityForPath(path: string): E2EFilesystemIdentity {
  const stats = lstatSync(path)
  return {
    kind: stats.isSymbolicLink()
      ? 'symlink'
      : stats.isDirectory()
        ? 'directory'
        : stats.isFile()
          ? 'file'
          : 'other',
    dev: stats.dev,
    ino: stats.ino,
    size: stats.size,
    ctimeMs: stats.ctimeMs,
    mtimeMs: stats.mtimeMs,
  }
}

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
  skipWhenAzureSnapshotOffline()
  await waitForInitialScan(appWindow)

  // Tab-switch leg — toggle one azure-* skill into the selection, flip the
  // active tab, expect listener middleware to dispatch clearSelection.
  await dispatchAction(appWindow, {
    type: 'skills/toggleSelection',
    payload: AZURE_AI_NAME,
  })
  await waitForSelectionCount(appWindow, 1)

  await dispatchAction(appWindow, {
    type: 'ui/setActiveTab',
    payload: 'marketplace',
  })
  await waitForSelectionCount(appWindow, 0)

  // Agent-switch leg — same matcher set in listener.ts, different action.
  // Re-tick the selection to prove the listener fires on a second action and
  // not just once per session.
  await dispatchAction(appWindow, {
    type: 'ui/setActiveTab',
    payload: 'installed',
  })
  await dispatchAction(appWindow, {
    type: 'skills/toggleSelection',
    payload: AZURE_AI_NAME,
  })
  await waitForSelectionCount(appWindow, 1)

  await dispatchAction(appWindow, {
    type: 'ui/selectAgent',
    payload: 'cursor',
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
  skipWhenAzureSnapshotOffline()
  await waitForInitialScan(appWindow)

  // Tick one azure-* skill so the listener has something to clear. Leg-1/-2
  // test re-ticks between dispatches; we don't need that here because there's
  // exactly one matcher leg under test.
  await dispatchAction(appWindow, {
    type: 'skills/toggleSelection',
    payload: AZURE_AI_NAME,
  })
  await waitForSelectionCount(appWindow, 1)

  // Dispatch the exact action shape RTK builds when a real thunk fires .pending.
  // `meta.requestStatus: 'pending'` is what RTK's internal action creators add;
  // we mirror it for fidelity even though `isAnyOf` only inspects `.type`. If a
  // future RTK version ever switched `isAnyOf` to also match on
  // `meta.requestStatus`, this test stays correct without modification.
  await dispatchAction(appWindow, {
    type: 'ui/fetchSyncPreview/pending',
    meta: {
      arg: undefined,
      requestId: 'e2e-d1-listener',
      requestStatus: 'pending',
    },
  })
  await waitForSelectionCount(appWindow, 0)

  // Negative control — `executeSyncAction.pending` has the same shape family
  // but is intentionally NOT in the matcher (only fetchSyncPreview.pending is).
  // Re-tick the selection, dispatch the wrong-thunk pending action, and confirm
  // selection STAYS at 1. Without this leg, a regression that broadened the
  // matcher to `isAnyOf(..., fetchSyncPreview.pending, executeSyncAction.pending)`
  // would silently pass — losing the "selection clears on PREVIEW only, not on
  // every sync-related thunk" contract that the listener encodes.
  await dispatchAction(appWindow, {
    type: 'skills/toggleSelection',
    payload: AZURE_AI_NAME,
  })
  await waitForSelectionCount(appWindow, 1)

  await dispatchAction(appWindow, {
    type: 'ui/executeSyncAction/pending',
    meta: {
      arg: { replaceConflicts: [] },
      requestId: 'e2e-d1-negative',
      requestStatus: 'pending',
    },
  })
  // Assert selection count remains 1 after the wrong-thunk dispatch. Direct
  // synchronous read instead of `waitForSelectionCount` because we need to
  // assert STABILITY (the listener should NOT have cleared); a wait helper
  // would silently succeed if the count happened to be 1 at the moment of
  // sampling but would be cleared shortly after.
  expect(await getSelectionCount(appWindow)).toBe(1)
})

test('cline/warp do NOT report universal source skills as their own local skills (regression 3d20085)', async ({
  appWindow,
  isolatedHome,
}) => {
  skipWhenAzureSnapshotOffline()
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

  await appWindow.waitForFunction(() =>
    Boolean(window.electron?.skills?.removeAllFromAgent),
  )

  const result = await appWindow.evaluate(
    async (args: {
      agentId: string
      agentPath: string
      filesystemIdentity: E2EFilesystemIdentity
    }) => window.electron.skills.removeAllFromAgent(args),
    {
      agentId: 'amp',
      agentPath: sharedScanDir,
      filesystemIdentity: filesystemIdentityForPath(sharedScanDir),
    },
  )

  expectIronRuleRefusal(result)

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

  // Source skill the alias points at. This test owns the fixture so the safety
  // check stays active even when the global snapshot install is offline.
  const aliasSkillName = 'b1-source-alias-fixture'
  const aliasTargetPath = stageSourceSkill(isolatedHome, aliasSkillName)

  // Pre-stage mixed contents inside the shared dir.
  const aliasLinkPath = join(sharedScanDir, 'b1-azure-alias')
  symlinkSync(aliasTargetPath, aliasLinkPath)

  const localSkillDirPath = join(sharedScanDir, 'b1-local-only')
  mkdirSync(localSkillDirPath, { recursive: true })
  const localSkillContents = '# b1-local-only\n\nLocal-only fixture skill.\n'
  writeFileSync(join(localSkillDirPath, 'SKILL.md'), localSkillContents)

  await waitForInitialScan(appWindow)

  const result = await appWindow.evaluate(
    async (args: {
      agentId: string
      agentPath: string
      filesystemIdentity: E2EFilesystemIdentity
    }) => window.electron.skills.removeAllFromAgent(args),
    {
      agentId: 'amp',
      agentPath: sharedScanDir,
      filesystemIdentity: filesystemIdentityForPath(sharedScanDir),
    },
  )

  expectIronRuleRefusal(result)

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
  stageSourceSkill(isolatedHome, 'firmlink-source-fixture')
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

  // Step 1: relocate the staged source bytes to .agents-real/skills/.
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
    'expected the relocated SOURCE_DIR to retain staged source contents',
  ).toBeGreaterThan(0)

  const result = await appWindow.evaluate(
    async (args: {
      agentId: string
      agentPath: string
      filesystemIdentity: E2EFilesystemIdentity
    }) => window.electron.skills.removeAllFromAgent(args),
    {
      agentId: 'cursor',
      agentPath: cursorAgentPath,
      filesystemIdentity: filesystemIdentityForPath(cursorAgentPath),
    },
  )

  expectIronRuleRefusal(result)

  // FS — every link still in place, every byte in realSourceDir untouched.
  // If stage 3 ever regresses (e.g. someone "optimizes" the loop away because
  // it's the slow path), `shell.trashItem(cursorAgentPath)` would route
  // through both hops to realSourceDir and wipe it. Comparing the directory
  // listings is the load-bearing assertion against that catastrophic outcome.
  expect(lstatSync(symbolicSourceDir).isSymbolicLink()).toBe(true)
  expect(lstatSync(cursorAgentPath).isSymbolicLink()).toBe(true)
  expect(readdirSync(realSourceDir).sort()).toEqual(realSourceContentsBefore)
})

/**
 * Issue #127 — `scanSkills` must surface broken symlinks whose source skill
 * no longer exists in `~/.agents/skills/` as synthetic `Skill` records with
 * `isOrphan: true`. Pre-fix the scanner walked SOURCE_DIR only, so a dangling
 * link in an agent dir (typically left behind when the user `rm -rf`'d a
 * source skill outside the app, or when an upstream marketplace skill was
 * removed) was silently dropped from `state.skills.items`. Users would see
 * filesystem garbage that the app pretended did not exist — no row to click,
 * no way to clean up.
 *
 * Post-fix `scanOrphanSymlinks` runs alongside the source/local scans and
 * collapses each orphan name into one Skill row whose per-agent `symlinks[]`
 * marks affected agents as `'broken'` and the rest as `'missing'`. The
 * renderer reads `isOrphan` directly off the record (`skillItemHelpers.ts`)
 * to gate the delete/unlink buttons — operating against a phantom source
 * would otherwise dispatch IPC calls that fail mid-flight.
 *
 * Setup avoids depending on the snapshot's azure-* layout: we stage a
 * fresh dangling symlink under `~/.codeium/windsurf/skills/`. Windsurf is
 * non-universal (its `scanDir` is `.codeium/windsurf`, not the universal
 * SOURCE_DIR), so the orphan scanner finds it via its own `agent.path`
 * walk rather than via the shared SOURCE_DIR readdir that universal
 * agents collapse into.
 *
 * Three load-bearing assertions:
 *   1. Orphan record EXISTS in `state.skills.items` — pre-fix this row
 *      would be missing entirely, which is the actual regression.
 *   2. `isOrphan: true` and `isSource: false` — the renderer's gate flags.
 *   3. Per-agent symlink row contract — windsurf is `'broken'`, every other
 *      agent is `'missing'`. A regression that mass-flagged every agent
 *      slot would silently break the renderer's broken-vs-missing badge
 *      logic without surfacing in a sourced-skill assertion.
 *
 * Negative control on a self-staged real source in the same store state
 * confirms the orphan flag did NOT broaden across all rows — the previous
 * three assertions alone could pass while every row got `isOrphan: true`.
 */
test('scanSkills surfaces broken symlinks as orphan skills (regression #127)', async ({
  appWindow,
  isolatedHome,
}) => {
  stageSourceSkill(isolatedHome, 'source-control-fixture')
  await waitForInitialScan(appWindow)

  // Stage the orphan condition: a non-universal agent dir containing a
  // dangling symlink whose target source has never existed (equivalent to
  // a user-driven `rm -rf ~/.agents/skills/<name>` after install). The
  // `phantom-` prefix isolates this fixture from any name the snapshot's
  // azure-* install could ever produce, so a future global-setup change
  // cannot collide with the test by accident.
  const orphanSkillName = 'phantom-orphan-fixture'
  const windsurfSkillsDir = join(isolatedHome, '.codeium', 'windsurf', 'skills')
  mkdirSync(windsurfSkillsDir, { recursive: true })

  // Target intentionally absent — `checkSymlinkTargetFromKnownLink` resolves
  // a dangling link to status `'broken'`, which is what `scanOrphanSymlinks`
  // filters on.
  const phantomSourcePath = join(
    isolatedHome,
    '.agents',
    'skills',
    orphanSkillName,
  )
  const orphanLinkPath = join(windsurfSkillsDir, orphanSkillName)
  symlinkSync(phantomSourcePath, orphanLinkPath)

  // FS sanity — the staged shape must be a real symlink with an absent
  // target. `existsSync` follows symlinks so a broken link reads as `false`;
  // `lstatSync` does NOT follow, so it confirms the symlink itself is real.
  expect(lstatSync(orphanLinkPath).isSymbolicLink()).toBe(true)
  expect(existsSync(phantomSourcePath)).toBe(false)
  expect(existsSync(orphanLinkPath)).toBe(false)

  await refreshSkillsState(appWindow)

  interface OrphanSkillSnapshot {
    name: string
    isOrphan: boolean
    isSource: boolean
    description: string
    symlinks: SymlinkSnapshot[]
  }

  const orphanRecord = await getStoreState(
    appWindow,
    (state): OrphanSkillSnapshot | null => {
      const root = state as {
        skills: { items: OrphanSkillSnapshot[] }
      }
      return (
        root.skills.items.find(
          (skill) => skill.name === 'phantom-orphan-fixture',
        ) ?? null
      )
    },
  )

  expect(
    orphanRecord,
    'orphan skill must surface in state.skills.items — pre-fix bug indicator (the entire row was being silently dropped)',
  ).not.toBeNull()
  if (!orphanRecord) return

  // KEY — Skill.isOrphan is the single flag the renderer reads to suppress
  // the delete/unlink buttons in `getSkillItemVisibility`. A regression
  // that flipped this back to `false` for orphans would re-introduce the
  // confusing UX where users click "delete" against a phantom source path
  // and watch the IPC fail mid-flight.
  expect(orphanRecord.isOrphan).toBe(true)
  expect(orphanRecord.isSource).toBe(false)
  expect(orphanRecord.description).toBe(
    'Orphan symlink — source skill no longer exists',
  )

  // The windsurf row must reflect our staged broken symlink. A regression
  // in Phase 2's `findIndex` / slot-assignment block would land here as
  // `'missing'` instead of `'broken'`.
  const windsurfRow = orphanRecord.symlinks.find(
    (symlink) => symlink.agentId === 'windsurf',
  )
  expect(
    windsurfRow,
    'windsurf row must be present — every AGENTS entry gets a slot, including agents without a broken link',
  ).toBeDefined()
  expect(windsurfRow?.status).toBe('broken')
  expect(windsurfRow?.isLocal).toBe(false)

  // Agents without a staged broken link must register as 'missing' — NOT
  // 'broken'. A regression that marked every agent slot as broken (e.g.
  // by inverting the slot-found check) would silently flip 'missing' to
  // 'broken' across the whole symlinks[] array.
  const claudeRow = orphanRecord.symlinks.find(
    (symlink) => symlink.agentId === 'claude-code',
  )
  expect(claudeRow?.status).toBe('missing')

  // Negative control — a real source skill MUST NOT be flagged
  // as orphan. A regression that broadened the orphan branch (e.g. moving
  // `isOrphan: true` outside the orphan-scan block in scanSkills.ts) would
  // pass the orphan-row assertions above but flip every source skill into
  // `isOrphan: true`, hiding their delete/unlink buttons across the UI.
  // This spec stages the control source itself so it remains active offline.
  // `getStoreState` re-evaluates the selector inside the renderer via
  // `Function.toString`, so closure-scope identifiers would resolve to
  // `undefined` at runtime. Inline the literal string.
  const sourceRecord = await getStoreState(
    appWindow,
    (state): { isOrphan: boolean; isSource: boolean } | null => {
      const root = state as {
        skills: {
          items: Array<{ name: string; isOrphan: boolean; isSource: boolean }>
        }
      }
      const source = root.skills.items.find(
        (skill) => skill.name === 'source-control-fixture',
      )
      return source
        ? { isOrphan: source.isOrphan, isSource: source.isSource }
        : null
    },
  )
  expect(
    sourceRecord,
    'source-control-fixture (real source) must remain in skills.items alongside the orphan',
  ).not.toBeNull()
  expect(sourceRecord?.isOrphan).toBe(false)
  expect(sourceRecord?.isSource).toBe(true)
})

/**
 * v0.16.0 — Sidebar truncate invariant (regression a541de9).
 *
 * The Sidebar `<aside aria-label="Agent sidebar" class="w-68">` measures 272px
 * (Tailwind v4 auto-generates `w-68` as `width: 17rem`). Inside it, Radix's
 * `<ScrollArea>` injects a wrapper `<div style="min-width: 100%; display:
 * table">` between `ScrollAreaPrimitive.Viewport` and our content. `display:
 * table` makes the wrapper grow to its `min-content` width when any descendant
 * is `whitespace-nowrap` / `truncate` — in our case the SourceCard's `<p
 * class="truncate">~/.agents/skills</p>` plus the agents list defeated
 * truncation entirely, inflating the wrapper to ~325px and bleeding the long
 * path into the center panel.
 *
 * The fix is the `[&>div]:!block` modifier on `ScrollAreaPrimitive.Viewport`
 * in `src/renderer/src/components/ui/scroll-area.tsx:39`, which forces Radix's
 * inline `display: table` to `block`. The `!important` is required because
 * Radix sets `display` via inline style — class rules don't outrank inline
 * styles without it. With `display: block`, the wrapper takes exactly the
 * viewport width and `truncate` can clip again.
 *
 * Surface assertions, ranked by load-bearing-ness:
 *
 *   1. Inner Radix wrapper width ≤ aside width — the bug visualises here. Pre-fix
 *      this was 325 vs 272; post-fix it's ≤ 272. Asserting `≤` rather than `===`
 *      stays robust against future cosmetic changes (e.g. a vertical scrollbar
 *      narrowing the viewport by 8-10px).
 *
 *   2. `getComputedStyle(wrapper).display === 'block'` — the SOURCE of the bug. A
 *      regression that removes `[&>div]:!block` from scroll-area.tsx flips this
 *      back to 'table' first, and only THEN inflates the width. Catching the
 *      style change directly gives a clearer failure message ("display reverted
 *      to table") than only catching the downstream width inflation.
 *
 *   3. Sanity — the SourceCard truncate target's offsetWidth is ≤ aside content
 *      width (aside - p-4×2 = 272 - 32 = 240). Pre-fix this was wider because
 *      "~/.agents/skills" rendered at its natural width inside the inflated
 *      wrapper. Downstream of (1) but pins the user-visible symptom in case the
 *      wrapper width assertion ever loses precision against a future Radix
 *      version.
 *
 * This test does not depend on the snapshot's azure-* skills — it stages one
 * minimal source so the Sidebar mounts with the SourceCard visible offline.
 */
test('sidebar inner ScrollArea wrapper does not inflate beyond aside width (regression a541de9)', async ({
  appWindow,
  isolatedHome,
}) => {
  stageSourceSkill(isolatedHome, 'sidebar-sourcecard-fixture')
  await waitForInitialScan(appWindow)

  const aside = appWindow.locator('aside[aria-label="Agent sidebar"]')
  const wrapper = aside
    .locator('[data-radix-scroll-area-viewport] > div')
    .first()
  const truncatedPath = aside.getByText('~/.agents/skills', { exact: true })

  await expect(aside).toBeVisible()
  await expect(wrapper).toBeAttached()
  await expect(truncatedPath).toBeVisible()

  const asideBox = await aside.boundingBox()
  const wrapperBox = await wrapper.boundingBox()
  expect(
    asideBox,
    'aside produced no bounding box; selector regression',
  ).not.toBeNull()
  expect(
    wrapperBox,
    'inner Radix wrapper produced no bounding box; selector regression',
  ).not.toBeNull()
  if (!asideBox || !wrapperBox) return

  // Load-bearing #1: the Radix wrapper must NOT exceed the aside width.
  // Pre-fix: 325 vs 272. Post-fix: any value ≤ 272 is acceptable; a
  // vertical scrollbar can chip a few px off without indicating a regression.
  expect(
    wrapperBox.width,
    `Radix wrapper width (${wrapperBox.width}) exceeds aside width (${asideBox.width}) — ` +
      'inner ScrollArea div has reverted to display:table inflation. ' +
      'Check [&>div]:!block on ScrollAreaPrimitive.Viewport in scroll-area.tsx.',
  ).toBeLessThanOrEqual(asideBox.width)

  // Load-bearing #2: the SOURCE of the bug. A regression that removes
  // `[&>div]:!block` flips display back to 'table' BEFORE width inflates,
  // so checking the computed style directly produces a precise failure
  // message ("display reverted to table") rather than the downstream
  // width-inflation symptom.
  const wrapperDisplay = await wrapper.evaluate(
    (el) => window.getComputedStyle(el).display,
  )
  expect(
    wrapperDisplay,
    'Radix Viewport inner wrapper computed display reverted to a non-block value — ' +
      '[&>div]:!block on ScrollAreaPrimitive.Viewport has been removed or overridden.',
  ).toBe('block')

  // Sanity #3: the truncated path's rendered width fits inside the aside's
  // content area. p-4 on the inner wrapper = 16px each side = 32px total
  // horizontal padding. Asserting `≤ asideWidth - 32` pins the user-visible
  // symptom one layer downstream of the wrapper width itself.
  const pathOffsetWidth = await truncatedPath.evaluate(
    (el) => (el as HTMLElement).offsetWidth,
  )
  expect(
    pathOffsetWidth,
    `Truncated source-card path width (${pathOffsetWidth}) exceeds the aside's ` +
      `content area (${asideBox.width - 32}). truncate has stopped clipping.`,
  ).toBeLessThanOrEqual(asideBox.width - 32)
})

/**
 * v0.16.0 — Skills list scroll position survives a background refetch
 * (regression 5619bb7).
 *
 * Pre-fix `SkillsList.tsx:93` was `if (loading) return <Loading />`. ANY
 * refetch (post-sync, manual refresh, post-mutation) flipped
 * `state.skills.loading` to `true` and unmounted the entire react-window
 * `<List>` until the next `fulfilled`. Mid-scroll users saw the list reset
 * to the top, losing their position and any in-progress reading.
 *
 * Post-fix the guard became `if (loading && skills.length === 0)` — the
 * Loading state only renders on the FIRST fetch (when `items` is still
 * empty). Subsequent refetches keep the List mounted with stale data
 * showing, then swap to fresh data on `fulfilled` without remounting. This
 * preserves the scroll container's `scrollTop`.
 *
 * Test mechanism — synthetic action dispatch over UI-driven refetch:
 *
 * Rather than triggering an actual refetch via a click flow that depends on
 * an unrelated subsystem (sync, marketplace install, etc.), we dispatch the
 * thunk's lifecycle action directly. RTK's `createAsyncThunk('skills/fetchAll', ...)`
 * auto-generates `skills/fetchAll/pending`, and the slice's `extraReducers`
 * handler at `skillsSlice.ts:383-385` sets `state.loading = true` on it. The
 * renderer's SkillsList sees `loading=true` with `skills.length > 0` and —
 * post-fix — does NOT remount. Pre-fix would unmount immediately, drop the
 * scroll container, and reset `scrollTop` to 0.
 *
 * After the assertion we dispatch `skills/fetchAll/fulfilled` with the
 * current items to flip `loading` back to `false`, leaving the slice in a
 * consistent post-test state for the suite cleanup.
 *
 * Why a single test rather than two (UI-driven vs synthetic)? UI-driven
 * coverage of the same code path is part of the sync test suite (T4); this
 * regression test isolates the guard at SkillsList.tsx:93 specifically, so a
 * UI flow would only add brittleness (button visibility / disabled state)
 * without strengthening the assertion against this guard.
 */
test('skills list scroll position survives a background refetch (regression 5619bb7)', async ({
  appWindow,
}) => {
  skipWhenAzureSnapshotOffline()
  await waitForInitialScan(appWindow)

  const itemCount = await getStoreState(appWindow, (state) => {
    const root = state as { skills: { items: unknown[] } }
    return root.skills.items.length
  })
  expect(
    itemCount,
    'snapshot must contain skills for the SkillsList to render rows',
  ).toBeGreaterThan(0)

  // Resolve the scrollable container. The wrapper around `<SkillsList />` is
  // `<div class="flex-1 min-h-0 overflow-auto p-4">` (MainContent.tsx:598)
  // and react-window v2 may add its own inner scroll container. Find the
  // first descendant inside the active TabsContent panel whose
  // `scrollHeight > clientHeight` — that's the ACTUAL scroller regardless of
  // which layer wins. Returning a unique data-attr-tag on the resolved
  // element lets us read it back deterministically after the dispatch
  // without re-running the search (which could find a different overflowing
  // element if another component happens to also overflow).
  const scrolled = await appWindow.evaluate(() => {
    // Scope the scroller hunt to the visible tabpanel only — Radix renders
    // inactive `<TabsContent>` with `hidden` and `display: none`, but their
    // descendants can still report `scrollHeight > clientHeight`. Picking
    // one of those would attach `data-e2e-scroll-target` to a non-visible
    // element and let the regression slip through.
    const activePanel = Array.from(
      document.querySelectorAll<HTMLElement>('[role="tabpanel"]'),
    ).find(
      (el) =>
        !el.hasAttribute('hidden') &&
        window.getComputedStyle(el).display !== 'none',
    )
    if (!activePanel) return null
    const candidates = Array.from(
      activePanel.querySelectorAll<HTMLElement>('*'),
    )
    const scroller = candidates.find(
      (el) => el.scrollHeight > el.clientHeight + 1,
    )
    if (!scroller) return null
    scroller.setAttribute('data-e2e-scroll-target', 'true')
    scroller.scrollTop = 200
    return { applied: scroller.scrollTop, target: 200 }
  })
  expect(
    scrolled,
    'no overflowing scroller found inside the active TabsContent panel — ' +
      'snapshot may have fewer skills than the viewport can contain. ' +
      'Adjust global-setup or the row-height constants if this is intentional.',
  ).not.toBeNull()
  if (!scrolled) return
  expect(
    scrolled.applied,
    'browser refused the scrollTop assignment — element is not scrollable',
  ).toBeGreaterThan(0)

  // Dispatch the thunk's pending action directly. Pre-fix, SkillsList's
  // top-level `if (loading)` would unmount the List on the next render
  // tick, dropping the scroll container.
  await dispatchAction(appWindow, {
    type: 'skills/fetchAll/pending',
    meta: {
      arg: undefined,
      requestId: 'e2e-t3-refetch',
      requestStatus: 'pending',
    },
  })

  // Allow one paint frame so React commits the loading=true state. We do
  // NOT use waitForFunction here because the bug under test is the
  // ABSENCE of unmount — there's nothing positive to poll for, only the
  // STABILITY of `scrollTop`. requestAnimationFrame is the synchronous
  // analogue: dispatch → reducer → React commit → next paint.
  await appWindow.evaluate(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  })

  const scrollTopAfter = await appWindow.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>(
      '[data-e2e-scroll-target="true"]',
    )
    return scroller?.scrollTop ?? null
  })

  // Allow ±2px for layout settle (font metrics, scrollbar fractional pixel
  // rounding). Pre-fix: 0. Post-fix: ~200.
  expect(
    scrollTopAfter,
    'data-e2e-scroll-target attribute lost — the element was removed from the DOM. ' +
      'SkillsList remounted instead of staying mounted with stale data. ' +
      'Check the `loading && skills.length === 0` guard at SkillsList.tsx:93.',
  ).not.toBeNull()
  if (scrollTopAfter === null) return
  expect(
    scrollTopAfter,
    `scrollTop reset from ${scrolled.applied} to ${scrollTopAfter} — list remounted on refetch.`,
  ).toBeGreaterThanOrEqual(scrolled.applied - 2)

  // Cleanup — flip loading back to false so subsequent tests start from a
  // consistent slice state. Dispatching fulfilled with the in-store items
  // (read inline) is one IPC roundtrip cheaper than `refreshSkillsState`
  // and avoids re-scanning disk for content we already have. Also remove
  // the data attribute so it doesn't leak into the next test.
  await appWindow.evaluate(() => {
    const store = window.__store__ ?? window.__store
    if (!store) return
    const state = store.getState() as {
      skills: { items: unknown[] }
    }
    store.dispatch({
      type: 'skills/fetchAll/fulfilled',
      payload: state.skills.items,
      meta: {
        arg: undefined,
        requestId: 'e2e-t3-restore',
        requestStatus: 'fulfilled',
      },
    })
    document
      .querySelector('[data-e2e-scroll-target="true"]')
      ?.removeAttribute('data-e2e-scroll-target')
  })
})
