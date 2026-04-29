import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

import { test, expect } from '../fixtures/electron-app'
import {
  clearIpcEvents,
  getIpcEvents,
  waitForInitialScan,
} from '../helpers/redux'

interface DeleteProgressPayload {
  current: number
  total: number
}

/**
 * Pre-stage `count` source-backed dummy skills under the isolated HOME's
 * universal source dir (`~/.agents/skills/<name>`). Each skill gets a minimal
 * SKILL.md so the trash flow has real bytes to move. No agent symlinks are
 * created — the bulk-delete handler only needs the source dir to exist.
 *
 * Returns the names in creation order so the caller can build the IPC payload
 * with the same iteration order and assert on it.
 */
function preStageDummySkills(
  isolatedHome: string,
  count: number,
  prefix: string,
): string[] {
  const sourceDir = join(isolatedHome, '.agents', 'skills')
  const names: string[] = []
  for (let i = 0; i < count; i++) {
    const name = `${prefix}-${String(i).padStart(2, '0')}`
    const skillDir = join(sourceDir, name)
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `# ${name}\n\nFixture skill for the bulk-delete E2E spec.\n`,
    )
    names.push(name)
  }
  return names
}

/**
 * Phase-2 spec covering the `BULK_PROGRESS_THRESHOLD` boundary in
 * `SKILLS_DELETE_BATCH`. The handler emits one `skills:deleteProgress` event
 * per item ONLY when the batch size meets or exceeds the threshold (10) —
 * smaller batches skip the event to avoid toast churn (see skills.ts:269).
 *
 * Two tests, both pre-staging dummy source-backed skills procedurally so the
 * tests don't depend on the global-setup skill catalog. Each test runs in a
 * fresh isolated HOME via the snapshot/restore fixture so trash state from
 * one boundary cannot bleed into the other's assertions.
 *
 * The renderer's `MainContent` mounts an `onDeleteProgress` subscription on
 * load (see MainContent.tsx:196), which routes received events through the
 * preload `recordIpcEvent` recorder. That makes `__ipcEvents__` the canonical
 * place to read the emitted progress stream from the test process — we do not
 * need to subscribe again here.
 *
 * NOTE: pre-staging uses Node's mkdir/write directly rather than the skills
 * CLI because the CLI is far slower (~3s/skill) and we don't need its agent-
 * linking behavior — bulk delete only requires the source dir to exist.
 */

test('bulk deleteSkills below BULK_PROGRESS_THRESHOLD (N=9) skips progress events', async ({
  appWindow,
  isolatedHome,
}) => {
  const skillNames = preStageDummySkills(isolatedHome, 9, 'bulk-below')

  // Wait for renderer to mount + finish initial scan. Pre-staged skills may
  // or may not have been picked up by that scan depending on race ordering;
  // it doesn't matter because the IPC handler reads from disk independently.
  await waitForInitialScan(appWindow)

  await clearIpcEvents(appWindow)

  const result = await appWindow.evaluate(
    async (items: Array<{ skillName: string }>) =>
      window.electron.skills.deleteSkills({ items }),
    skillNames.map((skillName) => ({ skillName })),
  )

  expect(result.items).toHaveLength(9)
  for (const item of result.items) {
    expect(item.outcome).toBe('deleted')
    if (item.outcome === 'deleted') {
      expect(item.tombstoneId).toMatch(/^\d+-bulk-below-\d{2}-[0-9a-f]{8}$/)
      // Dummy skills have no agent symlinks — both fields must be zero/empty
      // to confirm we exercised the source-backed path with no cascade.
      expect(item.symlinksRemoved).toBe(0)
      expect(item.cascadeAgents).toEqual([])
    }
  }

  // KEY assertion — at N < threshold the handler must skip every progress
  // emit. If the threshold drifts or the conditional is inverted this fails
  // with a clear "expected 0 events, got 9" instead of an obscure UI symptom.
  const recordedEvents = await getIpcEvents(appWindow)
  expect(
    recordedEvents.filter((event) => event.channel === 'skills:deleteProgress'),
  ).toEqual([])

  // FS — every source dir gone, every trash entry written.
  for (const name of skillNames) {
    expect(existsSync(join(isolatedHome, '.agents', 'skills', name))).toBe(
      false,
    )
  }
  const trashDir = join(isolatedHome, '.agents', '.trash')
  const trashEntries = readdirSync(trashDir).filter((entry) =>
    entry.includes('-bulk-below-'),
  )
  expect(trashEntries).toHaveLength(9)
  // Spot-check one manifest to confirm the source-backed branch was taken.
  const sampleManifest = JSON.parse(
    readFileSync(join(trashDir, trashEntries[0], 'manifest.json'), 'utf-8'),
  ) as { kind: string }
  expect(sampleManifest.kind).toBe('source-backed')
})

test('bulk deleteSkills at BULK_PROGRESS_THRESHOLD (N=10) emits sequential progress events', async ({
  appWindow,
  isolatedHome,
}) => {
  const skillNames = preStageDummySkills(isolatedHome, 10, 'bulk-at')

  await waitForInitialScan(appWindow)

  await clearIpcEvents(appWindow)

  const result = await appWindow.evaluate(
    async (items: Array<{ skillName: string }>) =>
      window.electron.skills.deleteSkills({ items }),
    skillNames.map((skillName) => ({ skillName })),
  )

  expect(result.items).toHaveLength(10)
  for (const [index, item] of result.items.entries()) {
    expect(item.outcome).toBe('deleted')
    expect(item.skillName).toBe(skillNames[index])
  }

  // KEY assertion — exactly N progress events with sequential `current`
  // values from 1 to N and a constant `total` of N. The serial for...of in
  // skills.ts means strict ordering is the contract; a parallelization
  // regression would surface as out-of-order or duplicate `current` values.
  const recordedEvents = await getIpcEvents(appWindow)
  const progressEvents = recordedEvents
    .filter((event) => event.channel === 'skills:deleteProgress')
    .map((event) => event.data as DeleteProgressPayload)

  expect(progressEvents).toHaveLength(10)
  expect(progressEvents).toEqual(
    Array.from({ length: 10 }, (_, index) => ({
      current: index + 1,
      total: 10,
    })),
  )

  // FS — every source dir gone, exactly N trash entries created.
  for (const name of skillNames) {
    expect(existsSync(join(isolatedHome, '.agents', 'skills', name))).toBe(
      false,
    )
  }
  const trashDir = join(isolatedHome, '.agents', '.trash')
  const trashEntries = readdirSync(trashDir).filter((entry) =>
    entry.includes('-bulk-at-'),
  )
  expect(trashEntries).toHaveLength(10)
})

/**
 * Partial-failure boundary — one item in the batch raises `TrashError 'ENOENT'`
 * (its source dir was wiped out-of-band before the IPC call), the other nine
 * succeed. Locks in the contract that:
 *
 *   1. The serial loop in `SKILLS_DELETE_BATCH` does NOT short-circuit on a
 *      per-item error — every remaining item still runs.
 *   2. The failing item produces an `outcome: 'error'` row with a structured
 *      `error: { message, code: 'ENOENT' }` instead of throwing out of the
 *      handler.
 *   3. Progress events still fire for every iteration when N >= threshold.
 *      A regression that moved the `typedSend` inside the try/catch would
 *      drop the failing item's tick and the progress stream would only have
 *      9 events for a 10-item batch.
 */
test('bulk deleteSkills with one missing source returns per-item error and continues the batch', async ({
  appWindow,
  isolatedHome,
}) => {
  const skillNames = preStageDummySkills(isolatedHome, 10, 'bulk-partial')
  // Pick a middle index so a regression that breaks AFTER the first error
  // still trips the assertion. Index 0 or N-1 would not catch a partial loop
  // that aborts as soon as the first error fires.
  const failingIndex = 5
  const failingSkillName = skillNames[failingIndex]
  rmSync(join(isolatedHome, '.agents', 'skills', failingSkillName), {
    recursive: true,
    force: true,
  })

  await waitForInitialScan(appWindow)

  await clearIpcEvents(appWindow)

  const result = await appWindow.evaluate(
    async (items: Array<{ skillName: string }>) =>
      window.electron.skills.deleteSkills({ items }),
    skillNames.map((skillName) => ({ skillName })),
  )

  expect(result.items).toHaveLength(10)

  // Per-item assertions — exactly one error row at the expected index, every
  // other row a success. Iterate by index instead of filtering so a regression
  // that misroutes the error to a different position is caught.
  for (const [index, item] of result.items.entries()) {
    if (index === failingIndex) {
      expect(item.skillName).toBe(failingSkillName)
      expect(item.outcome).toBe('error')
      if (item.outcome === 'error') {
        expect(item.error.code).toBe('ENOENT')
        expect(item.error.message).toMatch(/Skill not found/)
      }
    } else {
      expect(item.skillName).toBe(skillNames[index])
      expect(item.outcome).toBe('deleted')
    }
  }

  // Progress events — N=10 >= threshold, so the handler must emit one tick per
  // iteration regardless of per-item success. This is the load-bearing
  // assertion against a "wrap typedSend in the try block" regression that
  // would silently drop the failing item's tick.
  const recordedEvents = await getIpcEvents(appWindow)
  const progressEvents = recordedEvents
    .filter((event) => event.channel === 'skills:deleteProgress')
    .map((event) => event.data as DeleteProgressPayload)
  expect(progressEvents).toHaveLength(10)
  expect(progressEvents).toEqual(
    Array.from({ length: 10 }, (_, index) => ({
      current: index + 1,
      total: 10,
    })),
  )

  // FS — exactly 9 trash entries (one short of N), and the failing skill has
  // no entry by name. Ranged includes-check protects against a regression
  // where the handler creates an empty/half-written tombstone for the failing
  // item before bailing, which would still match a length-only check.
  const trashDir = join(isolatedHome, '.agents', '.trash')
  const trashEntries = readdirSync(trashDir).filter((entry) =>
    entry.includes('-bulk-partial-'),
  )
  expect(trashEntries).toHaveLength(9)
  expect(
    trashEntries.some((entry) => entry.includes(`-${failingSkillName}-`)),
  ).toBe(false)
})
