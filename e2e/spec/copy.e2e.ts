import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

import { test, expect } from '../fixtures/electron-app'
import {
  clearIpcEvents,
  getIpcEvents,
  getRefreshedSymlinkStatus,
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

interface SkillSnapshot {
  name: string
  path: string
  symlinks: SymlinkSnapshot[]
}

interface SkillsState {
  items: SkillSnapshot[]
}

interface AgentsState {
  items: Array<{ id: string }>
}

interface RootState {
  skills: SkillsState
  agents: AgentsState
}

const AZURE_AI_NAME = 'azure-ai'

/**
 * First Phase-2 spec — covers the `SKILLS_COPY_TO_AGENTS` IPC end-to-end.
 *
 * Drives the IPC directly (`window.electron.skills.copyToAgents`) instead of
 * walking the AddSymlinkModal because the modal interaction is already covered
 * by browser-mode unit tests; the value of an Electron E2E test here is the
 * IPC contract → main-process FS effect → renderer state propagation slice.
 *
 * 3-layer verification:
 *   1. IPC return value (`success: true`, `copied`, `failures`)
 *   2. Filesystem (target agent dir contains the new entry; symlink target,
 *      if applicable, canonicalizes to the universal source dir)
 *   3. Renderer state (post-refresh `state.skills.items` reflects the new
 *      `valid` symlink for the target agent)
 *
 * UI-driven coverage of the modal interactions lives at the bottom of this
 * file (`copyToAgents UI-driven modal …`).
 */
test('copyToAgents replicates azure-ai to a missing target agent', async ({
  appWindow,
  isolatedHome,
}) => {
  // Wait for the renderer's initial fetch — both skills and agents must land
  // before the spec can pick a target. Generous timeout because the fetch
  // races with skillScanner walking the snapshot HOME.
  await waitForInitialScan(appWindow)

  const expectedSourcePath = join(
    isolatedHome,
    '.agents',
    'skills',
    AZURE_AI_NAME,
  )

  // NOTE: `getStoreState` re-evaluates the selector via `new Function` in the
  // renderer context, so closures over module-level constants are *not*
  // preserved. Skill names must be inlined as string literals inside selectors.
  const initialSnapshot = await getStoreState(appWindow, (state) => {
    const root = state as RootState
    const azure = root.skills.items.find((skill) => skill.name === 'azure-ai')
    return {
      hasAzure: Boolean(azure),
      sourcePath: azure?.path ?? null,
      symlinks: azure?.symlinks ?? [],
    }
  })

  expect(
    initialSnapshot.hasAzure,
    `${AZURE_AI_NAME} should be installed by global-setup`,
  ).toBe(true)
  expect(
    initialSnapshot.sourcePath,
    'azure-ai source path should land under ~/.agents/skills/',
  ).toBe(expectedSourcePath)

  const targetSymlink = initialSnapshot.symlinks.find(
    (symlink) => symlink.status === 'missing' && !symlink.isLocal,
  )
  expect(
    targetSymlink,
    'expected at least one agent without azure-ai linked — adjust global-setup if --global now links every agent',
  ).toBeTruthy()
  if (!targetSymlink) return

  await clearIpcEvents(appWindow)

  const ipcResult = await appWindow.evaluate(
    async (args: {
      skillName: string
      sourcePath: string
      targetAgentIds: string[]
    }) => window.electron.skills.copyToAgents(args),
    {
      skillName: AZURE_AI_NAME,
      sourcePath: expectedSourcePath,
      targetAgentIds: [targetSymlink.agentId],
    },
  )

  expect(ipcResult.success).toBe(true)
  expect(ipcResult.copied).toBe(1)
  expect(ipcResult.failures).toEqual([])

  // FS — target agent's link path now resolves to the universal source dir.
  // The handler picks "physical copy" when sourcePath is a directory, but the
  // resulting entry is still a directory tree carrying the same SKILL.md, so
  // the existence + structure check is the assertion that matters here.
  expect(
    existsSync(targetSymlink.linkPath),
    `expected ${targetSymlink.linkPath} to exist after copyToAgents`,
  ).toBe(true)
  const stat = lstatSync(targetSymlink.linkPath)
  if (stat.isSymbolicLink()) {
    expect(realpathSync.native(targetSymlink.linkPath)).toBe(
      realpathSync.native(expectedSourcePath),
    )
  } else {
    expect(stat.isDirectory()).toBe(true)
    expect(existsSync(join(targetSymlink.linkPath, 'SKILL.md'))).toBe(true)
  }

  // Redux — refresh the slice from disk and confirm the agent's symlink now
  // reads as `valid`. Until refresh runs the store still holds the pre-copy
  // snapshot, which is exactly what production sees and would surface in any
  // missed-refresh regression.
  await refreshSkillsState(appWindow)

  const refreshedLinkStatus = await getRefreshedSymlinkStatus(
    appWindow,
    AZURE_AI_NAME,
    targetSymlink.agentId,
  )
  expect(refreshedLinkStatus).toBe('valid')

  // IPC events were not invoked from the renderer's `onDeleteProgress`-style
  // listener path, so `__ipcEvents__` should still be empty for this channel.
  // Asserting the absence guards against a regression where main accidentally
  // starts emitting progress on copy.
  const recordedEvents = await getIpcEvents(appWindow)
  expect(
    recordedEvents.filter((event) => event.channel === 'skills:copyToAgents'),
  ).toEqual([])
})

/**
 * Symlink-source branch of the IPC handler — when `sourcePath` itself is a
 * symlink, the handler must:
 *
 *   1. `readlink` to get the raw target.
 *   2. Resolve it against `dirname(sourcePath)` (so relative links don't get
 *      rooted at cwd).
 *   3. Validate the resolved target via `validatePath(... getAllowedBases())`.
 *   4. `fs.symlink(symlinkTarget, destPath)` — i.e., replicate the link, NOT
 *      copy the underlying directory tree.
 *
 * The existing top-of-file test exercises the directory branch via the source
 * dir at `~/.agents/skills/azure-ai`. Here we pass a per-agent symlink (e.g.,
 * `~/.codex/skills/azure-ai`) as `sourcePath` so the lstat lands on a symlink
 * and the alternate code path runs.
 *
 * KEY assertion is `lstat(targetLink).isSymbolicLink()` — a regression that
 * collapsed both branches into `fs.cp` would create a real directory at the
 * target instead of a symlink, and the test would catch it before the broken
 * "deleting the target deletes the source" UX shipped.
 */
test('copyToAgents replicates a symlink source verbatim (local-copy variant)', async ({
  appWindow,
  isolatedHome,
}) => {
  await waitForInitialScan(appWindow)

  const expectedSourceDir = join(
    isolatedHome,
    '.agents',
    'skills',
    AZURE_AI_NAME,
  )

  // Pick the first valid-and-non-local symlink as the source linkPath, and
  // the first missing-and-non-local symlink as the target. Both lookups
  // re-evaluate inside the renderer, so 'azure-ai' must stay a string literal.
  const linkSelection = await getStoreState(appWindow, (state) => {
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
    const validLink = azure?.symlinks.find(
      (symlink) => symlink.status === 'valid' && !symlink.isLocal,
    )
    const missingLink = azure?.symlinks.find(
      (symlink) => symlink.status === 'missing' && !symlink.isLocal,
    )
    return {
      sourceLinkPath: validLink?.linkPath ?? null,
      sourceAgentId: validLink?.agentId ?? null,
      targetLinkPath: missingLink?.linkPath ?? null,
      targetAgentId: missingLink?.agentId ?? null,
    }
  })

  expect(
    linkSelection.sourceLinkPath,
    'expected at least one agent with azure-ai linked — global-setup contract',
  ).toBeTruthy()
  expect(
    linkSelection.targetLinkPath,
    'expected at least one agent without azure-ai linked — global-setup contract',
  ).toBeTruthy()
  if (
    !linkSelection.sourceLinkPath ||
    !linkSelection.targetLinkPath ||
    !linkSelection.targetAgentId
  ) {
    return
  }

  // Sanity — the source we're about to feed to the IPC really is a symlink
  // on disk. If global-setup ever switches to physical copies for these
  // agents, this test must be revisited (the directory branch already has
  // coverage above).
  expect(lstatSync(linkSelection.sourceLinkPath).isSymbolicLink()).toBe(true)

  await clearIpcEvents(appWindow)

  const ipcResult = await appWindow.evaluate(
    async (args: {
      skillName: string
      sourcePath: string
      targetAgentIds: string[]
    }) => window.electron.skills.copyToAgents(args),
    {
      skillName: AZURE_AI_NAME,
      sourcePath: linkSelection.sourceLinkPath,
      targetAgentIds: [linkSelection.targetAgentId],
    },
  )

  expect(ipcResult.success).toBe(true)
  expect(ipcResult.copied).toBe(1)
  expect(ipcResult.failures).toEqual([])

  // FS — the target must be a symlink (NOT a directory). A regression that
  // collapsed both branches into `fs.cp` would surface here as
  // `isSymbolicLink() === false`.
  expect(existsSync(linkSelection.targetLinkPath)).toBe(true)
  const targetStat = lstatSync(linkSelection.targetLinkPath)
  expect(targetStat.isSymbolicLink()).toBe(true)

  // Realpath round-trip — the new symlink must canonicalize to the same
  // location as the universal source dir. This confirms the readlink ->
  // resolve(dirname, raw) -> fs.symlink(target, dest) chain produced a
  // working link, not a dangling one.
  expect(realpathSync.native(linkSelection.targetLinkPath)).toBe(
    realpathSync.native(expectedSourceDir),
  )

  await refreshSkillsState(appWindow)
  const refreshedStatus = await getRefreshedSymlinkStatus(
    appWindow,
    AZURE_AI_NAME,
    linkSelection.targetAgentId,
  )
  expect(refreshedStatus).toBe('valid')
})

/**
 * Per-target collision policy — when one of the requested target agents
 * already owns an entry at `<agent.path>/<skillName>`, the IPC handler MUST:
 *
 *   1. Push a `{ agentId, error: 'Already exists' }` row into `failures`.
 *   2. NOT overwrite the existing entry (no `fs.cp` against an occupied path).
 *   3. Continue the loop — every other target still gets copied.
 *   4. Return `success: false` because `failures.length > 0`, with `copied`
 *      reflecting only the successful targets.
 *
 * No rollback contract is exercised here on purpose — the handler does not
 * clean up successful copies when a sibling fails. This test locks that in:
 * a future "rollback all on partial failure" change would flip the success
 * count and the FS shape, and the assertions below would catch it.
 *
 * Source is a fresh dummy dir created procedurally so the snapshot's azure-*
 * link topology is irrelevant to the assertion.
 */
test('copyToAgents reports per-target Already exists and continues with the rest (no rollback)', async ({
  appWindow,
  isolatedHome,
}) => {
  // Brand-new skill name so no agent in the snapshot has it linked. Avoids
  // dependency on global-setup's --global link set.
  const skillName = 'copy-partial'
  const sourcePath = join(isolatedHome, '.agents', 'skills', skillName)
  mkdirSync(sourcePath, { recursive: true })
  const sourceMarker = `# ${skillName}\n\nfresh source for partial-failure test\n`
  writeFileSync(join(sourcePath, 'SKILL.md'), sourceMarker)

  await waitForInitialScan(appWindow)

  // Pick two agents with distinct, non-shared scan dirs straight from the
  // running store. Hardcoding `cursor` / `gemini-cli` would couple this test
  // to AGENT_DEFINITIONS by name; the contract being verified is the
  // collision *policy*, not the survival of any particular agent in the
  // catalog. Filtering on `seenPaths` also sidesteps the IRON RULE shared
  // scanDirs (amp / kimi-cli / replit on .config/agents/skills) — picking
  // two agents that share a path would let the second mkdirSync see the
  // first's collision and break the asymmetric setup.
  const agentSelection = await getStoreState(appWindow, (state) => {
    const root = state as {
      agents: { items: Array<{ id: string; name: string; path: string }> }
    }
    const seenPaths = new Set<string>()
    const uniques: Array<{ id: string; path: string }> = []
    for (const agent of root.agents.items) {
      if (seenPaths.has(agent.path)) continue
      seenPaths.add(agent.path)
      uniques.push({ id: agent.id, path: agent.path })
      if (uniques.length === 2) break
    }
    return {
      occupiedAgentId: uniques[0]?.id ?? null,
      occupiedAgentPath: uniques[0]?.path ?? null,
      freeAgentId: uniques[1]?.id ?? null,
      freeAgentPath: uniques[1]?.path ?? null,
    }
  })

  expect(agentSelection.occupiedAgentId).toBeTruthy()
  expect(agentSelection.occupiedAgentPath).toBeTruthy()
  expect(agentSelection.freeAgentId).toBeTruthy()
  expect(agentSelection.freeAgentPath).toBeTruthy()
  if (
    !agentSelection.occupiedAgentId ||
    !agentSelection.occupiedAgentPath ||
    !agentSelection.freeAgentId ||
    !agentSelection.freeAgentPath
  ) {
    return
  }
  const { occupiedAgentId, occupiedAgentPath, freeAgentId, freeAgentPath } =
    agentSelection

  // Pre-occupy ONE target. The handler's `lstat(destPath)` will succeed and
  // push 'Already exists'. A real-but-different file in the destination is
  // the strongest signal: if the handler ever switches to overwrite, the
  // sentinel content disappears and the assertion below catches it.
  const occupiedSkillDir = join(occupiedAgentPath, skillName)
  mkdirSync(occupiedSkillDir, { recursive: true })
  const sentinelContent = `# pre-existing\nDO NOT OVERWRITE — collision sentinel.\n`
  writeFileSync(join(occupiedSkillDir, 'SKILL.md'), sentinelContent)

  const ipcResult = await appWindow.evaluate(
    async (args: {
      skillName: string
      sourcePath: string
      targetAgentIds: string[]
    }) => window.electron.skills.copyToAgents(args),
    {
      skillName,
      sourcePath,
      targetAgentIds: [occupiedAgentId, freeAgentId],
    },
  )

  expect(ipcResult.success).toBe(false)
  expect(ipcResult.copied).toBe(1)
  expect(ipcResult.failures).toEqual([
    { agentId: occupiedAgentId, error: 'Already exists' },
  ])

  // FS — sentinel survived (collision did NOT overwrite). Read the bytes
  // back so a regression that swaps `lstat` for `cp -f` shows up as a
  // content mismatch instead of a length-only check.
  expect(readFileSync(join(occupiedSkillDir, 'SKILL.md'), 'utf-8')).toBe(
    sentinelContent,
  )

  // FS — the free agent's destPath was created with the source content, NOT
  // the sentinel. This is the load-bearing "loop continues" assertion: a
  // regression that aborts the loop on first failure would leave the free
  // agent's path untouched.
  const freeAgentDestPath = join(freeAgentPath, skillName)
  expect(existsSync(freeAgentDestPath)).toBe(true)
  expect(readFileSync(join(freeAgentDestPath, 'SKILL.md'), 'utf-8')).toBe(
    sourceMarker,
  )
})

/**
 * UI-driven coverage of `CopyToAgentsModal`. The earlier tests in this file
 * drive the IPC directly; this one walks the click path the user actually
 * takes:
 *
 *   1. Set `state.ui.selectedAgentId` so the modal can derive `sourcePath`
 *      from `skillToCopy.symlinks[selectedAgentId].linkPath`.
 *   2. Dispatch `skills/setSkillToCopy` with the azure-ai snapshot — this is
 *      what the right-click "Copy to..." menu item dispatches in production.
 *   3. Tick the target agent's checkbox by `aria-label` (mirrors the modal's
 *      `<Checkbox aria-label={agent.name} />`).
 *   4. Click the primary "Copy to N agent(s)" button.
 *   5. Wait for `state.skills.copying === false` to know the IPC settled.
 *
 * The IPC contract is already covered above, so this test only verifies the
 * UI wiring: the modal must mount, the checkbox toggle must update Redux,
 * and the primary button must fire the `copyToAgents` thunk. Filesystem
 * existence is the simplest proxy that the whole click chain reached `fs.cp`.
 */
test('copyToAgents UI-driven modal copies via dispatch + checkbox click', async ({
  appWindow,
}) => {
  await waitForInitialScan(appWindow)

  // Locate a valid source agent (provides linkPath the modal needs) plus a
  // missing-symlink target agent (so the copy can succeed without colliding).
  // Both agent ids and the target's display name are returned because the
  // checkbox's aria-label is the human name (e.g., "Goose"), not the id.
  const modalSelection = await getStoreState(appWindow, (state) => {
    const root = state as {
      skills: {
        items: Array<{ name: string; symlinks: SymlinkSnapshot[] }>
      }
      agents: { items: Array<{ id: string; name: string }> }
    }
    const azure = root.skills.items.find((skill) => skill.name === 'azure-ai')
    const validSymlink = azure?.symlinks.find(
      (symlink) => symlink.status === 'valid' && !symlink.isLocal,
    )
    const targetSymlink = azure?.symlinks.find(
      (symlink) => symlink.status === 'missing' && !symlink.isLocal,
    )
    const targetAgent = root.agents.items.find(
      (agent) => agent.id === targetSymlink?.agentId,
    )
    return {
      sourceAgentId: validSymlink?.agentId ?? null,
      targetAgentId: targetSymlink?.agentId ?? null,
      targetAgentName: targetAgent?.name ?? null,
      targetLinkPath: targetSymlink?.linkPath ?? null,
    }
  })

  expect(modalSelection.sourceAgentId).toBeTruthy()
  expect(modalSelection.targetAgentId).toBeTruthy()
  expect(modalSelection.targetAgentName).toBeTruthy()
  expect(modalSelection.targetLinkPath).toBeTruthy()
  if (
    !modalSelection.sourceAgentId ||
    !modalSelection.targetAgentName ||
    !modalSelection.targetLinkPath
  ) {
    return
  }
  const targetLinkPath = modalSelection.targetLinkPath

  // Pre-condition the FS state. If a snapshot reset ever leaves stale bytes
  // at this path, the post-click existence check would be a false positive
  // — a "test passed" outcome that doesn't prove the click chain reached
  // `fs.cp` at all. Asserting non-existence up front converts that mode
  // into a loud failure right at the boundary.
  expect(existsSync(targetLinkPath)).toBe(false)

  // Drive Redux. `selectedAgentId` is set first because the modal's
  // `targetAgents` memo depends on it; toggling order would briefly render
  // an empty list. Action types are inlined string literals — these
  // dispatches re-evaluate inside the renderer where slice-imported action
  // creators are out of scope.
  await appWindow.evaluate((sourceAgentId: string) => {
    const store = window.__store__ ?? window.__store
    store?.dispatch({ type: 'ui/selectAgent', payload: sourceAgentId })
  }, modalSelection.sourceAgentId)

  await appWindow.evaluate(() => {
    const store = window.__store__ ?? window.__store
    const state = store?.getState() as {
      skills?: { items?: Array<{ name: string }> }
    }
    const azure = state?.skills?.items?.find(
      (skill) => skill.name === 'azure-ai',
    )
    if (azure) {
      store?.dispatch({ type: 'skills/setSkillToCopy', payload: azure })
    }
  })

  // Modal mount — the DialogTitle text is the most stable signal that the
  // dialog is open and rendered. Roles also work but the title is unique
  // and more readable in failure output.
  await appWindow.getByRole('heading', { name: 'Copy to Agents' }).waitFor({
    state: 'visible',
    timeout: 5_000,
  })

  // Tick the target agent's checkbox. aria-label is the agent's display
  // name (see CopyToAgentsModal.tsx:165 — `<Checkbox aria-label={agent.name} />`).
  await appWindow
    .getByRole('checkbox', { name: modalSelection.targetAgentName })
    .check()

  // Primary button label is dynamic ("Copy to 1 agent(s)"). Match the prefix
  // so the test stays robust to copy-tweaks of the count parenthetical.
  await appWindow
    .getByRole('button', { name: /^Copy to \d+ agent\(s\)$/ })
    .click()

  // Poll the FS directly. `state.skills.copying` flips false on both initial
  // mount AND fulfillment, so a Redux poll can pass before the click chain
  // ever reaches `fs.cp` — masking a regression where the dispatch never
  // fires. FS existence is the smallest signal the IPC handler completed
  // end-to-end. The symlink-vs-directory contract is already covered by the
  // local-copy variant above, so existence is enough here.
  await expect
    .poll(() => existsSync(targetLinkPath), { timeout: 10_000 })
    .toBe(true)
})
