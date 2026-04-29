import { test, expect } from '../fixtures/electron-app'

/**
 * Phase-1 smoke test. Confirms:
 *   1. The production build at `out/main/index.mjs` launches under Playwright
 *   2. The first window mounts and reaches DOMContentLoaded
 *   3. `window.__store__` and `window.__ipcEvents__` are exposed
 *      (i.e. the bundle was built with `E2E_BUILD=1`)
 *   4. The auto-updater stayed dormant under `E2E_DISABLE_UPDATE=1` —
 *      asserted by checking that no `update:*` IPC event landed in the
 *      recorder during launch.
 *
 * Specs covering the actual copy/delete IPC channels arrive in Phase 2.
 */
test('app launches with E2E build harness exposed', async ({ appWindow }) => {
  const exposedStore = await appWindow.evaluate(() => Boolean(window.__store__))
  const exposedEvents = await appWindow.evaluate(() =>
    Boolean(window.__ipcEvents__),
  )
  expect(
    exposedStore,
    'window.__store__ should be exposed under E2E_BUILD=1',
  ).toBe(true)
  expect(
    exposedEvents,
    'window.__ipcEvents__ should be exposed under E2E_BUILD=1',
  ).toBe(true)

  const initialState = await appWindow.evaluate(() =>
    window.__store__?.getState(),
  )
  expect(
    initialState,
    'store.getState() should return a real object',
  ).toBeTruthy()

  // Auto-updater dormancy check. `E2E_DISABLE_UPDATE=1` is set in the
  // electron-app fixture's launch env (see fixtures/electron-app.ts) and
  // should suppress every `update:checking` / `update:available` /
  // `update:not-available` / `update:progress` / `update:downloaded` /
  // `update:error` channel for the entire process lifetime. Reading the
  // recorder once at the end of launch is enough — these channels fire
  // synchronously off `app.whenReady` in the production code path.
  const updaterIpcEvents = await appWindow.evaluate(
    () =>
      window.__ipcEvents__
        ?.list()
        .filter((event) => event.channel.startsWith('update:')) ?? [],
  )
  expect(
    updaterIpcEvents,
    'auto-updater should stay dormant under E2E_DISABLE_UPDATE=1',
  ).toEqual([])
})
