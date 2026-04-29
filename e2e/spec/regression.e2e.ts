import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

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
