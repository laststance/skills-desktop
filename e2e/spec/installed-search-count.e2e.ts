import type { Page } from '@playwright/test'

import { repositoryId, type AbsolutePath, type Skill } from '@/shared/types'

import { test, expect } from '../fixtures/electron-app'
import { readSettingsFile } from '../helpers/settings-file'

const SEARCH_COUNT_SKILLS = [
  makeSourceSkill('alpha-count-e2e', 'laststance/skills'),
  makeSourceSkill('beta-count-e2e', 'laststance/skills'),
  makeSourceSkill('gamma-count-e2e', 'pbakaus/impeccable'),
]

/**
 * Create a minimal source skill row for the Installed count E2E fixture.
 * @param name - Display name that the Installed search field matches.
 * @param source - Repository id used by the repo include filter.
 * @returns Serializable skill object accepted by the renderer Redux slice.
 * @example
 * makeSourceSkill('alpha-count-e2e', 'laststance/skills')
 */
function makeSourceSkill(name: string, source: string): Skill {
  return {
    name,
    description: `${name} description`,
    path: `/tmp/skills-desktop-e2e/${name}` as AbsolutePath,
    filesystemIdentity: {
      kind: 'directory',
      dev: 101,
      ino: name.length,
      size: 96,
      ctimeMs: 1,
      mtimeMs: 2,
    },
    symlinkCount: 0,
    symlinks: [],
    isSource: true,
    isOrphan: false,
    source: repositoryId(source),
    sourceUrl: `https://github.com/${source}.git`,
  }
}

/**
 * Wait for the E2E Redux bridge before dispatching synthetic scan data.
 * @param page - Electron renderer page under test.
 * @returns Promise that resolves once `window.__store__` is available.
 * @example
 * await waitForExposedStore(appWindow)
 */
async function waitForExposedStore(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean(window.__store__ ?? window.__store))
}

/**
 * Replace scanner output with a fixed Installed inventory and reset filters.
 * @param page - Electron renderer page under test.
 * @returns Promise that resolves once Redux has the deterministic fixture.
 * @example
 * await seedInstalledCountFixture(appWindow)
 */
async function seedInstalledCountFixture(page: Page): Promise<void> {
  await waitForExposedStore(page)
  await page.evaluate((skills) => {
    const store = window.__store__ ?? window.__store
    if (!store) throw new Error('window.__store__ is not exposed')

    store.dispatch({
      type: 'ui/setActiveTab',
      payload: 'installed',
    })
    store.dispatch({
      type: 'ui/selectAgent',
      payload: null,
    })
    store.dispatch({
      type: 'ui/setSkillTypeFilter',
      payload: 'all',
    })
    store.dispatch({
      type: 'ui/clearExcludedSkillTypeFilters',
    })
    store.dispatch({
      type: 'ui/setSearchScope',
      payload: 'name',
    })
    store.dispatch({
      type: 'ui/setSearchQuery',
      payload: '',
    })
    store.dispatch({
      type: 'ui/setSelectedSources',
      payload: [],
    })
    store.dispatch({
      type: 'skills/fetchAll/fulfilled',
      payload: skills,
      meta: {
        requestId: 'e2e-installed-search-count',
        requestStatus: 'fulfilled',
      },
    })
  }, SEARCH_COUNT_SKILLS)
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

test('Installed tab badge tracks the current visible count and Marketplace stays count-free', async ({
  appWindow,
}) => {
  // Arrange
  await seedInstalledCountFixture(appWindow)

  // Assert
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
})

test('persisted inline mode moves the count into the toolbar and removes the tab badge', async ({
  appWindow,
  isolatedHome,
}) => {
  // Arrange
  await seedInstalledCountFixture(appWindow)

  // Act
  await appWindow.evaluate(async () => {
    await window.electron.settings.set({
      installedSearchCountDisplay: 'inline',
    })
  })

  // Assert
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
  await expect(appWindow.getByText(/^3 skills$/)).toBeVisible()

  const persisted = readSettingsFile(isolatedHome) as {
    installedSearchCountDisplay?: string
  } | null
  expect(persisted?.installedSearchCountDisplay).toBe('inline')
})
