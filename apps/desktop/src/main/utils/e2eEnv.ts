/**
 * True when the Electron app was spawned by the Playwright E2E fixture
 * (`e2e/fixtures/electron-app.ts`), which sets
 * `E2E_BACKGROUND_LAUNCH=1` by default. Single source of truth shared
 * by `src/main/index.ts` and `src/main/services/settingsWindow.ts` so a
 * typo in the env-var key can't silently flip only one call site.
 *
 * When set, BrowserWindows are kept fully hidden (no `show()` /
 * `showInactive()` / `maximize()`) and the app is hidden from the Dock
 * / Cmd-Tab via `app.setActivationPolicy('accessory')`. Playwright
 * drives the renderer through `webContents`, which loads regardless of
 * window visibility, so tests don't need a visible window.
 *
 * NOTE: `showInactive()` does NOT hide the window — per Electron docs
 * it shows the window without focusing it. Only skipping `show()`
 * entirely keeps the window off-screen.
 */
export const isE2EBackgroundLaunch =
  process.env['E2E_BACKGROUND_LAUNCH'] === '1'
