import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Page } from '@playwright/test'

import { test, expect } from '../fixtures/electron-app'
import { readSettingsFile, writeSettingsFile } from '../helpers/settings-file'

const SEARCH_COUNT_SKILLS = [
  { name: 'alpha-count-e2e', source: 'laststance/skills' },
  { name: 'beta-count-e2e', source: 'laststance/skills' },
  { name: 'gamma-count-e2e', source: 'pbakaus/impeccable' },
]

type SearchCountDisplaySetting = 'tab' | 'inline'
type IsolatedHomeUse = (home: string) => Promise<void>

/**
 * Write one source skill folder that the real scanner will count after app launch.
 * @param home - Isolated E2E HOME used by the Electron fixture.
 * @param skillName - Folder name and SKILL.md title for the staged skill.
 * @returns void after the source skill exists on disk.
 * @example
 * stageSourceSkill('/tmp/home', 'alpha-count-e2e')
 */
function stageSourceSkill(home: string, skillName: string): void {
  const sourcePath = join(home, '.agents', 'skills', skillName)
  mkdirSync(sourcePath, { recursive: true })
  writeFileSync(
    join(sourcePath, 'SKILL.md'),
    `---\nname: ${skillName}\ndescription: ${skillName} description\n---\n# ${skillName}\n`,
    'utf8',
  )
}

/**
 * Write the skills CLI lockfile so the real scanner exposes deterministic repo facets.
 * @param home - Isolated E2E HOME used by the Electron fixture.
 * @returns void after `.skill-lock.json` maps each staged skill to its repo.
 * @example
 * stageSkillLock('/tmp/home')
 */
function stageSkillLock(home: string): void {
  const lockPath = join(home, '.agents', '.skill-lock.json')
  const skills = Object.fromEntries(
    SEARCH_COUNT_SKILLS.map((skill) => [
      skill.name,
      {
        source: skill.source,
        sourceType: 'github',
        sourceUrl: `https://github.com/${skill.source}.git`,
      },
    ]),
  )

  writeFileSync(lockPath, JSON.stringify({ skills }, null, 2), 'utf8')
}

/**
 * Stage the complete Installed-count HOME before Electron starts scanning.
 * @param home - Isolated E2E HOME used by the Electron fixture.
 * @returns void after source skills and repo metadata are on disk.
 * @example
 * stageInstalledCountHome('/tmp/home')
 */
function stageInstalledCountHome(home: string): void {
  mkdirSync(join(home, '.agents', 'skills'), { recursive: true })
  for (const skill of SEARCH_COUNT_SKILLS) {
    stageSourceSkill(home, skill.name)
  }
  stageSkillLock(home)
}

/**
 * Provide an isolated HOME with only the three Installed-count skills staged.
 * @param use - Playwright fixture continuation that launches Electron after setup.
 * @param display - Optional persisted count placement to write before launch.
 * @returns Promise that resolves after the fixture HOME is cleaned up.
 * @example
 * await useInstalledCountHome(use, 'inline')
 */
async function useInstalledCountHome(
  use: IsolatedHomeUse,
  display?: SearchCountDisplaySetting,
): Promise<void> {
  const home = realpathSync.native(
    mkdtempSync(join(tmpdir(), 'skills-desktop-e2e-search-count-')),
  )
  try {
    stageInstalledCountHome(home)
    if (display) {
      writeSettingsFile(home, { installedSearchCountDisplay: display })
    }
    await use(home)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

/**
 * Dispatch Installed search and repo filters in one renderer transaction.
 * @param page - Electron renderer page under test.
 * @param filters - Search query and selected repository ids to apply.
 * @returns Promise that resolves once Redux has the requested filter state.
 * @example
 * await applyInstalledFilters(appWindow, { query: 'missing', sources: [] })
 */
async function applyInstalledFilters(
  page: Page,
  filters: { query: string; sources: string[] },
): Promise<void> {
  await page.evaluate(({ query, sources }) => {
    const store = window.__store__ ?? window.__store
    if (!store) throw new Error('window.__store__ is not exposed')
    store.dispatch({
      type: 'ui/setSearchQuery',
      payload: query,
    })
    store.dispatch({
      type: 'ui/setSelectedSources',
      payload: sources,
    })
  }, filters)
}

const installedCountTest = test.extend<{ isolatedHome: string }>({
  // eslint-disable-next-line no-empty-pattern
  isolatedHome: async ({}, use) => {
    await useInstalledCountHome(use)
  },
})

const inlineInstalledCountTest = test.extend<{ isolatedHome: string }>({
  // eslint-disable-next-line no-empty-pattern
  isolatedHome: async ({}, use) => {
    await useInstalledCountHome(use, 'inline')
  },
})

installedCountTest(
  'Installed tab badge tracks the current visible count and Marketplace stays count-free',
  async ({ appWindow }) => {
    // Arrange / Assert
    await expect(
      appWindow.getByRole('tab', {
        name: /^Installed, 3 skills visible$/,
      }),
    ).toBeVisible()
    await expect(
      appWindow.getByRole('tab', { name: /^Marketplace$/ }),
    ).toBeVisible()

    // Act
    await applyInstalledFilters(appWindow, {
      query: 'alpha-count',
      sources: [],
    })

    // Assert
    await expect(
      appWindow.getByRole('tab', {
        name: /^Installed, 1 skill visible$/,
      }),
    ).toBeVisible()

    // Act
    await applyInstalledFilters(appWindow, {
      query: '',
      sources: ['pbakaus/impeccable'],
    })

    // Assert
    await expect(
      appWindow.getByRole('tab', {
        name: /^Installed, 1 skill visible$/,
      }),
    ).toBeVisible()

    // Act
    await applyInstalledFilters(appWindow, {
      query: 'missing-count-e2e',
      sources: [],
    })

    // Assert
    await expect(
      appWindow.getByRole('tab', {
        name: /^Installed, 0 skills visible$/,
      }),
    ).toBeVisible()
    await expect(
      appWindow.getByRole('tab', { name: /^Marketplace$/ }),
    ).toBeVisible()
  },
)

inlineInstalledCountTest(
  'persisted inline mode moves the count into the toolbar and removes the tab badge',
  async ({ appWindow, isolatedHome }) => {
    // Arrange / Assert
    await appWindow.waitForFunction(() => {
      const store = window.__store__ ?? window.__store
      if (!store) return false
      const state = store.getState() as {
        settings?: { installedSearchCountDisplay?: string }
      }
      return state.settings?.installedSearchCountDisplay === 'inline'
    })
    await expect(
      appWindow.getByRole('tab', { name: /^Installed$/ }),
    ).toBeVisible()
    await expect(
      appWindow.getByRole('tab', {
        name: /^Installed, 3 skills visible$/,
      }),
    ).toHaveCount(0)
    await expect(
      appWindow
        .locator('[aria-live="polite"]')
        .filter({ hasText: /^3 skills$/ }),
    ).toBeVisible()

    const persisted = readSettingsFile(isolatedHome) as {
      installedSearchCountDisplay?: string
    } | null
    expect(persisted?.installedSearchCountDisplay).toBe('inline')
  },
)
