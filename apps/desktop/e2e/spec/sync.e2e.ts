import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

import { test, expect } from '../fixtures/electron-app'
import { waitForInitialScan, waitForSyncSettled } from '../helpers/redux'

/**
 * Stage independent skills and two agent directories inside the E2E fixture HOME.
 * Cleanup scenarios call this after launch; Refresh exposes the staged agent rows.
 * @example stageCleanupSkills(isolatedHome)
 */
function stageCleanupSkills(home: string): void {
  for (const name of [
    'retirement-alpha',
    'retirement-beta',
    'retirement-conflict',
  ]) {
    const path = join(home, '.agents', 'skills', name)
    mkdirSync(path, { recursive: true })
    writeFileSync(
      join(path, 'SKILL.md'),
      `---\nname: ${name}\ndescription: Isolated Cleanup regression.\n---\n# ${name}\n`,
    )
  }
  for (const agent of ['.cursor', '.cline']) {
    mkdirSync(join(home, agent, 'skills'), { recursive: true })
  }
  const conflict = join(home, '.cursor', 'skills', 'retirement-conflict')
  mkdirSync(conflict, { recursive: true })
  writeFileSync(
    join(conflict, 'SKILL.md'),
    '# Existing agent-local work\nKeep these exact bytes.\n',
  )
}

test('global Sync is absent while source tools, Quick Actions and agent Cleanup remain available', async ({
  appWindow,
}) => {
  // Arrange
  await waitForInitialScan(appWindow)
  // Act
  await appWindow.getByRole('tab', { name: 'Actions', exact: true }).click()
  // Assert
  await expect(
    appWindow.getByRole('button', { name: 'Sync', exact: true }),
  ).toHaveCount(0)
  await expect(
    appWindow.getByRole('button', { name: 'Refresh skills and agent status' }),
  ).toBeVisible()
  await expect(
    appWindow.getByRole('button', { name: 'Source folder actions' }),
  ).toBeVisible()
  await expect(
    appWindow.getByRole('button', { name: 'Refresh', exact: true }),
  ).toBeVisible()
  await expect(
    appWindow.getByRole('button', { name: 'Marketplace', exact: true }),
  ).toBeVisible()
  await expect(
    appWindow.getByRole('button', { name: 'Reset Layout', exact: true }),
  ).toBeVisible()
})

test('agent Cleanup creates missing links only for the chosen agent and preserves its real folders', async ({
  appWindow,
  isolatedHome,
}) => {
  // Arrange
  await waitForInitialScan(appWindow)
  stageCleanupSkills(isolatedHome)
  await appWindow
    .getByRole('button', { name: 'Refresh skills and agent status' })
    .click()
  const conflict = join(
    isolatedHome,
    '.cursor',
    'skills',
    'retirement-conflict',
    'SKILL.md',
  )
  // Act
  await appWindow
    .getByRole('button', { name: /Filter skills by Cursor/ })
    .click({ button: 'right' })
  await appWindow
    .getByRole('menuitem', { name: 'Cleanup missing skills...' })
    .click()
  await waitForSyncSettled(appWindow, 'preview')
  const dialog = appWindow.getByRole('dialog', {
    name: /Cleanup missing skills/,
  })
  await expect(
    dialog.getByText(
      "Conflicts (real folders blocking a symlink) are not touched by cleanup. Inspect this agent's folder to resolve them manually.",
    ),
  ).toBeVisible()
  await dialog.getByRole('button', { name: /^Cleanup \d+ skills?$/ }).click()
  await waitForSyncSettled(appWindow, 'result')
  // Assert
  await expect(
    appWindow.getByRole('dialog', { name: 'Cleanup Results' }),
  ).toBeVisible()
  expect(
    lstatSync(
      join(isolatedHome, '.cursor', 'skills', 'retirement-alpha'),
    ).isSymbolicLink(),
  ).toBe(true)
  expect(
    lstatSync(
      join(isolatedHome, '.cursor', 'skills', 'retirement-beta'),
    ).isSymbolicLink(),
  ).toBe(true)
  expect(
    existsSync(join(isolatedHome, '.cline', 'skills', 'retirement-alpha')),
  ).toBe(false)
  expect(
    existsSync(join(isolatedHome, '.cline', 'skills', 'retirement-beta')),
  ).toBe(false)
  expect(readFileSync(conflict, 'utf8')).toBe(
    '# Existing agent-local work\nKeep these exact bytes.\n',
  )
  await appWindow
    .getByRole('dialog', { name: 'Cleanup Results' })
    .getByRole('button', { name: 'Close' })
    .first()
    .click()
  await expect(
    appWindow.getByRole('dialog', { name: 'Cleanup Results' }),
  ).toHaveCount(0)
  await expect(
    appWindow.getByRole('button', { name: /Filter skills by Cursor/ }),
  ).toBeVisible()
})

test('cancelling agent Cleanup leaves missing links and local content untouched', async ({
  appWindow,
  isolatedHome,
}) => {
  // Arrange
  await waitForInitialScan(appWindow)
  stageCleanupSkills(isolatedHome)
  await appWindow
    .getByRole('button', { name: 'Refresh skills and agent status' })
    .click()
  // Act
  await appWindow
    .getByRole('button', { name: /Filter skills by Cursor/ })
    .click({ button: 'right' })
  await appWindow
    .getByRole('menuitem', { name: 'Cleanup missing skills...' })
    .click()
  await waitForSyncSettled(appWindow, 'preview')
  await appWindow
    .getByRole('dialog', { name: /Cleanup missing skills/ })
    .getByRole('button', { name: 'Cancel' })
    .click()
  // Assert
  expect(
    existsSync(join(isolatedHome, '.cursor', 'skills', 'retirement-alpha')),
  ).toBe(false)
  expect(
    readFileSync(
      join(
        isolatedHome,
        '.cursor',
        'skills',
        'retirement-conflict',
        'SKILL.md',
      ),
      'utf8',
    ),
  ).toBe('# Existing agent-local work\nKeep these exact bytes.\n')
  await expect(
    appWindow.getByRole('dialog', { name: /Cleanup missing skills/ }),
  ).toHaveCount(0)
})

test('unscoped and legacy replacement IPC requests fail before any agent filesystem write', async ({
  appWindow,
  isolatedHome,
}) => {
  // Arrange
  await waitForInitialScan(appWindow)
  stageCleanupSkills(isolatedHome)
  // Act: exercise the real preload and main validation using an untyped legacy caller.
  const messages = await appWindow.evaluate(async () => {
    const invalid = [
      undefined,
      {},
      { agentId: 'unknown-agent' },
      { agentId: 'cursor', replaceConflicts: ['/tmp/local-work'] },
    ]
    return Promise.all(
      invalid.map(async (options) => {
        try {
          await Reflect.apply(window.electron.sync.execute, undefined, [
            options,
          ])
          return 'unexpected success'
        } catch (error) {
          return String(error)
        }
      }),
    )
  })
  // Assert
  expect(messages).toHaveLength(4)
  for (const message of messages) {
    expect(message).toContain("IPC validation failed on 'sync:execute'")
  }
  expect(
    existsSync(join(isolatedHome, '.cursor', 'skills', 'retirement-alpha')),
  ).toBe(false)
  expect(
    existsSync(join(isolatedHome, '.cline', 'skills', 'retirement-alpha')),
  ).toBe(false)
  expect(
    readFileSync(
      join(
        isolatedHome,
        '.cursor',
        'skills',
        'retirement-conflict',
        'SKILL.md',
      ),
      'utf8',
    ),
  ).toBe('# Existing agent-local work\nKeep these exact bytes.\n')
})
