import {
  mkdirSync,
  lstatSync,
  realpathSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

import type { Page } from '@playwright/test'

import { test, expect, launchIsolatedElectron } from '../fixtures/electron-app'
import { dispatchAction } from '../helpers/redux'

const MARKETPLACE_SKILL = {
  rank: 1,
  name: 'find-skills',
  repo: 'vercel-labs/skills',
  url: 'https://skills.sh/vercel-labs/skills/find-skills',
  installCount: 1,
}

/**
 * Wait until the renderer store has scanned the staged Claude Code agent dir.
 *
 * @param appWindow - Main Electron renderer window
 * @returns Promise that resolves when Claude Code is installable in the modal
 * @example
 * await waitForClaudeCodeAgent(appWindow)
 */
async function waitForClaudeCodeAgent(appWindow: Page): Promise<void> {
  await appWindow.waitForFunction(() => {
    const store = window.__store__
    const state = store?.getState() as
      | { agents?: { items?: Array<{ id: string; exists: boolean }> } }
      | undefined
    return state?.agents?.items?.some(
      (agent) => agent.id === 'claude-code' && agent.exists,
    )
  })
}

/** Provide a catalogue result while exercising the real install dialog, IPC and child process.
 * @example await showMarketplaceResult(page, MARKETPLACE_SKILL)
 */
async function showMarketplaceResult(
  page: Page,
  skill: typeof MARKETPLACE_SKILL,
): Promise<void> {
  const meta = { arg: skill.name, requestId: `install-${skill.name}` }
  await dispatchAction(page, {
    type: 'marketplace/search/pending',
    meta: { ...meta, requestStatus: 'pending' },
  })
  await dispatchAction(page, {
    type: 'marketplace/search/fulfilled',
    payload: [skill],
    meta: { ...meta, requestStatus: 'fulfilled' },
  })
}

test('Marketplace installs into the shared folder and links only the chosen agents', async ({
  isolatedHome,
}) => {
  test.setTimeout(60_000)
  // Arrange. The catalogue points at a local skill collection so its contents stay deterministic.
  const collection = join(isolatedHome, 'collection')
  const claudeConfig = join(isolatedHome, 'configured-claude')
  const claude = join(claudeConfig, 'skills')
  const goose = join(isolatedHome, '.config', 'goose', 'skills')
  const shared = join(isolatedHome, '.agents', 'skills')
  for (const name of ['qa-shared', 'qa-linked']) {
    const folder = join(collection, 'skills', name)
    mkdirSync(folder, { recursive: true })
    writeFileSync(
      join(folder, 'SKILL.md'),
      `---\nname: ${name}\ndescription: An install fixture.\n---\n`,
    )
  }
  for (const dir of [claude, goose, shared]) mkdirSync(dir, { recursive: true })
  const stateDir = join(isolatedHome, 'qa-state')
  const app = await launchIsolatedElectron(isolatedHome, {
    XDG_STATE_HOME: stateDir,
    CLAUDE_CONFIG_DIR: claudeConfig,
  })
  try {
    const page = await app.firstWindow()
    await waitForClaudeCodeAgent(page)
    await page.getByRole('tab', { name: 'Marketplace' }).click()
    for (const name of ['qa-linked', 'qa-shared']) {
      // Act through the same Marketplace control a user presses.
      await showMarketplaceResult(page, {
        ...MARKETPLACE_SKILL,
        name,
        repo: collection,
      })
      await page
        .getByRole('button', { name: 'Install', exact: true })
        .first()
        .click()
      const dialog = page.getByRole('dialog', { name: 'Install Skill' })
      if (name === 'qa-shared')
        await dialog.getByRole('radio', { name: 'Universal only' }).click()
      await dialog.getByRole('button', { name: 'Install', exact: true }).click()
      // A local-collection install is recorded with sourceType 'local', which
      // the scanner skips when it builds the source map — so `source` stays
      // unset and the row lands on the "Installed source unknown" state
      // instead of the Installed badge. That hint only renders once the
      // rescan registers the occupied name.
      await expect(page.getByText('Installed source unknown')).toBeVisible({
        timeout: 50_000,
      })
    }

    // Assert that the installed view reads the same configured directory the manager wrote.
    await page
      .getByRole('button', { name: /Filter skills by Claude Code/ })
      .click()
    await expect(page.locator('[data-skill-name="qa-linked"]')).toBeVisible()
    await expect(page.locator('[data-skill-name="qa-shared"]')).toHaveCount(0)
    // Check physical folders, exact link target, untouched agent and the lock file.
    expect(
      readFileSync(join(shared, 'qa-linked', 'SKILL.md'), 'utf8'),
    ).toContain('name: qa-linked')
    expect(
      readFileSync(join(shared, 'qa-shared', 'SKILL.md'), 'utf8'),
    ).toContain('name: qa-shared')
    expect(lstatSync(join(claude, 'qa-linked')).isSymbolicLink()).toBe(true)
    expect(realpathSync(join(claude, 'qa-linked'))).toBe(
      realpathSync(join(shared, 'qa-linked')),
    )
    expect(
      lstatSync(join(isolatedHome, '.claude', 'skills', 'qa-linked'), {
        throwIfNoEntry: false,
      }),
    ).toBeUndefined()
    expect(
      lstatSync(join(claude, 'qa-shared'), { throwIfNoEntry: false }),
    ).toBeUndefined()
    expect(
      lstatSync(join(goose, 'qa-linked'), { throwIfNoEntry: false }),
    ).toBeUndefined()
    expect(
      lstatSync(join(goose, 'qa-shared'), { throwIfNoEntry: false }),
    ).toBeUndefined()
    expect(
      Object.keys(
        JSON.parse(
          readFileSync(join(stateDir, 'skills', '.skill-lock.json'), 'utf8'),
        ).skills,
      ).sort(),
    ).toEqual(['qa-linked', 'qa-shared'])
  } finally {
    await app.close()
  }
})
