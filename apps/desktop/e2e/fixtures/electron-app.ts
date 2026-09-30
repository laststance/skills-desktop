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
 * Launch the production `out/` build against an isolated HOME with the full
 * e2e env contract — `E2E_USERDATA_DIR`, `E2E_DISABLE_UPDATE`, and the
 * `E2E_BACKGROUND_LAUNCH` passthrough. Shared by the `electronApp` fixture
 * and by specs that must drive a second launch themselves (true process
 * relaunches can't reuse the fixture's single app instance).
 *
 * `E2E_USERDATA_DIR` is critical: without it, `app.getPath('userData')`
 * resolves via the OS user (NOT `$HOME`) and anything persisted under
 * userData — settings.json, Chromium localStorage — would silently target
 * the developer's real profile.
 *
 * @param isolatedHome - The isolated HOME this launch must use.
 * @param envOverrides - Spec-specific env vars merged over the defaults —
 *   e.g. `PATH` for the sparse-GUI-path install regression, or a deliberate
 *   `E2E_DISABLE_UPDATE: ''` when a spec exercises the updater.
 * @returns The launched Electron application; caller owns `close()`.
 * @example
 * const app = await launchIsolatedElectron(home)
 * try { ... } finally { await app.close() }
 */
export async function launchIsolatedElectron(
  isolatedHome: string,
  envOverrides: Record<string, string> = {},
): Promise<ElectronApplication> {
  const repoRoot = resolve(__dirname, '..', '..')
  const mainEntry = resolve(repoRoot, 'out', 'main', 'index.mjs')
  return _electron.launch({
    args: [mainEntry],
    env: {
      ...process.env,
      HOME: isolatedHome,
      // Force Electron's `userData` into the isolated HOME — without
      // this, `app.getPath('userData')` resolves via the OS user (NOT
      // `$HOME`) and tests writing settings.json or session storage
      // would silently target the developer's real profile. See
      // src/main/index.ts where `E2E_USERDATA_DIR` is consumed.
      E2E_USERDATA_DIR: resolve(isolatedHome, 'userData'),
      E2E_DISABLE_UPDATE: '1',
      // Default to fully-hidden windows; allow opt-out when the developer
      // wants to watch the test (e.g. `E2E_BACKGROUND_LAUNCH=0 pnpm test:e2e:headed`).
      E2E_BACKGROUND_LAUNCH: process.env['E2E_BACKGROUND_LAUNCH'] ?? '1',
      // Caller overrides land last so a spec can replace any default.
      ...envOverrides,
    },
  })
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
    // Playwright's fixture callback is named `use`; this is not a React Hook.
    // react-doctor-disable-next-line react-hooks/rules-of-hooks
    await use(home)
    destroyIsolatedHome(home)
  },
  electronApp: async ({ isolatedHome }, use) => {
    const app = await launchIsolatedElectron(isolatedHome)
    // Playwright's fixture callback is named `use`; this is not a React Hook.
    // react-doctor-disable-next-line react-hooks/rules-of-hooks
    await use(app)
    await app.close()
  },
  appWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    // Playwright's fixture callback is named `use`; this is not a React Hook.
    // react-doctor-disable-next-line react-hooks/rules-of-hooks
    await use(window)
  },
})

export { expect } from '@playwright/test'
