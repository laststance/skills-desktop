import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'

import { test, expect } from '../fixtures/electron-app'
import { isSnapshotOffline } from '../fixtures/isolated-home'
import { expectIronRuleRefusal } from '../helpers/iron-rule'
import {
  getStoreState,
  refreshSkillsState,
  waitForInitialScan,
} from '../helpers/redux'
import {
  USER_TRASH_DIR,
  cleanupTrashEntries,
  diffUserTrash,
  snapshotUserTrash,
} from '../helpers/user-trash'

interface SymlinkSnapshot {
  agentId: string
  status: 'valid' | 'broken' | 'missing'
  isLocal: boolean
  linkPath: string
}

const AZURE_AI_NAME = 'azure-ai'

/**
 * Pre-stage `count` source-backed dummy skills under the isolated HOME's
 * universal source dir (`~/.agents/skills/<name>`) AND create symlinks for
 * each one inside `agentPath` (`<agentPath>/<name> → <sourcePath>`).
 *
 * The bulk-unlink handler discriminates on `lstat` kind — symlinks succeed,
 * local directories are refused. Pre-staging real symlinks is what exercises
 * the happy path; using fresh names (vs. the snapshot's azure-* set) keeps
 * the test independent of skills-CLI install behavior.
 *
 * Returns the names in creation order so the caller can build the IPC payload
 * with the same iteration order and assert on it.
 */
function preStageLinkedSkills(
  isolatedHome: string,
  agentPath: string,
  count: number,
  prefix: string,
): string[] {
  const sourceDir = join(isolatedHome, '.agents', 'skills')
  mkdirSync(agentPath, { recursive: true })
  const names: string[] = []
  for (let i = 0; i < count; i++) {
    const name = `${prefix}-${String(i).padStart(2, '0')}`
    const skillSourcePath = join(sourceDir, name)
    mkdirSync(skillSourcePath, { recursive: true })
    writeFileSync(
      join(skillSourcePath, 'SKILL.md'),
      `# ${name}\n\nFixture skill for the unlink-agent E2E spec.\n`,
    )
    symlinkSync(skillSourcePath, join(agentPath, name))
    names.push(name)
  }
  return names
}

/**
 * Phase-2 spec covering the three unlink-style IPCs that operate on agent-side
 * link paths without writing to trash:
 *   - `SKILLS_UNLINK_FROM_AGENT`        (single)
 *   - `SKILLS_UNLINK_MANY_FROM_AGENT`   (batch)
 *   - `SKILLS_REMOVE_ALL_FROM_AGENT`    (entire agent dir → OS trash)
 *
 * Unlink is benign by contract — it only removes the agent-side
 * symlink/folder and never touches the source under `~/.agents/skills/`.
 * No tombstone, no undo. The third op IS destructive and is gated by the
 * IRON RULE check (`isSharedAgentPath`) — when an agent's scanDir is itself
 * a symlink alias to SOURCE_DIR, deleting it would cascade into every
 * universal agent. Test 3 below pre-stages exactly that aliasing layout to
 * confirm the refusal path is wired and that no shared bytes are touched.
 *
 * Each test runs in a fresh isolated HOME via the snapshot/restore fixture so
 * trash state, leftover symlinks, and pre-staged aliases never leak across
 * tests.
 */

// Several tests in this file consume the snapshot's azure-* skills directly,
// while others share the same isolated-home contract that assumes SOURCE_DIR
// is populated. When global-setup classifies the runner as offline, the
// snapshot is empty and any spec that lstats `~/.agents/skills/azure-ai` will
// fail with confusing renderer errors. File-level skip is the simplest
// guarantee that the suite degrades gracefully.
test.beforeEach(() => {
  test.skip(
    isSnapshotOffline(),
    'azure-* skills required for this suite; runner is offline (global-setup wrote snapshot.offline=true)',
  )
})

test('unlinkFromAgent removes one valid azure-ai symlink without touching the source or other agents', async ({
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

  // Selector source is re-evaluated in renderer context (see redux.ts:23) so
  // closures over module-level constants are NOT preserved — `'azure-ai'`
  // must be inlined as a literal inside the selector body.
  const initialSymlinks = await getStoreState(
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

  const target = initialSymlinks.find((symlink) => symlink.status === 'valid')
  expect(
    target,
    'expected at least one valid azure-ai symlink — adjust global-setup if --global no longer creates per-agent links',
  ).toBeTruthy()
  if (!target) return

  // Other valid symlinks act as the "untouched" control set — none of them
  // should be removed by a single-agent unlink.
  const otherValidSymlinks = initialSymlinks.filter(
    (symlink) =>
      symlink.status === 'valid' && symlink.linkPath !== target.linkPath,
  )

  const ipcResult = await appWindow.evaluate(
    async (args: { skillName: string; agentId: string; linkPath: string }) =>
      window.electron.skills.unlinkFromAgent(args),
    {
      skillName: AZURE_AI_NAME,
      agentId: target.agentId,
      linkPath: target.linkPath,
    },
  )

  expect(ipcResult.success).toBe(true)
  expect(ipcResult.error).toBeUndefined()

  // FS — target link gone, source dir intact, every other agent's link still
  // present. The third assertion is the load-bearing one: a regression that
  // unlinks too aggressively (e.g. cascading the realpath target) would wipe
  // every agent in this loop and the diff would be obvious.
  expect(existsSync(target.linkPath)).toBe(false)
  expect(existsSync(expectedSourcePath)).toBe(true)
  expect(existsSync(join(expectedSourcePath, 'SKILL.md'))).toBe(true)
  for (const other of otherValidSymlinks) {
    expect(
      existsSync(other.linkPath),
      `expected ${other.linkPath} to remain after unlinking only ${target.agentId}`,
    ).toBe(true)
  }

  // Redux — refresh and confirm the unlinked agent now reads as `missing`
  // while every other previously-valid agent remains `valid`. Until refresh
  // runs the store still holds the pre-unlink snapshot.
  await refreshSkillsState(appWindow)
  const refreshedAgentIds = otherValidSymlinks.map((symlink) => symlink.agentId)
  const refreshedSymlinks = await getStoreState(
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
  const targetAfter = refreshedSymlinks.find(
    (symlink) => symlink.agentId === target.agentId,
  )
  expect(targetAfter?.status).toBe('missing')
  for (const otherId of refreshedAgentIds) {
    const stillValid = refreshedSymlinks.find(
      (symlink) => symlink.agentId === otherId,
    )
    expect(stillValid?.status).toBe('valid')
  }
})

/**
 * Phase-4 A1 (issue #114) — negative paths for the single unlink IPC. The
 * handler dispatches on `lstat` kind via ts-pattern (skills.ts:130-145):
 *
 *   - symlink                    → fs.unlink, success: true
 *   - directory (local skill)    → fs.rm -rf, success: true
 *   - regular file (none of above) → otherwise, success: false with copy
 *   - lstat throws (e.g. ENOENT) → catch, success: false with extracted msg
 *
 * The two tests below pin the bottom two rows. Without them, a regression
 * that flipped the `.otherwise()` branch to `fs.rm` would silently delete
 * any regular file the renderer happens to pass — and a regression that
 * stopped catching lstat errors would surface as an uncaught IPC rejection
 * in the renderer (worse UX than a structured failure row).
 */

test('unlinkFromAgent returns structured failure when linkPath does not exist', async ({
  appWindow,
  isolatedHome,
}) => {
  await waitForInitialScan(appWindow)

  // Pre-create the parent agent dir so validatePath's allowed-bases check
  // succeeds. Without this, validatePath could throw before lstat runs and
  // we'd be testing the wrong failure branch.
  const claudeAgentPath = join(isolatedHome, '.claude', 'skills')
  mkdirSync(claudeAgentPath, { recursive: true })
  const missingLinkPath = join(claudeAgentPath, 'never-existed')

  // Sanity — confirm the path is genuinely absent before the IPC fires. A
  // false positive here would be silent: the handler's success path also
  // swallows ENOENT, so we'd think the failure-branch fired when it didn't.
  expect(existsSync(missingLinkPath)).toBe(false)

  const ipcResult = await appWindow.evaluate(
    async (args: { skillName: string; agentId: string; linkPath: string }) =>
      window.electron.skills.unlinkFromAgent(args),
    {
      skillName: 'never-existed',
      agentId: 'claude-code',
      linkPath: missingLinkPath,
    },
  )

  expect(ipcResult.success).toBe(false)
  // ENOENT is the surface form on macOS + Linux; pinning the substring
  // keeps a `extractErrorMessage` rewrite from silently passing this test.
  // `UnlinkResult` is { success: boolean, error?: string } (not a discriminated
  // union) — toMatch on undefined would throw, so this also covers
  // "error must actually be populated when success is false".
  expect(ipcResult.error).toMatch(/ENOENT|no such file or directory/i)
})

test('unlinkFromAgent refuses a regular file with the structured kind-mismatch error', async ({
  appWindow,
  isolatedHome,
}) => {
  await waitForInitialScan(appWindow)

  const claudeAgentPath = join(isolatedHome, '.claude', 'skills')
  mkdirSync(claudeAgentPath, { recursive: true })
  const regularFilePath = join(claudeAgentPath, 'not-a-skill.txt')
  writeFileSync(regularFilePath, '# this is just a stray file, not a skill\n')

  // Sanity — confirm the staged path is a regular file, not a symlink or
  // dir. A regression in the test fixture (e.g. mkdir instead of write)
  // would land us in the directory branch and the IPC would silently
  // succeed with rm -rf.
  const stagedStat = lstatSync(regularFilePath)
  expect(stagedStat.isFile()).toBe(true)
  expect(stagedStat.isSymbolicLink()).toBe(false)
  expect(stagedStat.isDirectory()).toBe(false)

  const ipcResult = await appWindow.evaluate(
    async (args: { skillName: string; agentId: string; linkPath: string }) =>
      window.electron.skills.unlinkFromAgent(args),
    {
      skillName: 'not-a-skill',
      agentId: 'claude-code',
      linkPath: regularFilePath,
    },
  )

  expect(ipcResult.success).toBe(false)
  // Pin the exact handler copy. If this string ever changes, the renderer
  // toast copy probably needs to update with it — surfacing the literal
  // here makes that coupling visible in code review.
  expect(ipcResult.error).toMatch(
    /Cannot remove: path is neither a symlink nor a directory/,
  )

  // FS — the regular file MUST still be there. A regression that flipped
  // `.otherwise()` from "refuse" to "rm -f" would silently destroy any
  // non-symlink/non-dir path the renderer passes; this is the load-bearing
  // assertion against that.
  expect(existsSync(regularFilePath)).toBe(true)
})

test('unlinkManyFromAgent removes every pre-staged symlink and leaves source dirs untouched', async ({
  appWindow,
  isolatedHome,
}) => {
  // Pre-stage BEFORE waiting for the renderer scan. The handler reads from
  // disk independently of the renderer's scan, so it doesn't matter whether
  // these landed before or after the initial fetchSkills.
  const claudeAgentPath = join(isolatedHome, '.claude', 'skills')
  const skillNames = preStageLinkedSkills(
    isolatedHome,
    claudeAgentPath,
    3,
    'unlink-many',
  )

  await waitForInitialScan(appWindow)

  // Sanity — every pre-staged symlink is in place before the IPC fires.
  for (const name of skillNames) {
    const linkPath = join(claudeAgentPath, name)
    expect(existsSync(linkPath)).toBe(true)
    expect(lstatSync(linkPath).isSymbolicLink()).toBe(true)
  }

  const result = await appWindow.evaluate(
    async (args: { agentId: string; items: Array<{ skillName: string }> }) =>
      window.electron.skills.unlinkManyFromAgent(args),
    {
      agentId: 'claude-code',
      items: skillNames.map((skillName) => ({ skillName })),
    },
  )

  expect(result.items).toHaveLength(skillNames.length)
  for (const [index, item] of result.items.entries()) {
    expect(item.outcome).toBe('unlinked')
    expect(item.skillName).toBe(skillNames[index])
  }

  // FS — every link gone, every source dir still present. Unlink is benign:
  // a regression that hard-rms the realpath target (instead of just the
  // symlink) would surface here as missing source dirs.
  for (const name of skillNames) {
    expect(existsSync(join(claudeAgentPath, name))).toBe(false)
    const sourcePath = join(isolatedHome, '.agents', 'skills', name)
    expect(existsSync(sourcePath)).toBe(true)
    expect(existsSync(join(sourcePath, 'SKILL.md'))).toBe(true)
  }
})

/**
 * Phase-4 A2 (issue #114) — partial failure aggregation for the batch unlink.
 *
 * The serial loop in `SKILLS_UNLINK_MANY_FROM_AGENT` (skills.ts:341-354) calls
 * `removeFromAgent` per item and pushes either an `'unlinked'` row or an
 * `'error'` row with the structured `{ message, code? }` shape. The contract
 * we're locking in:
 *
 *   1. Per-item failures DO NOT short-circuit the loop. The 4 healthy items
 *      still unlink even though index 2 is poisoned.
 *   2. Per-item failures surface as `outcome: 'error'` rows, not as a thrown
 *      IPC rejection — the renderer needs index-aligned outcomes to update
 *      its toast/state per skill.
 *   3. The "directory at link path" branch refuses with a meaningful copy
 *      ("Cannot unlink a local skill...") rather than rm-rfing the dir.
 *      Single-unlink rm-rfs (skills.ts:138-141) but the BATCH path is
 *      explicitly non-destructive (skills.ts:85-89). A regression that
 *      copy-pasted the single-unlink dispatch into the batch loop would
 *      silently destroy local skills mid-batch.
 *
 * Index 2 (middle) is poisoned so a regression that aborts the loop on first
 * failure leaves indexes 3-4 unprocessed and the test fails with a clear
 * "expected 'unlinked' got 'pending'" diff. Index 0 or N-1 wouldn't catch a
 * partial loop.
 */
test('unlinkManyFromAgent aggregates per-item failures without short-circuiting the batch', async ({
  appWindow,
  isolatedHome,
}) => {
  const claudeAgentPath = join(isolatedHome, '.claude', 'skills')
  const skillNames = preStageLinkedSkills(
    isolatedHome,
    claudeAgentPath,
    5,
    'unlink-many-partial',
  )

  // Poison index 2: rm the symlink and replace with a real dir holding a
  // SKILL.md, mimicking a local (non-symlinked) skill. The handler treats
  // this as `isDirectory: true` and refuses with the local-skill copy.
  //
  // Why `unlinkSync` and not `rmSync({ force: true })`: rmSync follows
  // symlinks via stat() for type detection. A symlink pointing to a
  // directory makes rmSync see "directory" and refuse without
  // `recursive: true`. unlinkSync removes a single entry of any kind
  // without following — the right tool for replacing a symlink in place.
  // Using `recursive: true` here would risk deleting the target dir under
  // SOURCE_DIR, which is bytes we MUST keep intact for the rest of the
  // assertion.
  const poisonedIndex = 2
  const poisonedSkillName = skillNames[poisonedIndex]
  const poisonedLinkPath = join(claudeAgentPath, poisonedSkillName)
  unlinkSync(poisonedLinkPath)
  mkdirSync(poisonedLinkPath, { recursive: true })
  writeFileSync(
    join(poisonedLinkPath, 'SKILL.md'),
    `# ${poisonedSkillName}\n\nLocal-skill fixture poisoning index ${poisonedIndex}.\n`,
  )

  await waitForInitialScan(appWindow)

  // Sanity — confirm the poison worked. lstat-on-symlink would have returned
  // isSymbolicLink:true and we'd be testing the wrong branch.
  expect(lstatSync(poisonedLinkPath).isDirectory()).toBe(true)
  expect(lstatSync(poisonedLinkPath).isSymbolicLink()).toBe(false)

  const result = await appWindow.evaluate(
    async (args: { agentId: string; items: Array<{ skillName: string }> }) =>
      window.electron.skills.unlinkManyFromAgent(args),
    {
      agentId: 'claude-code',
      items: skillNames.map((skillName) => ({ skillName })),
    },
  )

  expect(result.items).toHaveLength(skillNames.length)

  // Iterate by index instead of filtering so a regression that misroutes the
  // error to a different position is caught. Same defense as bulk-delete.
  for (const [index, item] of result.items.entries()) {
    expect(item.skillName).toBe(skillNames[index])
    if (index === poisonedIndex) {
      expect(item.outcome).toBe('error')
      if (item.outcome === 'error') {
        expect(item.error.message).toMatch(/Cannot unlink a local skill/)
      }
    } else {
      expect(item.outcome).toBe('unlinked')
    }
  }

  // FS — the 4 healthy symlinks are gone, every source dir is intact, and
  // the poisoned local-skill dir is still there byte-for-byte. The last
  // assertion is the load-bearing one: a regression that ran rm -rf on the
  // dir would still produce an 'unlinked' outcome but the SKILL.md would be
  // gone.
  for (const [index, name] of skillNames.entries()) {
    const sourcePath = join(isolatedHome, '.agents', 'skills', name)
    expect(existsSync(sourcePath)).toBe(true)
    expect(existsSync(join(sourcePath, 'SKILL.md'))).toBe(true)

    if (index === poisonedIndex) {
      expect(existsSync(poisonedLinkPath)).toBe(true)
      expect(existsSync(join(poisonedLinkPath, 'SKILL.md'))).toBe(true)
      expect(lstatSync(poisonedLinkPath).isDirectory()).toBe(true)
    } else {
      expect(existsSync(join(claudeAgentPath, name))).toBe(false)
    }
  }
})

test('removeAllFromAgent refuses when the agent path is a symlink alias to the universal source', async ({
  appWindow,
  isolatedHome,
}) => {
  // Pre-stage the IRON RULE trigger condition: an agent's scanDir is itself
  // a symlink alias to SOURCE_DIR. Without this layout the handler's
  // validatePath + isSharedAgentPath chain wouldn't fire — picking cursor
  // because it's listed in UNIVERSAL_AGENT_IDS so global-setup never created
  // its scanDir, leaving us a clean tempdir corner to alias without losing
  // any pre-existing fixture state. Parent (`.cursor`) doesn't exist yet
  // either, so mkdirSync first or symlinkSync would ENOENT.
  const sourceDir = join(isolatedHome, '.agents', 'skills')
  const cursorAgentPath = join(isolatedHome, '.cursor', 'skills')
  // Sanity: if a future skills-cli bump ever pre-creates cursor's scanDir,
  // our symlink would shadow real fixture state and the test would silently
  // mis-assert. Fail loud instead.
  expect(
    existsSync(cursorAgentPath),
    `cursor scanDir ${cursorAgentPath} unexpectedly exists pre-stage — global-setup or skills-cli behavior changed`,
  ).toBe(false)
  mkdirSync(dirname(cursorAgentPath), { recursive: true })
  symlinkSync(sourceDir, cursorAgentPath)

  // Capture the SOURCE_DIR contents pre-call so we can assert nothing inside
  // it moved when the refusal path fires.
  const sourceContentsBefore = readdirSync(sourceDir).sort()
  expect(
    sourceContentsBefore.length,
    'expected the snapshot source dir to be populated by global-setup',
  ).toBeGreaterThan(0)

  await waitForInitialScan(appWindow)

  const result = await appWindow.evaluate(
    async (args: { agentId: string; agentPath: string }) =>
      window.electron.skills.removeAllFromAgent(args),
    { agentId: 'cursor', agentPath: cursorAgentPath },
  )

  expectIronRuleRefusal(result)

  // FS — the symlink alias itself is still in place (handler short-circuits
  // before any trashItem call) and SOURCE_DIR is byte-for-byte untouched.
  expect(existsSync(cursorAgentPath)).toBe(true)
  expect(lstatSync(cursorAgentPath).isSymbolicLink()).toBe(true)
  const sourceContentsAfter = readdirSync(sourceDir).sort()
  expect(sourceContentsAfter).toEqual(sourceContentsBefore)
})

/**
 * Phase-4 C1 + C2 (issue #114) — happy path for `removeAllFromAgent`.
 *
 * The two refusal tests above (`unlink-agent.e2e.ts` Test 3, `regression.e2e.ts`
 * B1/B2) pin every IRON RULE branch, but they all short-circuit BEFORE any
 * `shell.trashItem` call. None of them prove that the un-refused happy path
 * actually routes the agent dir into the macOS OS Trash (vs. silently
 * `rm -rf`-ing it, which would still let `success: true` pass) — that's the
 * gap this test closes.
 *
 * `delete.e2e.ts` and `bulk-delete.e2e.ts` test the IN-APP trash at
 * `<HOME>/.agents/.trash/` — that's `trashService.moveToTrash`, a different
 * code path. `removeAllFromAgent` calls `shell.trashItem` directly (skills.ts:209)
 * which routes to the OS Trash via NSWorkspace on macOS. The handler's contract
 * — "moves to OS trash so accidents can be restored from Finder" (skills.ts:208) —
 * is verifiable only by inspecting the user's actual `~/.Trash/`.
 *
 * macOS `shell.trashItem` routing is uid-based (NSWorkspace), NOT HOME-env-based,
 * so the isolated HOME doesn't affect routing — the agent dir lands in the
 * developer's real `~/.Trash/`. C2 (teardown) is therefore non-optional: a
 * test that pollutes the developer's trash is unkind.
 *
 * Picked `cline` because:
 *   1. Its `path` (`<HOME>/.cline/skills`) is non-shared post-fix 3d20085 —
 *      `isSharedAgentPath` returns false, so the IRON RULE check passes.
 *   2. Global-setup doesn't seed `.cline/skills` (skills-cli only creates it
 *      when targeted via `--agent`), giving us a clean tempdir corner to stage
 *      without colliding with snapshot fixture state.
 */
test('removeAllFromAgent moves a non-shared agent dir to OS Trash and reports the right count', async ({
  appWindow,
  isolatedHome,
}) => {
  const clineAgentPath = join(isolatedHome, '.cline', 'skills')
  // Sanity — global-setup leaves .cline/skills absent. If a future skills-cli
  // bump ever links cline by default, the count assertion below would silently
  // pass with whatever fixture state was there. Fail loud.
  expect(
    existsSync(clineAgentPath),
    `cline scanDir ${clineAgentPath} unexpectedly exists pre-stage — global-setup or skills-cli behavior changed`,
  ).toBe(false)
  const skillNames = preStageLinkedSkills(
    isolatedHome,
    clineAgentPath,
    3,
    'remove-all-os-trash',
  )

  expect(
    existsSync(USER_TRASH_DIR),
    `expected ~/.Trash to exist on macOS dev box — unexpected env`,
  ).toBe(true)
  const trashEntriesBefore = snapshotUserTrash()

  await waitForInitialScan(appWindow)

  // Capture only OUR specific trashed dir early so the C2 cleanup runs
  // even if any assertion below throws. The try/finally is the load-
  // bearing safety net: a failing assertion mid-run that left our entry
  // in the developer's ~/.Trash would be an unkind side effect of test
  // failure. The narrowing-to-one-entry happens inside the try block
  // (after diffUserTrash + content-hash match) so that concurrent
  // unrelated writes to ~/.Trash from the dev's machine never get
  // touched by cleanup.
  let createdTrashEntryPaths: string[] = []
  try {
    const result = await appWindow.evaluate(
      async (args: { agentId: string; agentPath: string }) =>
        window.electron.skills.removeAllFromAgent(args),
      { agentId: 'cline', agentPath: clineAgentPath },
    )

    // Diff ~/.Trash IMMEDIATELY after the IPC call returns, then narrow
    // the cleanup target to OUR specific trashed dir — never the full
    // newPaths set. A developer / Finder / Time Machine moving something
    // unrelated to ~/.Trash between trashEntriesBefore and now would
    // otherwise have their entry rm -rf'd by the finally block below.
    // Match by exact-set of skill basenames (timestamped + unique per
    // test via preStageLinkedSkills), which is decisive even after macOS
    // auto-renames on collision (skills → "skills 2").
    const { newPaths } = diffUserTrash(trashEntriesBefore)
    const expectedSkillNames = [...skillNames].sort()
    const matchingTrashedAgentDir = newPaths.find((entryPath) => {
      if (!lstatSync(entryPath).isDirectory()) return false
      const entryContents = readdirSync(entryPath).sort()
      return (
        entryContents.length === expectedSkillNames.length &&
        entryContents.every((name, idx) => name === expectedSkillNames[idx])
      )
    })
    createdTrashEntryPaths = matchingTrashedAgentDir
      ? [matchingTrashedAgentDir]
      : []

    expect(result.success).toBe(true)
    expect(result.removedCount).toBe(skillNames.length)
    expect(result.error).toBeUndefined()

    // FS — the agent dir is gone from its original location and every source
    // dir is intact. trashItem moves only the agent path itself; per-skill
    // source bytes under SOURCE_DIR must not be touched (unlink is benign).
    expect(existsSync(clineAgentPath)).toBe(false)
    for (const name of skillNames) {
      const sourcePath = join(isolatedHome, '.agents', 'skills', name)
      expect(existsSync(sourcePath)).toBe(true)
      expect(existsSync(join(sourcePath, 'SKILL.md'))).toBe(true)
    }

    expect(
      matchingTrashedAgentDir,
      `expected a ~/.Trash entry whose contents equal [${expectedSkillNames.join(', ')}] — got newPaths=${
        newPaths.length === 0
          ? '<none> (shell.trashItem routing may have hit a per-volume .Trashes dir; verify HOME volume layout)'
          : newPaths.join(', ')
      }`,
    ).toBeTruthy()
  } finally {
    cleanupTrashEntries(createdTrashEntryPaths)
  }
})

test('removeAllFromAgent surfaces structured failure when shell.trashItem rejects (parent dir is read-only)', async ({
  appWindow,
  isolatedHome,
}) => {
  // Why this test exists
  // ====================
  // The handler at src/main/ipc/skills.ts wraps the entire body in a single
  // try/catch and returns `{ success: false, removedCount: 0, error: <msg> }`
  // on any rejection from `shell.trashItem`. The C1 test exercises only the
  // happy path. This test asserts the negative branch — without it, a
  // regression that swapped `await shell.trashItem(...)` for a fire-and-
  // forget `.catch(() => {})` would silently report `success: true` while
  // leaving the dir in place. Catching that locally instead of after a user
  // reports "Remove all says success but my skills are still there".
  //
  // How we force the rejection
  // ==========================
  // `shell.trashItem` on macOS uses NSFileManager which moves the source
  // path INTO the user's Trash via rename. Rename mutates the parent dir's
  // entry table, so revoking write+execute permission on the parent of
  // `agentPath` blocks rename without affecting `fs.access` (existence
  // check) or `fs.readdir` on `agentPath` itself. The handler proceeds
  // through both and only fails at the trashItem call — the exact code path
  // we want to exercise.
  //
  // Root processes ignore POSIX perms entirely, so a uid=0 runner would
  // trash the dir successfully and the assertion would fail with a
  // misleading message. Skip explicitly with a clear reason; this is
  // never the case in CI or normal dev.
  if (process.getuid?.() === 0) {
    test.skip(true, 'POSIX permission revocation does not constrain root')
    return
  }

  const clineParent = join(isolatedHome, '.cline')
  const clineAgentPath = join(clineParent, 'skills')
  expect(
    existsSync(clineParent),
    `cline parent dir ${clineParent} unexpectedly exists pre-stage — global-setup or skills-cli behavior changed`,
  ).toBe(false)

  const skillNames = preStageLinkedSkills(
    isolatedHome,
    clineAgentPath,
    2,
    'remove-all-trash-reject',
  )

  // Snapshot trash before — used to assert NO new entry appears post-call.
  // If trashItem somehow succeeded despite the perm restriction, the diff
  // would surface immediately.
  const trashEntriesBefore = snapshotUserTrash()

  await waitForInitialScan(appWindow)

  // Revoke parent dir write+execute. 0500 = r-x for owner: list contents,
  // stat existing entries, BUT cannot create/rename/delete entries. This
  // is the minimum perm change that makes rename fail without breaking
  // the handler's pre-trash readdir/access calls.
  chmodSync(clineParent, 0o500)

  try {
    const result = await appWindow.evaluate(
      async (args: { agentId: string; agentPath: string }) =>
        window.electron.skills.removeAllFromAgent(args),
      { agentId: 'cline', agentPath: clineAgentPath },
    )

    // Structured failure shape — every field load-bearing.
    //   success=false → caller treats this as an error condition
    //   removedCount=0 → no partial bookkeeping for the renderer to reconcile
    //   error is non-empty → operator sees the underlying OS error
    expect(result.success).toBe(false)
    expect(result.removedCount).toBe(0)
    expect(result.error).toBeTruthy()
    expect(typeof result.error).toBe('string')

    // FS — agent dir is intact. The whole point of returning success=false
    // is that NOTHING moved. A regression that called rm-rf as a fallback
    // would leave clineAgentPath gone here.
    expect(existsSync(clineAgentPath)).toBe(true)
    for (const name of skillNames) {
      expect(existsSync(join(clineAgentPath, name))).toBe(true)
      // Source dirs untouched too — symlink presence implies the source
      // it points to is still there (broken-symlink case is covered by
      // a separate spec).
      const sourcePath = join(isolatedHome, '.agents', 'skills', name)
      expect(existsSync(sourcePath)).toBe(true)
    }

    // OS Trash invariant — no new entry appeared. With `workers: 1` +
    // `fullyParallel: false`, the diff is tight. A new entry here would
    // mean trashItem partially succeeded, which contradicts success=false.
    const { newEntries } = diffUserTrash(trashEntriesBefore)
    expect(
      newEntries,
      `expected NO new ~/.Trash entries on rejection — got ${newEntries.join(', ')}`,
    ).toHaveLength(0)
  } finally {
    // Restore perms so rmSync can recurse into the dir during isolatedHome
    // teardown. The fixture's destroyIsolatedHome warns rather than throws,
    // so a leftover 0500 dir would silently leak under /tmp on every run.
    try {
      chmodSync(clineParent, 0o700)
    } catch (err) {
      console.warn(
        `[e2e] Failed to restore perms on ${clineParent}; isolatedHome teardown may leak:`,
        err,
      )
    }
  }
})
