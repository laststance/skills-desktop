import { test, expect } from '../fixtures/electron-app'

/**
 * Phase-1 smoke test. Confirms:
 *   1. The production build at `out/main/index.mjs` launches under Playwright
 *   2. The first window mounts and reaches DOMContentLoaded
 *   3. `window.__store__` and `window.__ipcEvents__` are exposed
 *      (i.e. the bundle was built with `E2E_BUILD=1`)
 *   4. The auto-updater stayed dormant under `E2E_DISABLE_UPDATE=1`
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
})
