import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { test, expect } from '../fixtures/electron-app'
import { isSnapshotOffline } from '../fixtures/isolated-home'
import { waitForInitialScan } from '../helpers/redux'

/**
 * Issues #103 / #104 — DOM-binding regression guards for the folder actions
 * (Reveal in Finder / Open in Terminal). These specs deliberately do NOT
 * launch Finder or any terminal app: OS side-effects are out of scope for a
 * deterministic test runner. What we DO assert:
 *
 *   1. SourceCard kebab exposes both menu items (issue #103 surface).
 *   2. AgentItem context menu exposes both menu items above the existing
 *      Cleanup / Delete items, in the order the spec dictates (#104 surface).
 *   3. Settings → "Preferred terminal" picker enumerates all 8 terminal IDs
 *      and reveals the custom-name <input> only when 'custom' is selected.
 *
 * If any of these aria-labels or option lists drift, the user-visible IPC
 * binding silently breaks — `useOpenFolder` would still exist, but no UI
 * could trigger it. That class of regression cannot be caught by the unit
 * tests under `src/main/ipc/folder.test.ts` because they never touch the
 * renderer tree.
 */

// All three tests need at least the SOURCE_DIR in the snapshot to surface
// universal agents (and SourceCard rows) in the sidebar. Skipping mirrors
// the offline-skip pattern in regression.e2e.ts so an offline runner does
// not produce a confusing "menu item not found" failure when the real
// cause is empty fixture state.
test.beforeEach(() => {
  test.skip(
    isSnapshotOffline(),
    'snapshot SOURCE_DIR required to render the sidebar; runner is offline (global-setup wrote snapshot.offline=true)',
  )
})

test('the source folder menu offers Reveal in Finder and Open in Terminal', async ({
  appWindow,
}) => {
  // Arrange — wait for the initial scan so the source card renders.
  await waitForInitialScan(appWindow)

  // Act — open the source folder actions menu via its kebab trigger.
  // Single kebab-only trigger; right-click on the card body opens the same
  // menu but is covered separately by the unit-level component story. Here
  // we exercise the explicit click path the user typically takes.
  await appWindow.getByLabel('Source folder actions').click()

  // Assert — both folder action items are visible in the menu.
  await expect(
    appWindow.getByRole('menuitem', { name: 'Reveal in Finder' }),
  ).toBeVisible()
  await expect(
    appWindow.getByRole('menuitem', { name: 'Open in Terminal' }),
  ).toBeVisible()
})

test('right-clicking an agent shows the safe folder actions above the destructive Cleanup and Delete items', async ({
  appWindow,
  isolatedHome,
}) => {
  // Arrange — stage `.cursor/skills` so the Cursor agent reports `exists: true`
  // (`handleContextMenu` short-circuits when the agent dir is absent, so the
  // menu would never open without this). Single mkdir is enough; we never
  // write any skill files because the test asserts DOM, not symlink state.
  mkdirSync(join(isolatedHome, '.cursor', 'skills'), { recursive: true })

  await waitForInitialScan(appWindow)

  // Act — right-click the Cursor row to open its context menu.
  // The Cursor row's aria-label is "Filter skills by Cursor (N linked, M local)";
  // the prefix is stable across snapshot churn so we anchor on it. Right-click
  // is the documented gesture for opening the menu — left-click only filters.
  await appWindow
    .getByLabel(/^Filter skills by Cursor/)
    .first()
    .click({ button: 'right' })

  // Assert — all four items are visible and the safe folder actions sit above
  // Cleanup/Delete on the y-axis.
  // Folder actions render above Cleanup/Delete by design: keyboard nav
  // (Down then Enter) lands on a safe action first.
  const reveal = appWindow.getByRole('menuitem', { name: 'Reveal in Finder' })
  const openTerm = appWindow.getByRole('menuitem', { name: 'Open in Terminal' })
  const cleanup = appWindow.getByRole('menuitem', {
    name: /Cleanup missing skills/,
  })
  const remove = appWindow.getByRole('menuitem', {
    name: 'Delete skills folder',
  })

  await expect(reveal).toBeVisible()
  await expect(openTerm).toBeVisible()
  await expect(cleanup).toBeVisible()
  await expect(remove).toBeVisible()

  // Y-axis order check: visibility alone would pass even if Reveal/Open were
  // moved BELOW Cleanup/Delete, defeating the "safe-action-first" ordering
  // contract this test claims to enforce. Compare boundingBox().y so a
  // refactor that reshuffles items fails here, not in production where the
  // user notices Down→Enter triggering Delete.
  const [revealBox, openTermBox, cleanupBox, removeBox] = await Promise.all([
    reveal.boundingBox(),
    openTerm.boundingBox(),
    cleanup.boundingBox(),
    remove.boundingBox(),
  ])
  // `boundingBox()` returns null only for invisible elements — already
  // guarded by the `toBeVisible` assertions above, so the `!` is safe.
  expect(revealBox!.y).toBeLessThan(cleanupBox!.y)
  expect(openTermBox!.y).toBeLessThan(cleanupBox!.y)
  expect(cleanupBox!.y).toBeLessThan(removeBox!.y)
})

test('Settings → Preferred terminal picker lists all 8 IDs and reveals custom input on select', async ({
  appWindow,
  electronApp,
}) => {
  // Arrange — open Settings in its own window and surface the terminal picker.
  await waitForInitialScan(appWindow)

  // Opening Settings spawns a second BrowserWindow. Capture the window event
  // BEFORE clicking — the event fires synchronously when the new window's
  // webContents is created, and racing it would surface as a flaky timeout.
  const settingsWindowPromise = electronApp.waitForEvent('window')
  await appWindow.getByLabel('Open settings').click()
  const settingsWindow = await settingsWindowPromise
  await settingsWindow.waitForLoadState('domcontentloaded')

  const picker = settingsWindow.getByLabel('Preferred terminal')
  await picker.waitFor({ state: 'visible' })

  // Assert — the picker lists all 8 terminal IDs in order.
  // Pin the option list against `TERMINAL_APP_IDS` order. A regression that
  // appended/removed an ID without updating the picker would land here, not
  // in production where the user notices a missing terminal a week later.
  const optionValues = await picker
    .locator('option')
    .evaluateAll((opts) => opts.map((opt) => (opt as HTMLOptionElement).value))
  expect(optionValues).toEqual([
    'terminal',
    'iterm',
    'warp',
    'ghostty',
    'alacritty',
    'kitty',
    'wezterm',
    'custom',
  ])

  // Act — choose the 'custom' option.
  // The custom-name <input> is rendered conditionally on
  // `settings.preferredTerminal === 'custom'`. The load-bearing assertion is
  // that selecting 'custom' makes the input visible — we don't assert the
  // pre-state because settings.json may be persisted into the snapshot HOME
  // from a prior dev session.
  await picker.selectOption('custom')

  // Assert — the custom terminal name input becomes visible.
  await expect(
    settingsWindow.getByLabel('Custom terminal app name'),
  ).toBeVisible()
})
