import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { RENDERER_PREFERENCES_STORAGE_KEY } from '@/shared/constants'

import { test, expect, launchIsolatedElectron } from '../fixtures/electron-app'
import { waitForInitialScan } from '../helpers/redux'
import { readSettingsFile, writeSettingsFile } from '../helpers/settings-file'

/** Stages only new files under the isolated HOME, never overwriting hardlinked snapshot fixtures.
 * @example stageTreeSkills(isolatedHome)
 */
function stageTreeSkills(home: string): void {
  const files = {
    'tree-qa-alpha/SKILL.md':
      '---\nname: tree-qa-alpha\ndescription: Tree navigation fixture\n---\n# Alpha\n',
    'tree-qa-alpha/guides/start.md':
      '# Tree QA guide\n\nNested preview works.\n',
    'tree-qa-alpha/scripts/example.ts': 'export const treeAnswer = 42\n',
    'tree-qa-beta/SKILL.md':
      '---\nname: tree-qa-beta\ndescription: Second root\n---\n# Beta\n',
    'tree-qa-beta/docs/tips.md': '# Tree QA tips\n',
  }
  for (const [relativePath, content] of Object.entries(files)) {
    const path = join(home, '.agents', 'skills', relativePath)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
  }
}

test('opens nested files in Tree, preserves navigation through List, and keeps Info as the default', async ({
  isolatedHome,
}) => {
  // Arrange
  stageTreeSkills(isolatedHome)
  writeSettingsFile(isolatedHome, { defaultSkillTab: 'info' })
  const app = await launchIsolatedElectron(isolatedHome)
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await waitForInitialScan(page)
    await page.getByPlaceholder('Search skills...').fill('tree-qa-')
    await expect(
      page.getByRole('radio', { name: 'List', exact: true }),
    ).toHaveAttribute('aria-checked', 'true')
    // Act
    await page.getByRole('radio', { name: 'Tree', exact: true }).click()
    await page
      .getByRole('button', { name: 'Expand tree-qa-alpha', exact: true })
      .click()
    await page.getByRole('treeitem', { name: 'guides', exact: true }).click()
    await page.getByRole('treeitem', { name: 'start.md', exact: true }).click()
    // Assert
    await expect(
      page.getByRole('button', { name: 'Files', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(
      page.getByRole('tab', { name: 'guides/start.md', exact: true }),
    ).toHaveAttribute('aria-selected', 'true')
    await expect(
      page.getByRole('tabpanel', { name: 'guides/start.md', exact: true }),
    ).toContainText('Nested preview works.')
    expect(readSettingsFile(isolatedHome)).toMatchObject({
      defaultSkillTab: 'info',
    })
    await page.getByRole('radio', { name: 'List', exact: true }).click()
    await expect(
      page.getByRole('tabpanel', { name: 'guides/start.md', exact: true }),
    ).toContainText('Nested preview works.')
    await page.getByRole('radio', { name: 'Tree', exact: true }).click()
    await expect(
      page.getByRole('treeitem', { name: 'start.md', exact: true }),
    ).toHaveAttribute('aria-selected', 'true')
    await page.getByRole('button', { name: 'Collapse all skills' }).click()
    await expect(
      page.getByRole('treeitem', { name: 'tree-qa-alpha', exact: true }),
    ).toHaveAttribute('aria-expanded', 'false')
    await page
      .getByRole('treeitem', { name: 'tree-qa-beta', exact: true })
      .click()
    await expect(
      page.getByRole('button', { name: 'Info', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true')
  } finally {
    await app.close()
  }
})

test('restores the Tree preference after a real Electron restart without eagerly opening roots', async ({
  isolatedHome,
}) => {
  // Arrange
  stageTreeSkills(isolatedHome)
  const first = await launchIsolatedElectron(isolatedHome)
  try {
    const page = await first.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await waitForInitialScan(page)
    await page.getByRole('radio', { name: 'Tree', exact: true }).click()
    await expect
      .poll(async () =>
        page.evaluate(
          (key) =>
            JSON.parse(localStorage.getItem(key) ?? '{}').state
              ?.rendererPreferences?.skillsViewMode,
          RENDERER_PREFERENCES_STORAGE_KEY,
        ),
      )
      .toBe('tree')
  } finally {
    await first.close()
  }
  // Act
  const second = await launchIsolatedElectron(isolatedHome)
  try {
    const page = await second.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await waitForInitialScan(page)
    // Assert
    await expect(
      page.getByRole('radio', { name: 'Tree', exact: true }),
    ).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByRole('tree')).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Collapse all skills' }),
    ).toBeDisabled()
  } finally {
    await second.close()
  }
})

test('Tree root deletion reviews and removes only that skill while a nested file is inspected', async ({
  isolatedHome,
}) => {
  // Arrange
  stageTreeSkills(isolatedHome)
  const app = await launchIsolatedElectron(isolatedHome)
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await waitForInitialScan(page)
    await page.getByPlaceholder('Search skills...').fill('tree-qa-')
    await page.getByRole('radio', { name: 'Tree', exact: true }).click()
    await page
      .getByRole('button', { name: 'Expand tree-qa-alpha', exact: true })
      .click()
    await page.getByRole('treeitem', { name: 'guides', exact: true }).click()
    await page.getByRole('treeitem', { name: 'start.md', exact: true }).click()
    // Act
    await page
      .getByRole('button', { name: 'Actions for tree-qa-alpha', exact: true })
      .click()
    await page.getByRole('menuitem', { name: 'Delete…', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Delete 1 skill?', exact: true }),
    ).toBeVisible()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Delete', exact: true })
      .click()
    // Assert
    await expect
      .poll(() =>
        existsSync(join(isolatedHome, '.agents/skills/tree-qa-alpha')),
      )
      .toBe(false)
    expect(
      existsSync(
        join(isolatedHome, '.agents/skills/tree-qa-beta/docs/tips.md'),
      ),
    ).toBe(true)
    await expect(
      page.getByRole('treeitem', { name: 'tree-qa-alpha', exact: true }),
    ).toHaveCount(0)
    await expect(
      page.getByRole('treeitem', { name: 'tree-qa-beta', exact: true }),
    ).toBeVisible()
  } finally {
    await app.close()
  }
})
