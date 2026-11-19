import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Page } from '@playwright/test'

import { test, expect } from '../fixtures/electron-app'
import { dispatchAction } from '../helpers/redux'

/**
 * The Settings window is a second BrowserWindow with its own renderer process
 * and its own store, so it reads the persisted theme once at boot. Before the
 * `theme:changed` broadcast existed, switching the main window Dark -> Light
 * left it stranded in the old palette until it was closed and reopened: two
 * windows of one app, visibly disagreeing.
 *
 * Only an Electron E2E can cover this — the two stores live in separate
 * processes, so a single-renderer test can never observe the crossing.
 */
const themeSyncTest = test.extend<{ settingsWindow: Page }>({
  // eslint-disable-next-line no-empty-pattern
  isolatedHome: async ({}, use) => {
    const isolatedHome = realpathSync.native(
      mkdtempSync(join(tmpdir(), 'skills-desktop-e2e-theme-sync-')),
    )
    try {
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
    // A broadcast is a one-shot event: publishing before this window has
    // subscribed would be missed and the test would fail for the wrong
    // reason. The subscription is installed when `store.ts` evaluates, which
    // is a prerequisite of React rendering anything, so waiting for real
    // Settings content is a sufficient signal.
    await settingsWindow
      .getByRole('button', { name: 'Appearance', exact: true })
      .waitFor()
    await use(settingsWindow)
  },
})

themeSyncTest(
  'repaints an open Settings window when the main window switches to Light',
  async ({ appWindow, settingsWindow }) => {
    // Arrange — both windows start on the default neutral-dark palette.
    await expect(settingsWindow.locator('html')).toHaveClass(/dark/)

    // Act — switch the main window to Light through the real dropdown.
    await appWindow
      .getByRole('button', { name: 'Theme and color options' })
      .click()
    await appWindow.getByRole('radio', { name: 'Light mode' }).click()

    // Assert — the already-open Settings window follows, no reopen required.
    await expect(settingsWindow.locator('html')).toHaveClass(/light/)
    await expect(settingsWindow.locator('html')).not.toHaveClass(/dark/)
    await expect(appWindow.locator('html')).toHaveClass(/light/)
  },
)

themeSyncTest(
  'keeps the saved bookmark and deleted category when Settings receives a later theme change',
  async ({ appWindow, settingsWindow }) => {
    // Arrange — observe which renderer writes while preserving real storage and timer behavior.
    const settingsWrites = await settingsWindow.evaluateHandle(() => {
      const written: string[] = []
      const write = Storage.prototype.setItem
      Storage.prototype.setItem = function (key, value) {
        if (key === 'skills-desktop-state') written.push(key)
        write.call(this, key, value)
      }
      return written
    })
    await dispatchAction(appWindow, {
      type: 'bookmarks/addBookmark',
      payload: {
        name: 'audit',
        repo: 'owner/tools',
        url: 'https://github.com/owner/tools',
        categoryId: 'security',
      },
    })
    await dispatchAction(appWindow, {
      type: 'bookmarks/deleteBookmarkCategory',
      payload: 'security',
    })
    const persisted = () =>
      appWindow.evaluate(
        () =>
          JSON.parse(localStorage.getItem('skills-desktop-state') ?? '{}')
            .state,
      )
    await expect
      .poll(async () => (await persisted())?.bookmarks.items[0]?.name)
      .toBe('audit')

    // Act — both renderers receive the theme change while only the main window has the new collection.
    await appWindow
      .getByRole('button', { name: 'Theme and color options' })
      .click()
    await appWindow.getByRole('radio', { name: 'Light mode' }).click()
    await expect(settingsWindow.locator('html')).toHaveClass(/light/)
    // Wait behind the storage middleware's 300ms debounce in this exact renderer.
    await settingsWindow.evaluate(
      () => new Promise<void>((resolve) => window.setTimeout(resolve, 600)),
    )
    expect(await settingsWrites.jsonValue()).toEqual([])
    await expect.poll(async () => (await persisted())?.theme.mode).toBe('light')
    await appWindow.reload()

    // Assert — a fresh primary store still has the saved source and the starter stays deleted.
    await expect(
      appWindow.getByRole('button', { name: 'View details for audit' }),
    ).toBeVisible()
    const saved = await persisted()
    expect(saved.bookmarks.items[0]).toMatchObject({
      name: 'audit',
      url: 'https://github.com/owner/tools',
    })
    expect(saved.bookmarks.items[0].categoryId).toBeUndefined()
    expect(
      saved.bookmarks.categories.map((category: { id: string }) => category.id),
    ).not.toContain('security')
  },
)

themeSyncTest(
  'carries an accent preset across to the open Settings window',
  async ({ appWindow, settingsWindow }) => {
    // Arrange — a neutral preset leaves chroma at 0 in both windows.
    await expect(settingsWindow.locator('html')).toHaveCSS(
      '--theme-chroma',
      '0',
    )

    // Act — pick Cyan in the main window.
    await appWindow
      .getByRole('button', { name: 'Theme and color options' })
      .click()
    await appWindow.getByRole('button', { name: 'Select Cyan theme' }).click()

    // Assert — hue and chroma both cross, so the Settings window renders the
    // same accent rather than a half-applied palette.
    await expect(settingsWindow.locator('html')).toHaveCSS('--theme-hue', '195')
    await expect(settingsWindow.locator('html')).toHaveCSS(
      '--theme-chroma',
      '0.16',
    )
  },
)
