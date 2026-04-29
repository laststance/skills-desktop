import { resolve } from 'node:path'

import {
  test as baseTest,
  _electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test'

import { createIsolatedHome, destroyIsolatedHome } from './isolated-home'

interface ElectronFixtures {
  electronApp: ElectronApplication
  appWindow: Page
  isolatedHome: string
}

/**
 * Custom Playwright fixture that launches Electron against the production
 * `out/` build with an isolated HOME. Each test gets:
 *   - a fresh tempdir HOME (hardlinked from global-setup snapshot when present)
 *   - the Electron app launched with that HOME + `E2E_DISABLE_UPDATE=1`
 *   - the first window pre-resolved as `appWindow`
 *
 * Tests can use `page.evaluate(() => window.__store__?.getState())` for
 * Redux assertions and `page.evaluate(() => window.__ipcEvents__?.list())`
 * for IPC progress event assertions — both surfaces are populated by
 * the renderer/preload when `E2E_BUILD=1` was set at build time.
 */
export const test = baseTest.extend<ElectronFixtures>({
  // Playwright reads the destructured fixture names to build the dependency
  // graph. `isolatedHome` requests no other fixtures, so the parameter must
  // stay as `{}` — replacing it with `_` would change Playwright's analysis.
  // eslint-disable-next-line no-empty-pattern
  isolatedHome: async ({}, use) => {
    const home = createIsolatedHome()
    await use(home)
    destroyIsolatedHome(home)
  },
  electronApp: async ({ isolatedHome }, use) => {
    const repoRoot = resolve(__dirname, '..', '..')
    const mainEntry = resolve(repoRoot, 'out', 'main', 'index.mjs')
    const app = await _electron.launch({
      args: [mainEntry],
      env: {
        ...process.env,
        HOME: isolatedHome,
        E2E_DISABLE_UPDATE: '1',
      },
    })
    await use(app)
    await app.close()
  },
  appWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await use(window)
  },
})

export { expect } from '@playwright/test'
