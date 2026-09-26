import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

import type { Page } from '@playwright/test'

import { test, expect } from '../fixtures/electron-app'
import { waitForInitialScan } from '../helpers/redux'
import {
  canReadUserTrash,
  cleanupTrashEntries,
  isSameVolumeAsUserTrash,
  USER_TRASH_DIR,
} from '../helpers/user-trash'

/**
 * Stages empty and occupied parents when the real not-installed sidebar flow needs disposable targets.
 * @param isolatedHome - Per-test temporary HOME, separate from the user's working folders.
 * @param appWindow - Renderer whose initial scan is refreshed after fixture creation.
 * @returns The two empty parent paths and the occupied parent that must survive.
 * @example const folders = await stageUnusedFolders(isolatedHome, appWindow)
 */
async function stageUnusedFolders(isolatedHome: string, appWindow: Page) {
  const clinePath = join(isolatedHome, '.cline')
  const warpPath = join(isolatedHome, '.warp')
  const occupiedPath = join(isolatedHome, '.codex')
  for (const folderPath of [clinePath, warpPath, occupiedPath]) {
    // Never erase pre-existing snapshot data to make the fixture fit.
    expect(existsSync(folderPath)).toBe(false)
    mkdirSync(folderPath)
  }
  writeFileSync(join(occupiedPath, 'settings.json'), 'keep settings')
  await waitForInitialScan(appWindow)
  await appWindow.evaluate(async () => {
    const agents = await window.electron.agents.getAll()
    const store = window.__store__ ?? window.__store
    if (!store) throw new Error('Redux store unavailable in E2E build')
    store.dispatch({ type: 'agents/fetchAll/fulfilled', payload: agents })
  })
  return { clinePath, warpPath, occupiedPath }
}

/**
 * Matches only this test's folders and known fixture files in OS Trash after confirmation, including failed assertions.
 * @param before - All pre-existing Trash names, including hidden entries.
 * @param identities - Exact device/inode pairs of the disposable reviewed folders.
 * @param expectedFiles - Allowed fixture filenames and contents; an empty map permits only empty folders.
 * @returns Newly trashed fixture folders safe for assertions and cleanup.
 * @example findTrashedFixtures(before, identities) // ['/Users/me/.Trash/.cline.cleanup-...']
 */
function findTrashedFixtures(
  before: Set<string>,
  identities: Array<{ dev: number; ino: number }>,
  expectedFiles: Readonly<Record<string, string>> = {},
): string[] {
  return readdirSync(USER_TRASH_DIR)
    .filter(
      (name) => !before.has(name) && /^\.(cline|warp)\.cleanup-/.test(name),
    )
    .flatMap((name) => {
      const path = join(USER_TRASH_DIR, name)
      try {
        const stats = lstatSync(path)
        // Match identity and known file contents so failed negative tests also clean up only their fixtures.
        return stats.isDirectory() &&
          identities.some(
            (identity) =>
              identity.dev === stats.dev && identity.ino === stats.ino,
          ) &&
          readdirSync(path).every(
            (entry) =>
              Object.hasOwn(expectedFiles, entry) &&
              lstatSync(join(path, entry)).isFile() &&
              readFileSync(join(path, entry), 'utf8') === expectedFiles[entry],
          )
          ? [path]
          : []
      } catch {
        return []
      }
    })
}

test('not-installed agent actions review empty parent paths without expanding the list and cancel keeps them', async ({
  appWindow,
  isolatedHome,
}) => {
  // Arrange
  const folders = await stageUnusedFolders(isolatedHome, appWindow)
  const disclosure = appWindow
    .locator('details')
    .filter({ has: appWindow.getByText(/^\d+ not installed$/) })
  await expect(disclosure).not.toHaveAttribute('open', '')

  // Act
  await appWindow
    .getByRole('button', { name: 'Not installed agent actions' })
    .click()
  await appWindow
    .getByRole('menuitem', { name: 'Delete empty agent folders...' })
    .click()
  const dialog = appWindow.getByRole('dialog', {
    name: 'Delete empty agent folders?',
  })
  await expect(
    dialog.getByText(folders.clinePath, { exact: true }),
  ).toBeVisible()
  await expect(
    dialog.getByText(folders.warpPath, { exact: true }),
  ).toBeVisible()
  await expect(
    dialog.getByText(folders.occupiedPath, { exact: true }),
  ).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()

  // Assert
  await expect(dialog).toHaveCount(0)
  await expect(disclosure).not.toHaveAttribute('open', '')
  await expect(
    appWindow.getByRole('button', { name: 'Not installed agent actions' }),
  ).toBeFocused()
  expect(readdirSync(folders.clinePath)).toEqual([])
  expect(readdirSync(folders.warpPath)).toEqual([])
  expect(
    readFileSync(join(folders.occupiedPath, 'settings.json'), 'utf8'),
  ).toBe('keep settings')
})

test('not-installed cleanup trashes both empty parents and keeps settings in an occupied parent', async ({
  appWindow,
  isolatedHome,
}) => {
  // Arrange
  test.skip(
    !canReadUserTrash(),
    'OS Trash inspection is unavailable for safe fixture cleanup',
  )
  test.skip(
    !isSameVolumeAsUserTrash(isolatedHome),
    'Fixture identity checks require the OS Trash volume',
  )
  const folders = await stageUnusedFolders(isolatedHome, appWindow)
  const identities = [lstatSync(folders.clinePath), lstatSync(folders.warpPath)]
  const before = new Set(readdirSync(USER_TRASH_DIR))
  await appWindow
    .getByRole('button', { name: 'Not installed agent actions' })
    .click()
  await appWindow
    .getByRole('menuitem', { name: 'Delete empty agent folders...' })
    .click()

  try {
    // Act
    await appWindow
      .getByRole('button', { name: 'Delete folders', exact: true })
      .click()

    // Assert
    await expect(
      appWindow.getByText('Deleted 2 empty agent folders', { exact: true }),
    ).toBeVisible()
    expect(existsSync(folders.clinePath)).toBe(false)
    expect(existsSync(folders.warpPath)).toBe(false)
    expect(
      readFileSync(join(folders.occupiedPath, 'settings.json'), 'utf8'),
    ).toBe('keep settings')
    expect(findTrashedFixtures(before, identities)).toHaveLength(2)
    await expect(
      appWindow.getByText('Agents', { exact: true }).first(),
    ).toBeFocused()
    await appWindow
      .getByRole('button', { name: 'Not installed agent actions' })
      .click()
    await expect(
      appWindow.getByRole('menuitem', {
        name: 'Delete empty agent folders...',
      }),
    ).toBeDisabled()
  } finally {
    cleanupTrashEntries(findTrashedFixtures(before, identities))
  }
})

test('not-installed cleanup preserves folders that receive settings after confirmation opens', async ({
  appWindow,
  isolatedHome,
}) => {
  // Arrange
  test.skip(
    !canReadUserTrash(),
    'OS Trash inspection is unavailable for safe fixture cleanup',
  )
  test.skip(
    !isSameVolumeAsUserTrash(isolatedHome),
    'Fixture identity checks require the OS Trash volume',
  )
  const folders = await stageUnusedFolders(isolatedHome, appWindow)
  const identities = [lstatSync(folders.clinePath), lstatSync(folders.warpPath)]
  const before = new Set(readdirSync(USER_TRASH_DIR))
  await appWindow
    .getByRole('button', { name: 'Not installed agent actions' })
    .click()
  await appWindow
    .getByRole('menuitem', { name: 'Delete empty agent folders...' })
    .click()
  writeFileSync(join(folders.clinePath, 'settings.json'), 'new settings')
  writeFileSync(join(folders.warpPath, 'history.json'), 'new history')

  try {
    // Act
    await appWindow
      .getByRole('button', { name: 'Delete folders', exact: true })
      .click()

    // Assert
    await expect(
      appWindow.getByText('Some empty agent folders could not be deleted', {
        exact: true,
      }),
    ).toBeVisible()
    expect(readFileSync(join(folders.clinePath, 'settings.json'), 'utf8')).toBe(
      'new settings',
    )
    expect(readFileSync(join(folders.warpPath, 'history.json'), 'utf8')).toBe(
      'new history',
    )
    await expect(appWindow.getByRole('dialog')).toHaveCount(0)
  } finally {
    cleanupTrashEntries(
      findTrashedFixtures(before, identities, {
        'settings.json': 'new settings',
        'history.json': 'new history',
      }),
    )
  }
})
