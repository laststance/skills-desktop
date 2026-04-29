import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { test, expect } from '../fixtures/electron-app'
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
 * TODO Phase-2 follow-up: cover the local-only delete branch (skills that
 * exist as real folders in agent dirs with no `~/.agents/skills/<name>`
 * source). That path exercises `moveLocalOnlyToTrash` + `restoreLocalOnly`
 * which is independently bisectable from the source-backed flow.
 */

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
