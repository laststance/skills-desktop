import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Settings } from '@/shared/settings'

import { test, expect } from '../fixtures/electron-app'
import { readSettingsFile, writeSettingsFile } from '../helpers/settings-file'

type IsolatedHomeUse = (home: string) => Promise<void>

// The three appearance fields these specs probe, all optional so the same shape
// fits a partially-written settings.json, the Redux slice, and a missing file.
type AppearanceProbe = Partial<
  Pick<Settings, 'markdownFontSizePx' | 'codeFontSizePx' | 'codeThemeId'>
>

/**
 * Provide an isolated HOME for the Appearance round-trip specs, optionally
 * pre-staging a `settings.json` before Electron launches so the load path can
 * assert what the renderer hydrates. Mirrors the search-count spec's fixture.
 * @param use - Playwright fixture continuation that launches Electron after setup.
 * @param staged - Optional partial settings to write to disk before launch.
 * @returns Promise that resolves after the fixture HOME is cleaned up.
 * @example
 * await useAppearanceHome(use, { markdownFontSizePx: 20 })
 */
async function useAppearanceHome(
  use: IsolatedHomeUse,
  staged?: Record<string, unknown>,
): Promise<void> {
  const home = realpathSync.native(
    mkdtempSync(join(tmpdir(), 'skills-desktop-e2e-appearance-')),
  )
  try {
    // Pre-stage only when the test exercises the disk → renderer load path.
    if (staged) {
      writeSettingsFile(home, staged)
    }
    await use(home)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

const savedAppearanceTest = test.extend<{ isolatedHome: string }>({
  // eslint-disable-next-line no-empty-pattern
  isolatedHome: async ({}, use) => {
    await useAppearanceHome(use, {
      markdownFontSizePx: 20,
      codeFontSizePx: 18,
      codeThemeId: 'vitesse',
    } satisfies Partial<Settings>)
  },
})

const freshAppearanceTest = test.extend<{ isolatedHome: string }>({
  // eslint-disable-next-line no-empty-pattern
  isolatedHome: async ({}, use) => {
    await useAppearanceHome(use)
  },
})

savedAppearanceTest(
  'restores the saved Markdown size, code size, and code theme from disk on launch',
  async ({ appWindow, isolatedHome }) => {
    // Arrange — settings.json was pre-staged with non-default appearance values
    // (see the fixture). Wait for the renderer to hydrate the settings slice
    // from the main-process roundtrip before asserting.
    // Act
    await appWindow.waitForFunction(() => {
      const store = window.__store__
      if (!store) return false
      const settings = (store.getState() as { settings?: AppearanceProbe })
        .settings
      return (
        settings?.markdownFontSizePx === 20 &&
        settings?.codeFontSizePx === 18 &&
        settings?.codeThemeId === 'vitesse'
      )
    })

    // Assert — the renderer cache mirrors exactly what was on disk.
    const hydrated = await appWindow.evaluate(() => {
      const state = window.__store__?.getState() as {
        settings?: AppearanceProbe
      }
      return state?.settings ?? null
    })
    expect(hydrated?.markdownFontSizePx).toBe(20)
    expect(hydrated?.codeFontSizePx).toBe(18)
    expect(hydrated?.codeThemeId).toBe('vitesse')

    // Assert — a read-only launch leaves the on-disk file untouched.
    const persisted = readSettingsFile(isolatedHome) as AppearanceProbe | null
    expect(persisted?.markdownFontSizePx).toBe(20)
    expect(persisted?.codeFontSizePx).toBe(18)
    expect(persisted?.codeThemeId).toBe('vitesse')
  },
)

freshAppearanceTest(
  'persists a Markdown size, code size, and code theme change to settings.json',
  async ({ appWindow, isolatedHome }) => {
    // Arrange — the app launched with default appearance settings (no staged
    // file). Wait for the store before driving the change.
    await appWindow.waitForFunction(() => Boolean(window.__store__))

    // Act — drive the same IPC the Appearance pane uses: renderer →
    // 'settings:set' → main writes settings.json → broadcasts 'settings:changed'.
    await appWindow.evaluate(async () => {
      await window.electron.settings.set({
        markdownFontSizePx: 16,
        codeFontSizePx: 11,
        codeThemeId: 'one',
      })
    })

    // Assert — poll the on-disk file, NOT Redux: settings.set updates the
    // renderer cache optimistically before main finishes the write, so the
    // file is the lagging source of truth and the only race-free signal.
    await expect
      .poll(
        () =>
          (readSettingsFile(isolatedHome) as AppearanceProbe | null)
            ?.markdownFontSizePx,
      )
      .toBe(16)

    const persisted = readSettingsFile(isolatedHome) as AppearanceProbe | null
    expect(persisted?.markdownFontSizePx).toBe(16)
    expect(persisted?.codeFontSizePx).toBe(11)
    expect(persisted?.codeThemeId).toBe('one')

    // Assert — the change propagates back into the renderer cache via the
    // 'settings:changed' broadcast that useSettingsSync re-dispatches.
    await appWindow.waitForFunction(() => {
      const settings = (
        window.__store__?.getState() as {
          settings?: { codeThemeId?: string }
        }
      ).settings
      return settings?.codeThemeId === 'one'
    })
  },
)
