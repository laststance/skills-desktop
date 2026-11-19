import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test, launchIsolatedElectron } from '../fixtures/electron-app'
import { dispatchAction, waitForInitialScan } from '../helpers/redux'

// Extended by /ship. Value: protects=retired swatches display Blue and keep their stored key on four bookmark surfaces;
// fails_when=a row drops the label or fallback hue, or hydration replaces the retired key;
// why_new=existing Chromium tests check swatch resolution and standalone paint only;
// seam=none; no_claim=native compositor contrast (checked separately).
test('a classified bookmark reopens its original source after the skill is uninstalled and Electron restarts', async ({
  isolatedHome,
}) => {
  // Arrange — a fresh collection below the fixture avoids modifying any hardlinked snapshot.
  const home = join(isolatedHome, 'personal-collection')
  const skill = join(home, '.agents', 'skills', 'dependency-audit')
  mkdirSync(skill, { recursive: true })
  writeFileSync(
    join(skill, 'SKILL.md'),
    '---\nname: dependency-audit\ndescription: Check installed package dependencies.\n---\n',
  )
  writeFileSync(
    join(home, '.agents', '.skill-lock.json'),
    JSON.stringify({
      skills: {
        'dependency-audit': {
          source: 'owner/stored-origin',
          sourceType: 'github',
          sourceUrl: 'https://github.com/owner/stored-origin.git',
        },
      },
    }),
  )
  const other = join(home, '.agents', 'skills', 'remaining-skill')
  mkdirSync(other, { recursive: true })
  writeFileSync(
    join(other, 'SKILL.md'),
    '---\nname: remaining-skill\ndescription: A second installed skill.\n---\n',
  )
  const app = await launchIsolatedElectron(home)
  try {
    const page = await app.firstWindow()
    await waitForInitialScan(page)
    // Act — save, classify, and switch to Tree without relying on the name search.
    await page
      .getByRole('button', { name: 'Bookmark dependency-audit', exact: true })
      .click()
    await page.getByRole('menuitem', { name: 'Security', exact: true }).click()
    await expect(
      page.locator('[data-skill-name="dependency-audit"]'),
    ).toHaveAttribute('data-bookmark-category', 'security')
    // The resting bookmark and category buttons both keep the Installed list's shortcuts.
    const cardActions = [
      page.getByRole('button', {
        name: 'Remove bookmark from dependency-audit',
      }),
      page.locator('[data-category-for="dependency-audit"]'),
    ]
    for (const action of cardActions) {
      await action.focus()
      await page.keyboard.press('Meta+a')
      await expect(
        page.getByRole('checkbox', {
          name: 'Deselect dependency-audit',
          exact: true,
        }),
      ).toBeChecked()
      await page.keyboard.press('Escape')
      await expect(
        page.getByRole('checkbox', {
          name: 'Select dependency-audit',
          exact: true,
        }),
      ).not.toBeChecked()
    }
    await page.getByRole('radio', { name: 'Tree', exact: true }).click()
    await expect(
      page.getByRole('treeitem', { name: 'dependency-audit', exact: true }),
    ).toHaveAttribute('data-bookmark-category', 'security')
    // Await a durable write before shutting down the process.
    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            JSON.parse(localStorage.getItem('skills-desktop-state') ?? '{}')
              .state?.bookmarks?.items?.[0]?.categoryId,
        ),
      )
      .toBe('security')

    // Simulate reopening a profile written when this swatch was available.
    await page.evaluate(() => {
      const key = 'skills-desktop-state'
      const saved = JSON.parse(localStorage.getItem(key)!)
      const category = saved.state.bookmarks.categories.find(
        (entry: { id: string }) => entry.id === 'security',
      )
      category.color = 'retired-purple'
      localStorage.setItem(key, JSON.stringify(saved))
    })
    await page.reload()
    await waitForInitialScan(page)
    await page.getByRole('radio', { name: 'List', exact: true }).click()
    const card = page.locator('[data-skill-name="dependency-audit"]')
    const sidebar = page.getByRole('button', {
      name: 'View details for dependency-audit',
    })
    // The bookmarks widget is opt-in on the default dashboard.
    await dispatchAction(page, {
      type: 'dashboard/addWidget',
      payload: { type: 'bookmarks' },
    })
    const widget = page.locator('li[data-bookmark-category="security"]')
    for (const row of [card, sidebar, widget]) {
      await expect(row.getByText('Security', { exact: true })).toBeVisible()
      await expect(row).toHaveCSS('--bookmark-hue', '250')
    }
    await page.getByRole('radio', { name: 'Tree', exact: true }).click()
    const root = page.getByRole('treeitem', {
      name: 'dependency-audit',
      exact: true,
    })
    await expect(root.getByText('Security', { exact: true })).toBeVisible()
    await expect(root).toHaveCSS('--bookmark-hue', '250')
    expect(
      await page.evaluate(
        () =>
          JSON.parse(
            localStorage.getItem('skills-desktop-state')!,
          ).state.bookmarks.categories.find(
            (entry: { id: string }) => entry.id === 'security',
          ).color,
      ),
    ).toBe('retired-purple')
  } finally {
    await app.close()
  }

  // Move only this test's newly created directory outside the scan root.
  renameSync(skill, join(home, 'uninstalled-skill'))
  const restart = await launchIsolatedElectron(home)
  try {
    const page = await restart.firstWindow()
    await waitForInitialScan(page)
    await page
      .getByRole('button', {
        name: 'Bookmarks category filter: All categories',
      })
      .click()
    await page
      .getByRole('menuitemradio', { name: 'Security', exact: true })
      .click()
    await page
      .getByRole('button', { name: 'View details for dependency-audit' })
      .click()
    const dialog = page.getByRole('dialog')
    await expect(
      dialog.getByRole('heading', { name: 'dependency-audit' }),
    ).toBeFocused()
    await page.keyboard.press('Tab')
    const source = dialog.getByRole('link', { name: 'owner/stored-origin' })
    await expect(source).toBeFocused()
    await expect(
      dialog.getByRole('button', { name: 'Install', exact: true }),
    ).toBeVisible()

    // Observe the exact request that arrived in the Electron main process without launching a user's browser.
    await restart.evaluate(({ shell }) => {
      shell.openExternal = async (url: string): Promise<void> => {
        process.env['BOOKMARK_E2E_OPENED_SOURCE'] = url
      }
    })
    await page.keyboard.press('Enter')
    await expect
      .poll(async () =>
        restart.evaluate(() => process.env['BOOKMARK_E2E_OPENED_SOURCE']),
      )
      .toBe('https://github.com/owner/stored-origin')
  } finally {
    await restart.close()
  }
})
