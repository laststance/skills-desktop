import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { RENDERER_PREFERENCES_STORAGE_KEY } from '@/shared/constants'

import { test, expect, launchIsolatedElectron } from '../fixtures/electron-app'
import { waitForInitialScan } from '../helpers/redux'

/**
 * Markdown Code/Reading preview-mode persistence across a REAL process
 * restart — the one surface unit tests cannot reach: Chromium localStorage
 * must flush to userData on a clean shutdown and hydrate the next launch.
 *
 * Why manual launches instead of the `electronApp` fixture: the fixture
 * launches ONE app per test and closes it in teardown. A restart test needs
 * two sequential processes sharing the same `E2E_USERDATA_DIR`, so it
 * requests only `isolatedHome` and launches both apps itself through the
 * same `launchIsolatedElectron` env contract.
 */

const SKILL_NAME = 'restart-preview'

/**
 * Stage a skill holding one Markdown file under `~/.agents/skills` so the
 * initial scan surfaces it in the Installed list.
 * @param isolatedHome - E2E fixture HOME.
 * @example stageMarkdownSkill(home)
 */
function stageMarkdownSkill(isolatedHome: string): void {
  const skillDir = join(isolatedHome, '.agents', 'skills', SKILL_NAME)
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    `# ${SKILL_NAME}\n\nRestart persistence fixture.\n`,
  )
}

test('keeps Reading Mode selected across a real Electron process restart', async ({
  isolatedHome,
}) => {
  // Arrange — stage BEFORE any launch so both scans see the same skill.
  stageMarkdownSkill(isolatedHome)

  // Launch 1 — open the skill's SKILL.md preview and toggle Reading Mode.
  const firstApp = await launchIsolatedElectron(isolatedHome)
  try {
    const firstWindow = await firstApp.firstWindow()
    await firstWindow.waitForLoadState('domcontentloaded')
    await waitForInitialScan(firstWindow)
    const currentVersion = await firstApp.evaluate(({ app }) =>
      app.getVersion(),
    )
    // Settle the main window's first-install acknowledgement before testing two independent edits.
    await expect
      .poll(async () =>
        firstWindow.evaluate(
          (key) =>
            JSON.parse(window.localStorage.getItem(key) ?? '{}').state
              ?.rendererPreferences?.lastSeenVersion,
          RENDERER_PREFERENCES_STORAGE_KEY,
        ),
      )
      .toBe(currentVersion)
    // Start the second renderer before the mode changes, giving it an older store snapshot.
    const settingsPromise = firstApp.waitForEvent('window')
    await firstWindow.getByRole('button', { name: 'Open settings' }).click()
    const settingsWindow = await settingsPromise
    await settingsWindow.waitForLoadState('domcontentloaded')
    await settingsWindow
      .getByRole('button', { name: 'Appearance', exact: true })
      .waitFor()
    await firstWindow
      .locator(`[data-skill-name="${SKILL_NAME}"]`)
      .first()
      .click()
    const readingToggle = firstWindow.getByRole('radio', {
      name: /Show rendered Markdown/i,
    })
    await expect(readingToggle).toBeVisible()

    // Hold the real cross-process lock until both renderers have queued different field edits.
    await firstWindow.evaluate(async (key) => {
      await new Promise<void>((acquired) => {
        void navigator.locks.request(key, async () => {
          acquired()
          await new Promise<void>((release) => {
            window.addEventListener(
              'e2e-release-preference-lock',
              () => release(),
              { once: true },
            )
          })
        })
      })
    }, RENDERER_PREFERENCES_STORAGE_KEY)
    await readingToggle.click()
    await settingsWindow.evaluate(() => {
      window.__store__?.dispatch({
        type: 'rendererPreferences/markReleaseNotesSeen',
        payload: '0.32.0',
      })
    })
    // The two middleware timers must expire while their writes remain blocked on the held lock.
    await firstWindow.waitForTimeout(400)
    await firstWindow.evaluate(() =>
      window.dispatchEvent(new Event('e2e-release-preference-lock')),
    )
    await expect(readingToggle).toHaveAttribute('aria-checked', 'true')
    // Guard the restart assertion: if the write never reached localStorage,
    // a relaunched default would look identical to a persistence failure.
    await expect
      .poll(async () =>
        firstWindow.evaluate(
          (key) =>
            JSON.parse(window.localStorage.getItem(key) ?? '{}').state
              ?.rendererPreferences?.markdownPreviewMode,
          RENDERER_PREFERENCES_STORAGE_KEY,
        ),
      )
      .toBe('reading')
    await expect
      .poll(async () =>
        firstWindow.evaluate(
          (key) =>
            JSON.parse(window.localStorage.getItem(key) ?? '{}').state
              ?.rendererPreferences?.lastSeenVersion,
          RENDERER_PREFERENCES_STORAGE_KEY,
        ),
      )
      .toBe('0.32.0')

    // A real settings update exercises the stale renderer's middleware without editing preferences.
    await settingsWindow.evaluate(async () =>
      window.electron.settings.set({ codeFontSizePx: 15 }),
    )
    // Cover the middleware's 300ms debounce window before checking for an accidental overwrite.
    await settingsWindow.waitForTimeout(400)
    await expect(readingToggle).toHaveAttribute('aria-checked', 'true')

    // Write from the other process so Chromium, rather than a synthetic event, delivers the notification.
    await settingsWindow.evaluate((key) => {
      const envelope = JSON.parse(window.localStorage.getItem(key) ?? '{}')
      envelope.state.rendererPreferences.markdownPreviewMode = 'code'
      window.localStorage.setItem(key, JSON.stringify(envelope))
    }, RENDERER_PREFERENCES_STORAGE_KEY)
    await expect(
      firstWindow.getByRole('radio', { name: /Show Markdown source/i }),
    ).toHaveAttribute('aria-checked', 'true')

    // Leave Reading as the durable choice for the process-restart assertion below.
    await readingToggle.click()
    await expect
      .poll(async () =>
        firstWindow.evaluate(
          (key) =>
            JSON.parse(window.localStorage.getItem(key) ?? '{}').state
              ?.rendererPreferences?.markdownPreviewMode,
          RENDERER_PREFERENCES_STORAGE_KEY,
        ),
      )
      .toBe('reading')
  } finally {
    // Clean shutdown — Chromium flushes localStorage to userData here.
    await firstApp.close()
  }

  // Act — launch a SECOND process against the same HOME + userData dir.
  const secondApp = await launchIsolatedElectron(isolatedHome)
  try {
    const secondWindow = await secondApp.firstWindow()
    await secondWindow.waitForLoadState('domcontentloaded')
    await waitForInitialScan(secondWindow)
    await secondWindow
      .locator(`[data-skill-name="${SKILL_NAME}"]`)
      .first()
      .click()

    // Assert — the relaunched process hydrates the persisted mode: the
    // preview opens in Reading Mode without any toggle interaction.
    const restoredToggle = secondWindow.getByRole('radio', {
      name: /Show rendered Markdown/i,
    })
    await expect(restoredToggle).toHaveAttribute('aria-checked', 'true')
    await expect(
      secondWindow.locator('[data-markdown-reading-scroll]'),
    ).toBeVisible()
  } finally {
    await secondApp.close()
  }
})
