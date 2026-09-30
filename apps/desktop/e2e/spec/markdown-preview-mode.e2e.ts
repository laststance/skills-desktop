import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { MARKDOWN_PREVIEW_MODE_KEY } from '@/shared/constants'

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
    await firstWindow
      .locator(`[data-skill-name="${SKILL_NAME}"]`)
      .first()
      .click()
    const readingToggle = firstWindow.getByRole('radio', {
      name: /Show rendered Markdown/i,
    })
    await expect(readingToggle).toBeVisible()
    await readingToggle.click()
    await expect(readingToggle).toHaveAttribute('aria-checked', 'true')
    // Guard the restart assertion: if the write never reached localStorage,
    // a relaunched default would look identical to a persistence failure.
    expect(
      await firstWindow.evaluate(
        (key) => window.localStorage.getItem(key),
        MARKDOWN_PREVIEW_MODE_KEY,
      ),
    ).toBe('reading')
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
