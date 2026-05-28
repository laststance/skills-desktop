import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

import { test, expect } from '../fixtures/electron-app'
import {
  getStoreState,
  refreshSkillsState,
  waitForInitialScan,
} from '../helpers/redux'

interface SymlinkSnapshot {
  agentId: string
  status: 'valid' | 'broken' | 'inaccessible' | 'missing'
  isLocal: boolean
  linkPath: string
}

interface SkillWithDevinSlot {
  name: string
  symlinks: SymlinkSnapshot[]
}

const SYMLINKED_CONFIG_DEVIN_SKILL_NAME = 'valid-devin-symlink-parent-fixture'
const CLEANUP_UI_SOURCE_PRESERVED_SKILL_NAME =
  'cleanup-ui-source-preserved-fixture'
const BROKEN_DEVIN_CLEANUP_SKILL_NAME = 'broken-devin-cleanup-fixture'

const symlinkedConfigTest = test.extend({
  // Playwright inspects fixture parameter names; the empty object must remain.
  // eslint-disable-next-line no-empty-pattern
  isolatedHome: async ({}, use) => {
    const home = realpathSync.native(
      mkdtempSync(join(tmpdir(), 'skills-desktop-e2e-symlinked-config-')),
    )

    try {
      seedSymlinkedConfigDevinHome(home)
      // Playwright's fixture callback is named `use`; this is not a React Hook.
      // react-doctor-disable-next-line react-hooks/rules-of-hooks
      await use(home)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  },
})

/**
 * Build the production Devin topology before Electron starts so scans read a
 * symlinked ~/.config from first paint.
 * @param home - Isolated HOME owned by this Playwright worker
 * @returns Paths are created on disk; callers recompute them from HOME
 * @example seedSymlinkedConfigDevinHome('/tmp/e2e-home')
 */
function seedSymlinkedConfigDevinHome(home: string): void {
  const logicalConfigDir = join(home, '.config')
  const physicalConfigDir = join(home, 'dotfiles', '.config')
  const sourcePath = join(
    home,
    '.agents',
    'skills',
    SYMLINKED_CONFIG_DEVIN_SKILL_NAME,
  )
  const devinSkillsDir = join(logicalConfigDir, 'devin', 'skills')
  const devinLinkPath = join(devinSkillsDir, SYMLINKED_CONFIG_DEVIN_SKILL_NAME)
  const relativeTarget = `../../../../.agents/skills/${SYMLINKED_CONFIG_DEVIN_SKILL_NAME}`

  mkdirSync(sourcePath, { recursive: true })
  writeFileSync(
    join(sourcePath, 'SKILL.md'),
    [
      '---',
      `name: ${SYMLINKED_CONFIG_DEVIN_SKILL_NAME}`,
      'description: E2E fixture for symlinked parent cleanup regression',
      '---',
      '',
    ].join('\n'),
  )

  // Keep the test focused on Devin: no snapshot copy, no sibling .config
  // agent symlinks that would create unrelated broken-count noise.
  mkdirSync(physicalConfigDir, { recursive: true })
  symlinkSync(physicalConfigDir, logicalConfigDir)
  mkdirSync(devinSkillsDir, { recursive: true })
  symlinkSync(relativeTarget, devinLinkPath)
}

symlinkedConfigTest(
  'valid Devin symlink under symlinked .config parent is not offered to cleanup',
  async ({ appWindow, isolatedHome }) => {
    await waitForInitialScan(appWindow)

    // Arrange: recompute fixture paths from HOME so assertions match main
    // process paths exactly, including macOS /private/var canonicalization.
    const sourcePath = join(
      isolatedHome,
      '.agents',
      'skills',
      SYMLINKED_CONFIG_DEVIN_SKILL_NAME,
    )
    const devinLinkPath = join(
      isolatedHome,
      '.config',
      'devin',
      'skills',
      SYMLINKED_CONFIG_DEVIN_SKILL_NAME,
    )

    // Act: read the post-boot scan result that powers Symlink Health cleanup.
    const snapshot = await getStoreState(
      appWindow,
      (state, name): SkillWithDevinSlot | null => {
        const root = state as { skills: { items: SkillWithDevinSlot[] } }
        return root.skills.items.find((skill) => skill.name === name) ?? null
      },
      SYMLINKED_CONFIG_DEVIN_SKILL_NAME,
    )

    expect(snapshot, 'source skill should be visible after scan').not.toBeNull()
    if (!snapshot) return

    const devinSlot = snapshot.symlinks.find(
      (symlink) => symlink.agentId === 'devin',
    )
    expect(devinSlot, 'Devin slot must exist for every skill row').toBeDefined()

    // Assert: the filesystem, renderer store, and destructive cleanup affordance
    // agree this symlink is valid and should not be unlinked.
    expect(lstatSync(devinLinkPath).isSymbolicLink()).toBe(true)
    expect(realpathSync.native(devinLinkPath)).toBe(
      realpathSync.native(sourcePath),
    )
    expect(devinSlot?.status).toBe('valid')
    expect(devinSlot?.isLocal).toBe(false)
    expect(devinSlot?.linkPath).toBe(devinLinkPath)

    const health = await getStoreState(appWindow, (state) => {
      const root = state as {
        skills: {
          items: Array<{
            symlinks: Array<{ status: 'valid' | 'broken' | 'missing' }>
          }>
        }
      }
      return root.skills.items.reduce(
        (totals, skill) => {
          for (const symlink of skill.symlinks) {
            if (symlink.status === 'valid') totals.valid++
            if (symlink.status === 'broken') totals.broken++
          }
          return totals
        },
        { valid: 0, broken: 0 },
      )
    })

    expect(health.broken).toBe(0)
    await expect(
      appWindow.getByRole('button', { name: 'Scan issues' }),
    ).toHaveCount(0)
    await expect(appWindow.getByText('Healthy')).toBeVisible()
  },
)

symlinkedConfigTest(
  'Symlink Health cleanup unlinks a broken Devin slot under symlinked .config without deleting the source skill',
  async ({ appWindow, isolatedHome }) => {
    await waitForInitialScan(appWindow)

    // Arrange: source exists, but Devin has a stale agent-side symlink under
    // ~/.config -> dotfiles/.config. Cleanup must remove only that link.
    const sourcePath = join(
      isolatedHome,
      '.agents',
      'skills',
      BROKEN_DEVIN_CLEANUP_SKILL_NAME,
    )
    const logicalConfigDir = join(isolatedHome, '.config')
    const physicalConfigDir = join(isolatedHome, 'dotfiles', '.config')
    const physicalDevinSkillsDir = join(physicalConfigDir, 'devin', 'skills')
    const devinLinkPath = join(
      logicalConfigDir,
      'devin',
      'skills',
      BROKEN_DEVIN_CLEANUP_SKILL_NAME,
    )
    const relativeMissingTarget = relative(
      physicalDevinSkillsDir,
      join(isolatedHome, '.agents', 'skills', 'missing-devin-cleanup-target'),
    )

    mkdirSync(sourcePath, { recursive: true })
    writeFileSync(
      join(sourcePath, 'SKILL.md'),
      [
        '---',
        `name: ${BROKEN_DEVIN_CLEANUP_SKILL_NAME}`,
        'description: E2E fixture for broken Devin cleanup under symlinked config',
        '---',
        '',
      ].join('\n'),
    )
    symlinkSync(relativeMissingTarget, devinLinkPath)
    await refreshSkillsState(appWindow)

    // Act: drive the real destructive cleanup path from Symlink Health.
    await appWindow.getByRole('button', { name: 'Scan issues' }).click()
    await expect(
      appWindow.getByRole('heading', { name: 'Symlink cleanup' }),
    ).toBeVisible()
    await expect(
      appWindow
        .getByLabel('Symlink cleanup')
        .getByText('Devin for Terminal', { exact: true }),
    ).toBeVisible()
    await appWindow.getByRole('button', { name: 'Clean 1 selected' }).click()

    // Assert: source and ~/.config alias survive; only the stale Devin link is gone.
    await expect(
      appWindow.getByText('Cleaned up 1 symlink issue'),
    ).toBeVisible()
    expect(existsSync(sourcePath)).toBe(true)
    expect(existsSync(join(sourcePath, 'SKILL.md'))).toBe(true)
    expect(lstatSync(logicalConfigDir).isSymbolicLink()).toBe(true)
    expect(existsSync(physicalConfigDir)).toBe(true)
    expect(existsSync(devinLinkPath)).toBe(false)
  },
)

test('Symlink Health cleanup unlinks a broken agent slot without deleting the source skill', async ({
  appWindow,
  isolatedHome,
}) => {
  await waitForInitialScan(appWindow)

  // Arrange: one live source skill plus one dangling non-protected agent slot.
  const sourcePath = join(
    isolatedHome,
    '.agents',
    'skills',
    CLEANUP_UI_SOURCE_PRESERVED_SKILL_NAME,
  )
  const codexSkillsDir = join(isolatedHome, '.codex', 'skills')
  const codexLinkPath = join(
    codexSkillsDir,
    CLEANUP_UI_SOURCE_PRESERVED_SKILL_NAME,
  )

  mkdirSync(sourcePath, { recursive: true })
  writeFileSync(
    join(sourcePath, 'SKILL.md'),
    [
      '---',
      `name: ${CLEANUP_UI_SOURCE_PRESERVED_SKILL_NAME}`,
      'description: E2E fixture for Symlink Health cleanup source preservation',
      '---',
      '',
    ].join('\n'),
  )
  mkdirSync(codexSkillsDir, { recursive: true })
  symlinkSync('../missing-target-for-cleanup-ui', codexLinkPath)
  await refreshSkillsState(appWindow)

  // Act: drive the actual dialog entry point and clean the selected broken slot.
  await appWindow.getByRole('button', { name: 'Scan issues' }).click()
  await expect(
    appWindow.getByRole('heading', { name: 'Symlink cleanup' }),
  ).toBeVisible()
  await expect(appWindow.getByText('Broken agent links')).toBeVisible()
  await appWindow.getByRole('button', { name: 'Clean 1 selected' }).click()

  // Assert: UI reports success, the broken agent symlink is gone, and source remains.
  await expect(appWindow.getByText('Cleaned up 1 symlink issue')).toBeVisible()
  expect(existsSync(sourcePath)).toBe(true)
  expect(existsSync(join(sourcePath, 'SKILL.md'))).toBe(true)
  expect(existsSync(codexLinkPath)).toBe(false)
})
