import { existsSync, lstatSync, realpathSync } from 'node:fs'
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
 * Phase-2 follow-up specs will add a UI-driven variant that walks the modal
 * to cover the click handlers (TODO).
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
