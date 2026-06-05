import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { _electron } from '@playwright/test'

import { test, expect } from '../fixtures/electron-app'
import { isSnapshotOffline } from '../fixtures/isolated-home'
import { getStoreState, waitForInitialScan } from '../helpers/redux'
import { readSettingsFile, writeSettingsFile } from '../helpers/settings-file'

/**
 * Hide unused agents from the sidebar.
 *
 * Coverage strategy: the feature crosses three boundaries that each fail
 * differently, so each gets its own test rather than a single flow that
 * couples them:
 *
 *   1. **UI flow** — Settings → Agents checkbox → optimistic dispatch →
 *      `settings:set` IPC → atomic disk write → `settings:changed`
 *      broadcast → main window `useSettingsSync` replaces state. A
 *      regression in any link of this chain breaks the user-visible
 *      "click to hide" gesture.
 *
 *   2. **IPC strict-enum boundary** — `IPC_ARG_SCHEMAS['settings:set']`
 *      uses `z.array(z.enum(AGENT_IDS))` (strict). A malicious or buggy
 *      renderer that emits an unknown id must be rejected at the
 *      boundary, not silently persisted. Pre-fix, the only test for this
 *      lived in `settings.test.ts` against the schema in isolation —
 *      this spec pins the LIVE boundary by going through the real preload
 *      bridge.
 *
 *   3. **Disk forgiving-schema boundary** — `HIDDEN_AGENT_IDS_SCHEMA` in
 *      `src/shared/settings.ts` is intentionally forgiving on disk read:
 *      it filters unknown ids via `.transform` so a stale id from a prior
 *      version (after a Skills CLI sync removes an agent) silently drops
 *      without taking down the whole settings file. If a future refactor
 *      tightens the disk schema, users with stale ids would lose their
 *      OTHER settings (default tab, terminal, window size) — a far worse
 *      blast radius than a phantom hidden entry. This test pins that
 *      contract end-to-end (settings.json on disk → loadSettings parse →
 *      Redux state) so the regression surfaces here, not in production.
 *
 * Why three tests instead of one: cases 2 and 3 hit code paths the UI
 * flow can't reach (renderers don't emit invalid ids; the disk schema
 * can't be exercised without a hand-staged file). Bundling them into the
 * UI flow would require dispatching synthetic actions and writing files
 * mid-flow — making the failure mode of each ambiguous.
 */

test.beforeEach(() => {
  // The UI test (case 1) needs Cursor's `exists=true`, which means the
  // `~/.cursor/skills` dir must be present when the renderer scans. The
  // sidebar render path also depends on the SOURCE_DIR (`~/.agents/skills`)
  // being populated by `installAzureSkills`. Skip when offline so a network
  // blip degrades to "skipped" rather than a confusing "Cursor row not
  // found" failure mid-spec.
  test.skip(
    isSnapshotOffline(),
    'snapshot SOURCE_DIR required to render the sidebar; runner is offline (global-setup wrote snapshot.offline=true)',
  )
})

test('toggling Cursor in Settings → Agents hides it from the sidebar and persists to disk', async ({
  appWindow,
  electronApp,
  isolatedHome,
}) => {
  // Arrange — pre-stage `~/.cursor/skills` so Cursor reports `exists: true`
  // in the agent scan. Without this, all 21 agents land in the "21 not
  // installed" disclosure and the "Show Cursor in sidebar" checkbox renders
  // disabled.
  mkdirSync(join(isolatedHome, '.cursor', 'skills'), { recursive: true })

  await waitForInitialScan(appWindow)

  // The mount-time `fetchAgents` thunk in the main window has already
  // fired by the time the fixture hands us `appWindow` — it captured the
  // pre-mkdir state where Cursor.exists was false. Re-fetch into the
  // SAME store via direct IPC + a synthetic fulfilled action so the
  // sidebar's `agents.items` reflects the now-existing `.cursor/skills`
  // dir. Equivalent in effect to dispatching the thunk; cheaper because
  // we skip the pending → thunk → fulfilled cycle.
  await appWindow.evaluate(async () => {
    const fresh = await window.electron.agents.getAll()
    const store = window.__store__ ?? window.__store
    if (!store) throw new Error('window.__store__ is not exposed')
    store.dispatch({
      type: 'agents/fetchAll/fulfilled',
      payload: fresh,
      meta: { requestId: 'e2e-stage-cursor', requestStatus: 'fulfilled' },
    })
  })

  // Arrange sanity guard: Cursor is now installed in the main window's store.
  // If this assertion fails, the rest of the test is meaningless because the
  // Settings checkbox would refer to a "not installed" agent.
  const cursorExistsBefore = await getStoreState(appWindow, (state) => {
    const root = state as {
      agents: { items: Array<{ id: string; exists: boolean }> }
    }
    return root.agents.items.find((a) => a.id === 'cursor')?.exists
  })
  expect(cursorExistsBefore).toBe(true)

  // Arrange sanity guard: nothing hidden yet — settings.json doesn't even
  // exist on disk because `saveSettings` only writes after the first mutation.
  const hiddenBefore = await getStoreState(appWindow, (state) => {
    const root = state as { settings: { hiddenAgentIds: string[] } }
    return root.settings.hiddenAgentIds
  })
  expect(hiddenBefore).toEqual([])

  // Act — open Settings → Agents and uncheck "Show Cursor in sidebar".
  // Open Settings — spawns a second BrowserWindow. Capture the window
  // event BEFORE clicking; Electron fires it synchronously when the new
  // webContents is created and racing it surfaces as a flaky timeout.
  const settingsWindowPromise = electronApp.waitForEvent('window')
  await appWindow.getByLabel('Open settings').click()
  const settingsWindow = await settingsWindowPromise
  await settingsWindow.waitForLoadState('domcontentloaded')

  // Navigate to Agents pane. The nav rail is plain `<button>` elements
  // (SettingsApp.tsx:79), so role=button + name='Agents' is the most
  // robust selector; aria-label is not set on these buttons.
  await settingsWindow.getByRole('button', { name: 'Agents' }).click()

  const cursorCheckbox = settingsWindow.getByRole('checkbox', {
    name: 'Show Cursor in sidebar',
  })
  await expect(cursorCheckbox).toBeVisible()
  await expect(cursorCheckbox).toBeChecked()

  await cursorCheckbox.click()

  // Assert — the hide propagated through IPC to the main window, the sidebar,
  // and the on-disk settings.json.
  // Wait for the cross-window IPC roundtrip to land. The sequence is:
  //   1. Settings window: optimistic `setSettings` dispatch.
  //   2. Settings window: `settings:set` IPC fires.
  //   3. Main process: `saveSettings` writes settings.json atomically.
  //   4. Main process: broadcasts `settings:changed` to every window.
  //   5. Main window: `useSettingsSync` receives → dispatches `setSettings`.
  // Polling on the MAIN window's state asserts the broadcast actually
  // reached it, which is the load-bearing cross-window invariant.
  await appWindow.waitForFunction(() => {
    const store = window.__store__ ?? window.__store
    if (!store) return false
    const state = store.getState() as {
      settings: { hiddenAgentIds: string[] }
    }
    return state.settings.hiddenAgentIds.includes('cursor')
  })

  // Sidebar reflects the hide: the disclosure summary appears. The
  // strict regex anchors prevent matching e.g. "11 hidden" if a future
  // bug accidentally hides every agent.
  await expect(appWindow.getByText(/^1 hidden$/)).toBeVisible()

  // Disk-side: settings.json contains `cursor`. Asserts the atomic
  // write (saveSettings does writeFile to a tempfile then rename) actually
  // landed, not just the optimistic dispatch in the renderer.
  const persisted = readSettingsFile(isolatedHome) as {
    hiddenAgentIds: string[]
  } | null
  expect(
    persisted,
    'settings.json should exist after first mutation',
  ).not.toBeNull()
  expect(persisted?.hiddenAgentIds).toContain('cursor')
})

test('IPC strict-enum boundary rejects unknown agent ids without persisting', async ({
  appWindow,
  isolatedHome,
}) => {
  // Arrange — wait for the initial scan so the IPC surface is live.
  await waitForInitialScan(appWindow)

  // Act — call the preload bridge directly with an unknown agent id,
  // bypassing `useUpdateSettings` — that hook does an optimistic dispatch
  // FIRST and then voids the IPC promise, so a rejection there would silently
  // leave the renderer with the bad value. The boundary we're testing is the
  // IPC schema, so we hit it directly and observe the rejection.
  const result = await appWindow.evaluate(async () => {
    try {
      // `window.electron.settings.set` is typed loosely in `e2e/types.d.ts`
      // (Record<string, unknown>) precisely so this boundary test can pass
      // values the production type system would reject — that's the whole
      // point of an "invalid id" assertion.
      await window.electron.settings.set({ hiddenAgentIds: ['bogus-id'] })
      return { rejected: false, message: null as string | null }
    } catch (err) {
      return {
        rejected: true,
        message: err instanceof Error ? err.message : String(err),
      }
    }
  })

  // Assert — the boundary rejected, the error names the channel + validation
  // marker, the renderer state stayed empty, and nothing was written to disk.
  expect(
    result.rejected,
    'settings.set should reject on unknown agent id',
  ).toBe(true)
  // typedHandle wraps ZodError into `Error('IPC validation failed on ${channel}: ...')`.
  // Asserting both substrings pins the channel-name AND the validation
  // marker so a future refactor of the error message either preserves
  // both or surfaces here.
  expect(result.message).toMatch(/IPC validation failed/)
  expect(result.message).toMatch(/settings:set/)

  // Renderer state is untouched — no optimistic update happened because
  // we bypassed `useUpdateSettings`.
  const hiddenAfter = await getStoreState(appWindow, (state) => {
    const root = state as { settings: { hiddenAgentIds: string[] } }
    return root.settings.hiddenAgentIds
  })
  expect(hiddenAfter).toEqual([])

  // Disk-side: settings.json was never written. Pre-fix `saveSettings`
  // ran BEFORE Zod validation moved into typedHandle, leaving on-disk
  // garbage on a rejected call. This assertion pins that the validation
  // gate stays UPSTREAM of disk writes.
  expect(readSettingsFile(isolatedHome)).toBeNull()
})

test('stale agent id is filtered from settings.json without dropping siblings', async ({
  isolatedHome,
}) => {
  // Arrange — pre-stage settings.json with a mix of valid + stale ids and
  // several sibling fields. Writes must happen BEFORE Electron boots so
  // `loadSettings` parses this file on startup. We don't request
  // `electronApp` or `appWindow` from the fixture so Playwright's lazy
  // fixture instantiation skips them — the default fixture would launch
  // Electron in series with `isolatedHome` creation, leaving no window
  // for us to write into the userData dir before parse.
  writeSettingsFile(isolatedHome, {
    hiddenAgentIds: ['cursor', 'removed-agent-zzz'],
    defaultSkillTab: 'info',
    preferredTerminal: 'iterm',
  })

  // Manual launch with the same env contract as the default fixture so
  // the IPC surface, the E2E build flag, the userData override, and the
  // auto-update suppression all match what the rest of the suite uses.
  // `E2E_USERDATA_DIR` is critical here: without it, `app.getPath('userData')`
  // would resolve to the developer's REAL Application Support dir on
  // macOS (NSSearchPath ignores `$HOME`), and the pre-staged
  // settings.json above would never be parsed by `loadSettings()`.
  const repoRoot = resolve(__dirname, '..', '..')
  const mainEntry = resolve(repoRoot, 'out', 'main', 'index.mjs')
  const electronApp = await _electron.launch({
    args: [mainEntry],
    env: {
      ...process.env,
      HOME: isolatedHome,
      E2E_USERDATA_DIR: resolve(isolatedHome, 'userData'),
      E2E_DISABLE_UPDATE: '1',
      E2E_BACKGROUND_LAUNCH: process.env['E2E_BACKGROUND_LAUNCH'] ?? '1',
    },
  })
  try {
    // Act — boot the app so `loadSettings` parses the pre-staged file.
    const appWindow = await electronApp.firstWindow()
    await appWindow.waitForLoadState('domcontentloaded')
    await waitForInitialScan(appWindow)

    // Assert — the stale id is dropped, the valid id survives, siblings intact.
    const settings = await getStoreState(appWindow, (state) => {
      const root = state as {
        settings: {
          hiddenAgentIds: string[]
          defaultSkillTab: string
          preferredTerminal: string
        }
      }
      return root.settings
    })

    // The stale id ('removed-agent-zzz') is filtered out by the disk
    // schema's `.transform` step; the valid id ('cursor') passes through.
    // Order is preserved because `Array.from(new Set(...))` keeps
    // insertion order for the surviving elements.
    expect(settings.hiddenAgentIds).toEqual(['cursor'])

    // Sibling fields are unaffected — load-bearing assertion. If the disk
    // schema ever changes from `.transform` to strict `.enum`, the entire
    // `SettingsSchema.parse()` would throw on the stale id, `loadSettings`
    // would catch and fall back to DEFAULT_SETTINGS, and these two
    // expectations would both fail with `'files'` and `'terminal'`.
    expect(settings.defaultSkillTab).toBe('info')
    expect(settings.preferredTerminal).toBe('iterm')
  } finally {
    await electronApp.close()
  }
})
