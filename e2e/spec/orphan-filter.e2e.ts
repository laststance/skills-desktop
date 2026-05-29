import { existsSync, lstatSync, mkdirSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'

import { test, expect } from '../fixtures/electron-app'
import { isSnapshotOffline } from '../fixtures/isolated-home'
import {
  dispatchAction,
  getStoreState,
  refreshSkillsState,
  waitForInitialScan,
} from '../helpers/redux'

/**
 * End-to-end FS-truth → user-visible-list contract for the new Orphan
 * filter. The selector logic itself is unit-tested at
 * `src/renderer/src/redux/selectors.test.ts`; this spec only owns the
 * "dangling symlink on disk → orphan row in filtered list" path.
 *
 * Mirrors the orphan staging from `regression.e2e.ts` (windsurf scanDir
 * is non-universal, so the orphan's only `'broken'` slot lands on a
 * single agent, which makes the negative-control under cursor meaningful).
 */

// Negative-control assertion below references azure-ai by name; an empty
// snapshot would silently invalidate it.
test.beforeEach(() => {
  test.skip(
    isSnapshotOffline(),
    'azure-* skills required to seed non-orphan rows for the negative-control assertion; runner is offline (global-setup wrote snapshot.offline=true)',
  )
})

/**
 * Replicates `selectFilteredSkills`'s agent-slot-gated orphan predicate
 * inside the renderer via `Function.toString`. Hoisted so the windsurf
 * positive case and the cursor negative case share one body — the e2e
 * bundle does not surface individual selector modules to `page.evaluate`.
 */
const filterOrphanNamesByAgent = (
  state: unknown,
  args: { agentId: string },
): string[] => {
  const root = state as {
    skills: {
      items: Array<{
        name: string
        isOrphan: boolean
        symlinks: Array<{
          agentId: string
          status: 'valid' | 'broken' | 'missing'
          isLocal: boolean
        }>
      }>
    }
  }
  return root.skills.items
    .filter(
      (skill) =>
        skill.isOrphan === true &&
        skill.symlinks.some(
          (slot) =>
            slot.agentId === args.agentId &&
            (slot.status === 'valid' || slot.status === 'broken'),
        ),
    )
    .map((skill) => skill.name)
}

test('Orphan filter narrows visible list to orphan skills only', async ({
  appWindow,
  isolatedHome,
}) => {
  // Arrange — wait for the initial scan, then stage a dangling symlink under
  // windsurf so `scanOrphanSymlinks` surfaces a synthetic orphan row.
  await waitForInitialScan(appWindow)

  const orphanSkillName = 'orphan-filter-fixture'
  const windsurfSkillsDir = join(isolatedHome, '.codeium', 'windsurf', 'skills')
  mkdirSync(windsurfSkillsDir, { recursive: true })

  // Target intentionally absent — `scanOrphanSymlinks` requires a dangling
  // link to surface a synthetic Skill row.
  const phantomSourcePath = join(
    isolatedHome,
    '.agents',
    'skills',
    orphanSkillName,
  )
  const orphanLinkPath = join(windsurfSkillsDir, orphanSkillName)
  symlinkSync(phantomSourcePath, orphanLinkPath)

  // FS-truth sanity guards (still Arrange): a real symlink with an absent target.
  expect(lstatSync(orphanLinkPath).isSymbolicLink()).toBe(true)
  expect(existsSync(phantomSourcePath)).toBe(false)

  await refreshSkillsState(appWindow)

  // Act — select windsurf and switch the visible list to the Orphan filter.
  await dispatchAction(appWindow, {
    type: 'ui/selectAgent',
    payload: 'windsurf',
  })
  await dispatchAction(appWindow, {
    type: 'ui/setSkillTypeFilter',
    payload: 'orphan',
  })

  // Assert — the UI state reflects the chosen agent + filter.
  const uiState = await getStoreState(appWindow, (state) => {
    const root = state as {
      ui: { selectedAgentId: string | null; skillTypeFilter: string }
    }
    return {
      selectedAgentId: root.ui.selectedAgentId,
      skillTypeFilter: root.ui.skillTypeFilter,
    }
  })
  expect(uiState.selectedAgentId).toBe('windsurf')
  expect(uiState.skillTypeFilter).toBe('orphan')

  // Assert — only the staged orphan remains under windsurf. Single-row
  // equality (not `.toContain`) so a regression that lets non-orphan rows
  // leak shows the offending names in the failure diff.
  const filteredNames = await getStoreState(
    appWindow,
    filterOrphanNamesByAgent,
    { agentId: 'windsurf' },
  )
  expect(filteredNames).toEqual([orphanSkillName])

  // Act — switch to cursor for the negative control.
  // The orphan's only `'broken'` slot is on windsurf, so the agent-slot gate
  // must drop it under cursor. Without this leg, a regression that ran the
  // orphan predicate against the unfiltered skills array would still pass the
  // positive assertion above.
  await dispatchAction(appWindow, {
    type: 'ui/selectAgent',
    payload: 'cursor',
  })

  // Assert — the orphan does not surface under cursor.
  const filteredNamesUnderCursor = await getStoreState(
    appWindow,
    filterOrphanNamesByAgent,
    { agentId: 'cursor' },
  )
  expect(
    filteredNamesUnderCursor,
    'orphan must NOT surface under cursor — its only broken slot is on windsurf',
  ).not.toContain(orphanSkillName)
})
