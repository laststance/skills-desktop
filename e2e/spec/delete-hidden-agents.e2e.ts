import { randomUUID } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

import type { Page } from '@playwright/test'

import { test, expect } from '../fixtures/electron-app'
import {
  dispatchAction,
  refreshSkillsState,
  waitForInitialScan,
} from '../helpers/redux'
import {
  canReadUserTrash,
  cleanupTrashEntries,
  diffUserTrash,
  findMatchingTrashedAgentDir,
  isSameVolumeAsUserTrash,
  snapshotUserTrash,
} from '../helpers/user-trash'

/**
 * Stage disposable hidden, visible, and shared agent slots for the real sidebar bulk-delete flow.
 * @param isolatedHome - Per-test temporary HOME, never the user's agent directories.
 * @param appWindow - Electron renderer whose scan and hidden settings need refreshing.
 * @returns Fixture paths and unique names used to verify preservation and safely identify Trash entries.
 * @example const folders = await stageHiddenFolders(isolatedHome, appWindow)
 */
async function stageHiddenFolders(isolatedHome: string, appWindow: Page) {
  const protectedName = `hidden-keep-${randomUUID()}`
  const removableName = `hidden-remove-${randomUUID()}`
  const protectedSourcePath = join(
    isolatedHome,
    '.agents',
    'skills',
    protectedName,
  )
  const removableSourcePath = join(
    isolatedHome,
    '.agents',
    'skills',
    removableName,
  )
  const clinePath = join(isolatedHome, '.cline', 'skills')
  const warpPath = join(isolatedHome, '.warp', 'skills')
  const visiblePath = join(isolatedHome, '.roo', 'skills')
  const sharedPath = join(isolatedHome, '.config', 'agents', 'skills')

  // Refuse to reuse pre-existing whole-folder targets if the snapshot layout changes.
  expect(existsSync(clinePath)).toBe(false)
  expect(existsSync(warpPath)).toBe(false)
  for (const sourcePath of [protectedSourcePath, removableSourcePath]) {
    mkdirSync(sourcePath, { recursive: true })
    writeFileSync(
      join(sourcePath, 'SKILL.md'),
      '# Hidden agent deletion fixture\n\nKeep source skill contents intact.\n',
    )
  }
  for (const agentPath of [clinePath, warpPath, visiblePath, sharedPath]) {
    mkdirSync(agentPath, { recursive: true })
  }
  symlinkSync(protectedSourcePath, join(clinePath, protectedName))
  symlinkSync(removableSourcePath, join(warpPath, removableName))
  symlinkSync(removableSourcePath, join(visiblePath, removableName))
  symlinkSync(removableSourcePath, join(sharedPath, removableName))

  await waitForInitialScan(appWindow)
  await refreshSkillsState(appWindow)
  await appWindow.evaluate(async () => {
    const agents = await window.electron.agents.getAll()
    const store = window.__store__ ?? window.__store
    if (!store) throw new Error('Redux store unavailable in E2E build')
    store.dispatch({ type: 'agents/fetchAll/fulfilled', payload: agents })
    await window.electron.settings.set({
      hiddenAgentIds: ['cline', 'warp', 'amp'],
    })
  })
  await expect(appWindow.getByText('3 hidden', { exact: true })).toBeVisible()

  return {
    protectedName,
    removableName,
    protectedSourcePath,
    removableSourcePath,
    clinePath,
    warpPath,
    visiblePath,
    sharedPath,
  }
}

test('hidden agent actions open beside the collapsed disclosure and cancel keeps every folder', async ({
  appWindow,
  isolatedHome,
}) => {
  // Arrange
  const folders = await stageHiddenFolders(isolatedHome, appWindow)
  const hiddenDisclosure = appWindow.locator('details').filter({
    has: appWindow.getByText('3 hidden', { exact: true }),
  })
  await expect(hiddenDisclosure).not.toHaveAttribute('open', '')

  // Act
  await appWindow.getByRole('button', { name: 'Hidden agent actions' }).click()
  await appWindow
    .getByRole('menuitem', { name: 'Delete skills folders...' })
    .click()
  const dialog = appWindow.getByRole('dialog', {
    name: 'Delete hidden agents’ skills folders?',
  })
  await expect(dialog).toBeVisible()
  await expect(
    dialog.getByText(folders.clinePath, { exact: true }),
  ).toBeVisible()
  await expect(
    dialog.getByText(folders.warpPath, { exact: true }),
  ).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()

  // Assert
  await expect(dialog).toHaveCount(0)
  await expect(hiddenDisclosure).not.toHaveAttribute('open', '')
  expect(
    lstatSync(join(folders.clinePath, folders.protectedName)).isSymbolicLink(),
  ).toBe(true)
  expect(
    lstatSync(join(folders.warpPath, folders.removableName)).isSymbolicLink(),
  ).toBe(true)
  expect(existsSync(folders.protectedSourcePath)).toBe(true)
  expect(existsSync(folders.removableSourcePath)).toBe(true)
})

test('hidden folder deletion keeps protected slots, visible agents, and shared source skills', async ({
  appWindow,
  isolatedHome,
}) => {
  // Arrange: OS Trash is uid-based even with isolated HOME; only our unique fixture is cleaned up.
  test.skip(
    !canReadUserTrash(),
    'OS Trash inspection is unavailable for safe fixture cleanup',
  )
  test.skip(
    !isSameVolumeAsUserTrash(isolatedHome),
    'Isolated HOME must share the OS Trash volume',
  )
  const folders = await stageHiddenFolders(isolatedHome, appWindow)
  await dispatchAction(appWindow, {
    type: 'protect/addProtection',
    payload: folders.protectedName,
  })
  await appWindow.getByRole('button', { name: 'Hidden agent actions' }).click()
  await appWindow
    .getByRole('menuitem', { name: 'Delete skills folders...' })
    .click()
  const dialog = appWindow.getByRole('dialog', {
    name: 'Delete hidden agents’ skills folders?',
  })
  await expect(
    dialog.getByText('1 protected skill entry will be kept.'),
  ).toBeVisible()
  const reviewedFolders = dialog.getByRole('list', {
    name: 'Skills folders to delete',
  })
  await expect(reviewedFolders.getByText('Amp', { exact: true })).toHaveCount(0)
  const trashBefore = snapshotUserTrash()

  try {
    // Act
    await dialog
      .getByRole('button', { name: 'Delete folders', exact: true })
      .click()

    // Assert
    await expect(
      appWindow.getByText('Deleted skills from 1 hidden agent'),
    ).toBeVisible()
    await expect(dialog).toHaveCount(0)
    expect(() => lstatSync(folders.warpPath)).toThrow(/ENOENT/)
    expect(
      lstatSync(
        join(folders.clinePath, folders.protectedName),
      ).isSymbolicLink(),
    ).toBe(true)
    expect(
      lstatSync(
        join(folders.visiblePath, folders.removableName),
      ).isSymbolicLink(),
    ).toBe(true)
    expect(
      lstatSync(
        join(folders.sharedPath, folders.removableName),
      ).isSymbolicLink(),
    ).toBe(true)
    expect(
      readFileSync(join(folders.removableSourcePath, 'SKILL.md'), 'utf8'),
    ).toBe(
      '# Hidden agent deletion fixture\n\nKeep source skill contents intact.\n',
    )
    expect(existsSync(join(folders.protectedSourcePath, 'SKILL.md'))).toBe(true)
    expect(
      findMatchingTrashedAgentDir(diffUserTrash(trashBefore).newPaths, [
        folders.removableName,
      ]),
    ).toBeDefined()
    await expect(appWindow.getByText('2 hidden', { exact: true })).toBeVisible()
  } finally {
    // Match exact unique children so concurrent user Trash activity is never a cleanup target.
    const { newPaths } = diffUserTrash(trashBefore)
    // Include the protected fixture so a protection regression cannot leave test data behind.
    for (const childName of [folders.removableName, folders.protectedName]) {
      const ourTrashEntry = findMatchingTrashedAgentDir(newPaths, [childName])
      if (ourTrashEntry) cleanupTrashEntries([ourTrashEntry])
    }
  }
})

test('keyboard cancellation restores the hidden menu trigger without collapsing the agent list', async ({
  appWindow,
  isolatedHome,
}) => {
  // Arrange
  const folders = await stageHiddenFolders(isolatedHome, appWindow)
  const hiddenDisclosure = appWindow.locator('details').filter({
    has: appWindow.getByText('3 hidden', { exact: true }),
  })
  await hiddenDisclosure.locator('summary').press('Enter')
  await expect(hiddenDisclosure).toHaveAttribute('open', '')
  const menuTrigger = appWindow.getByRole('button', {
    name: 'Hidden agent actions',
  })

  // Act
  await menuTrigger.press('Enter')
  await expect(
    appWindow.getByRole('menuitem', { name: 'Delete skills folders...' }),
  ).toBeFocused()
  await appWindow.keyboard.press('Enter')
  const dialog = appWindow.getByRole('dialog', {
    name: 'Delete hidden agents’ skills folders?',
  })
  await expect(dialog).toBeVisible()
  await expect(
    dialog.getByRole('button', { name: 'Cancel', exact: true }),
  ).toBeFocused()
  await appWindow.keyboard.press('Escape')

  // Assert
  await expect(dialog).toHaveCount(0)
  await expect(menuTrigger).toBeFocused()
  await expect(hiddenDisclosure).toHaveAttribute('open', '')
  expect(
    lstatSync(join(folders.clinePath, folders.protectedName)).isSymbolicLink(),
  ).toBe(true)
  expect(
    lstatSync(join(folders.warpPath, folders.removableName)).isSymbolicLink(),
  ).toBe(true)
})

test('deleting every hidden agent folder removes the hidden controls and restores sidebar focus', async ({
  appWindow,
  isolatedHome,
}) => {
  // Arrange
  test.skip(!canReadUserTrash(), 'OS Trash inspection is unavailable')
  test.skip(
    !isSameVolumeAsUserTrash(isolatedHome),
    'Isolated HOME must share the OS Trash volume',
  )
  const folders = await stageHiddenFolders(isolatedHome, appWindow)
  await appWindow.evaluate(async () => {
    await window.electron.settings.set({ hiddenAgentIds: ['cline', 'warp'] })
  })
  const sidebar = appWindow.getByRole('complementary', {
    name: 'Agent sidebar',
  })
  await expect(sidebar.getByText('2 hidden', { exact: true })).toBeVisible()
  await sidebar.getByRole('button', { name: 'Hidden agent actions' }).click()
  await appWindow
    .getByRole('menuitem', { name: 'Delete skills folders...' })
    .click()
  const dialog = appWindow.getByRole('dialog', {
    name: 'Delete hidden agents’ skills folders?',
  })
  await expect(dialog).toBeVisible()
  const trashBefore = snapshotUserTrash()

  try {
    // Act
    await dialog
      .getByRole('button', { name: 'Delete folders', exact: true })
      .click()

    // Assert
    await expect(
      appWindow.getByText('Deleted skills from 2 hidden agents'),
    ).toBeVisible()
    await expect(dialog).toHaveCount(0)
    await expect(sidebar.getByText(/^\d+ hidden$/)).toHaveCount(0)
    await expect(
      sidebar.getByRole('button', { name: 'Hidden agent actions' }),
    ).toHaveCount(0)
    await expect(sidebar.getByText('Agents', { exact: true })).toBeFocused()
    expect(existsSync(folders.clinePath)).toBe(false)
    expect(existsSync(folders.warpPath)).toBe(false)
    expect(existsSync(folders.protectedSourcePath)).toBe(true)
    expect(existsSync(folders.removableSourcePath)).toBe(true)
    expect(existsSync(folders.visiblePath)).toBe(true)
    expect(existsSync(folders.sharedPath)).toBe(true)
  } finally {
    // Each match requires one per-test UUID child; unrelated Trash entries cannot match.
    const { newPaths } = diffUserTrash(trashBefore)
    for (const skillName of [folders.protectedName, folders.removableName]) {
      const ourTrashEntry = findMatchingTrashedAgentDir(newPaths, [skillName])
      if (ourTrashEntry) cleanupTrashEntries([ourTrashEntry])
    }
  }
})

test('a replaced hidden folder stays intact while deletion continues for the remaining hidden agents', async ({
  appWindow,
  isolatedHome,
}) => {
  // Arrange
  test.skip(!canReadUserTrash(), 'OS Trash inspection is unavailable')
  test.skip(
    !isSameVolumeAsUserTrash(isolatedHome),
    'Isolated HOME must share the OS Trash volume',
  )
  const folders = await stageHiddenFolders(isolatedHome, appWindow)
  await appWindow.getByRole('button', { name: 'Hidden agent actions' }).click()
  await appWindow
    .getByRole('menuitem', { name: 'Delete skills folders...' })
    .click()
  const dialog = appWindow.getByRole('dialog', {
    name: 'Delete hidden agents’ skills folders?',
  })
  await expect(
    dialog.getByText(folders.clinePath, { exact: true }),
  ).toBeVisible()
  const reviewedInode = lstatSync(folders.clinePath).ino
  const originalFolderPath = join(isolatedHome, '.cline', 'reviewed-skills')
  // Keep the original inode alive so replacement detection never relies on clock timing or inode reuse.
  renameSync(folders.clinePath, originalFolderPath)
  mkdirSync(folders.clinePath)
  const replacementMarkerName = `hidden-replacement-${randomUUID()}.txt`
  const replacementMarkerPath = join(folders.clinePath, replacementMarkerName)
  writeFileSync(replacementMarkerPath, 'Keep replacement contents.')
  expect(lstatSync(folders.clinePath).ino).not.toBe(reviewedInode)
  const trashBefore = snapshotUserTrash()

  try {
    // Act
    await dialog
      .getByRole('button', { name: 'Delete folders', exact: true })
      .click()

    // Assert
    await expect(
      appWindow.getByText('Some skills folders could not be deleted'),
    ).toBeVisible()
    await expect(
      appWindow.getByText(
        'Cline: Reviewed agent skills folder changed since review.',
      ),
    ).toBeVisible()
    await expect(
      appWindow.getByText('Deleted skills from 1 hidden agent'),
    ).toBeVisible()
    await expect(dialog).toHaveCount(0)
    expect(readFileSync(replacementMarkerPath, 'utf8')).toBe(
      'Keep replacement contents.',
    )
    expect(
      lstatSync(
        join(originalFolderPath, folders.protectedName),
      ).isSymbolicLink(),
    ).toBe(true)
    expect(existsSync(folders.warpPath)).toBe(false)
    expect(existsSync(folders.removableSourcePath)).toBe(true)
    await expect(appWindow.getByText('2 hidden', { exact: true })).toBeVisible()
  } finally {
    // Also recover this test's replacement if the guard regresses and wrongly trashes it.
    const { newPaths } = diffUserTrash(trashBefore)
    for (const childName of [folders.removableName, replacementMarkerName]) {
      const ourTrashEntry = findMatchingTrashedAgentDir(newPaths, [childName])
      if (ourTrashEntry) cleanupTrashEntries([ourTrashEntry])
    }
  }
})
