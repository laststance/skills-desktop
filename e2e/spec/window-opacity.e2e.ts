import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Locator, Page } from '@playwright/test'

import type { Settings } from '@/shared/settings'

import { test, expect } from '../fixtures/electron-app'
import { readSettingsFile, writeSettingsFile } from '../helpers/settings-file'

const opacityTest = test.extend<{
  initialSettings: Partial<Settings>
  settingsWindow: Page
}>({
  initialSettings: [{ windowBackgroundBlurRadius: 24 }, { option: true }],
  isolatedHome: async ({ initialSettings }, use) => {
    const isolatedHome = realpathSync.native(
      mkdtempSync(join(tmpdir(), 'skills-desktop-e2e-opacity-')),
    )
    try {
      // Stage only this test's preferences before the shared fixture launches Electron.
      writeSettingsFile(isolatedHome, initialSettings)
      await use(isolatedHome)
    } finally {
      rmSync(isolatedHome, { recursive: true, force: true })
    }
  },
  settingsWindow: async ({ electronApp, appWindow }, use) => {
    const settingsWindowPromise = electronApp.waitForEvent('window')
    await appWindow.getByRole('button', { name: 'Open settings' }).click()
    const settingsWindow = await settingsWindowPromise
    await settingsWindow.waitForLoadState('domcontentloaded')
    await settingsWindow
      .getByRole('button', { name: 'Appearance', exact: true })
      .click()
    await use(settingsWindow)
  },
})

opacityTest(
  'preserves the legacy Entire opacity when Section settings are first introduced',
  async ({ appWindow, settingsWindow, electronApp, isolatedHome }) => {
    // Arrange — the saved file has only the legacy blur radius, with no new fields.
    const mainWindow = await electronApp.browserWindow(appWindow)

    // Act — the Appearance window reads the migrated settings through preload IPC.
    const entireSlider = settingsWindow.getByRole('slider', {
      name: 'Opacity / Blur',
    })

    // Assert — existing users keep their selected opacity and the Entire mode.
    await expect(
      settingsWindow.getByRole('radio', { name: 'Entire' }),
    ).toBeChecked()
    await expect(entireSlider).toBeVisible()
    await expect(entireSlider).toHaveValue('24')
    await expect(entireSlider).toHaveAttribute('aria-valuetext', '72% / 24px')
    await expect(
      settingsWindow.getByRole('slider', { name: 'Left opacity' }),
    ).toBeHidden()
    await expect(appWindow.locator('[data-window-section="left"]')).toHaveCSS(
      'opacity',
      '1',
    )
    // Electron implements whole-window opacity on macOS and Windows only.
    if (process.platform !== 'linux') {
      await expect
        .poll(async () => mainWindow.evaluate((window) => window.getOpacity()))
        .toBeCloseTo(0.72, 2)
    }
    expect(readSettingsFile(isolatedHome)).toEqual({
      windowBackgroundBlurRadius: 24,
    })
  },
)

opacityTest(
  'saves independent section opacity and restores each mode without losing its values',
  async ({ appWindow, settingsWindow, electronApp, isolatedHome }) => {
    // Arrange — open the real Settings window with a saved Entire radius of 24.
    const mainWindow = await electronApp.browserWindow(appWindow)
    const leftSlider = settingsWindow.getByRole('slider', {
      name: 'Left opacity',
    })
    const centerSlider = settingsWindow.getByRole('slider', {
      name: 'Center opacity',
    })
    const rightSlider = settingsWindow.getByRole('slider', {
      name: 'Right opacity',
    })

    // Act — fill the native ranges, with one arrow step preserving keyboard coverage.
    await settingsWindow.getByRole('radio', { name: 'Section' }).click()
    await changeSectionOpacity(leftSlider, 64)
    await leftSlider.press('ArrowRight')
    await expect(leftSlider).toHaveValue('65')
    await changeSectionOpacity(centerSlider, 80)
    await changeSectionOpacity(rightSlider, 95)

    // Assert — all three persisted values reach the main window independently.
    await expect
      .poll(() => readSettingsFile(isolatedHome))
      .toMatchObject({
        windowOpacityMode: 'section',
        windowBackgroundBlurRadius: 24,
        leftSectionOpacityPercent: 65,
        centerSectionOpacityPercent: 80,
        rightSectionOpacityPercent: 95,
      })
    await expect(appWindow.locator('[data-window-section="left"]')).toHaveCSS(
      'opacity',
      '0.65',
    )
    await expect(appWindow.locator('[data-window-section="center"]')).toHaveCSS(
      'opacity',
      '0.8',
    )
    await expect(appWindow.locator('[data-window-section="right"]')).toHaveCSS(
      'opacity',
      '0.95',
    )
    await expect(appWindow.locator('[data-opacity-mode="section"]')).toHaveCSS(
      'background-color',
      'rgba(0, 0, 0, 0)',
    )
    // Electron reports RGB only here; capturePage below verifies the rendered alpha.
    await expect
      .poll(async () =>
        mainWindow.evaluate((window) => ({
          opacity: window.getOpacity(),
          background: window.getBackgroundColor(),
        })),
      )
      .toEqual({ opacity: 1, background: '#000000' })
    // The separate Settings window stays fully readable while main sections fade.
    const preferencesWindow = await electronApp.browserWindow(settingsWindow)
    expect(
      await preferencesWindow.evaluate((window) => window.getOpacity()),
    ).toBe(1)

    // Act — reset only Right, then switch to the saved Entire mode and back.
    await settingsWindow
      .getByRole('button', { name: 'Reset to default: Right opacity' })
      .click()
    await expect
      .poll(() => readSettingsFile(isolatedHome))
      .toMatchObject({
        leftSectionOpacityPercent: 65,
        centerSectionOpacityPercent: 80,
        rightSectionOpacityPercent: 100,
      })
    await expect(appWindow.locator('[data-window-section="right"]')).toHaveCSS(
      'opacity',
      '1',
    )
    await settingsWindow.getByRole('radio', { name: 'Entire' }).click()
    await expect(
      settingsWindow.getByRole('slider', { name: 'Opacity / Blur' }),
    ).toHaveValue('24')
    await expect(appWindow.locator('[data-window-section="left"]')).toHaveCSS(
      'opacity',
      '1',
    )
    await expect(appWindow.locator('[data-window-section="center"]')).toHaveCSS(
      'opacity',
      '1',
    )
    if (process.platform !== 'linux') {
      await expect
        .poll(async () => mainWindow.evaluate((window) => window.getOpacity()))
        .toBeCloseTo(0.72, 2)
    }
    await settingsWindow.getByRole('radio', { name: 'Section' }).click()

    // Assert — each mode retains its own values after the complete round trip.
    await expect(leftSlider).toHaveValue('65')
    await expect(centerSlider).toHaveValue('80')
    await expect(rightSlider).toHaveValue('100')
    await expect(rightSlider).toBeVisible()
    await expect(
      settingsWindow.getByRole('button', {
        name: 'Reset to default: Right opacity',
      }),
    ).toBeDisabled()
    await expect
      .poll(() => readSettingsFile(isolatedHome))
      .toMatchObject({
        windowOpacityMode: 'section',
        windowBackgroundBlurRadius: 24,
        leftSectionOpacityPercent: 65,
        centerSectionOpacityPercent: 80,
        rightSectionOpacityPercent: 100,
      })
    await expect(appWindow.locator('[data-window-section="left"]')).toHaveCSS(
      'opacity',
      '0.65',
    )
    await expect(appWindow.locator('[data-window-section="center"]')).toHaveCSS(
      'opacity',
      '0.8',
    )
  },
)

opacityTest.describe('saved Section mode', () => {
  opacityTest.use({
    initialSettings: {
      windowOpacityMode: 'section',
      windowBackgroundBlurRadius: 0,
      leftSectionOpacityPercent: 45,
      centerSectionOpacityPercent: 70,
      rightSectionOpacityPercent: 100,
    },
  })

  opacityTest(
    'launches with transparent section surfaces even when the saved Entire setting is opaque',
    async ({ appWindow, settingsWindow, electronApp, isolatedHome }) => {
      // Arrange — Section mode was saved before launch with an opaque legacy radius.
      const mainWindow = await electronApp.browserWindow(appWindow)

      // Act — let both native window creation and Settings hydration consume the file.
      await expect(
        settingsWindow.getByRole('radio', { name: 'Section' }),
      ).toBeChecked()

      // Assert — an opaque native backplate must not hide per-section transparency.
      await expect
        .poll(async () =>
          mainWindow.evaluate((window) => ({
            opacity: window.getOpacity(),
            background: window.getBackgroundColor(),
          })),
        )
        .toEqual({ opacity: 1, background: '#000000' })
      await expect(appWindow.locator('[data-window-section="left"]')).toHaveCSS(
        'opacity',
        '0.45',
      )
      await expect(
        appWindow.locator('[data-window-section="center"]'),
      ).toHaveCSS('opacity', '0.7')
      await expect(
        appWindow.locator('[data-window-section="right"]'),
      ).toHaveCSS('opacity', '1')
      await expect(
        settingsWindow.getByRole('slider', { name: 'Left opacity' }),
      ).toHaveValue('45')
      await expect(
        settingsWindow.getByRole('slider', { name: 'Right opacity' }),
      ).toBeVisible()
      // Capture an interior pixel so rounded window corners cannot fake transparency.
      const leftSectionCenter = await appWindow
        .locator('[data-window-section="left"]')
        .evaluate((element) => {
          const bounds = element.getBoundingClientRect()
          return {
            x: Math.floor(bounds.x + bounds.width / 2),
            y: Math.floor(bounds.y + bounds.height / 2),
          }
        })
      const pixelAlpha = await mainWindow.evaluate(async (window, position) => {
        const capture = await window.capturePage(
          { ...position, width: 1, height: 1 },
          { stayHidden: true },
        )
        return capture.toBitmap()[3]
      }, leftSectionCenter)
      expect(pixelAlpha).toBeGreaterThan(0)
      expect(pixelAlpha).toBeLessThan(255)
      expect(readSettingsFile(isolatedHome)).toEqual({
        windowOpacityMode: 'section',
        windowBackgroundBlurRadius: 0,
        leftSectionOpacityPercent: 45,
        centerSectionOpacityPercent: 70,
        rightSectionOpacityPercent: 100,
      })
    },
  )
})

/**
 * Set a native Section range when opacity E2Es exercise its change and persistence flow.
 * @param slider - Native Section range input from the real Settings window.
 * @param percent - Requested integer percentage between 45 and 100.
 * @returns Resolves after the visible control reaches the requested percentage.
 * @example
 * await changeSectionOpacity(leftSlider, 65) // Left slider displays 65%.
 */
async function changeSectionOpacity(
  slider: Locator,
  percent: number,
): Promise<void> {
  await expect(slider).toBeVisible()
  await slider.fill(String(percent))
  await expect(slider).toHaveValue(String(percent))
}
