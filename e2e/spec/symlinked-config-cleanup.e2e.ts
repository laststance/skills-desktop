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
const STALE_CLEANUP_PRESERVES_REPLACEMENT_SKILL_NAME =
  'stale-cleanup-preserves-replacement-fixture'
const ORPHAN_CLEANUP_UI_SKILL_NAME = 'orphan-cleanup-ui-fixture'
const INACCESSIBLE_MANUAL_REVIEW_SKILL_NAME =
  'inaccessible-manual-review-fixture'

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
    expect(() => lstatSync(devinLinkPath)).toThrow(/ENOENT/)
  },
)

test('Symlink Health cleanup unlinks a broken agent slot without deleting the source skill', async ({
  appWindow,
  isolatedHome,
}) => {
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
  expect(() => lstatSync(codexLinkPath)).toThrow(/ENOENT/)
})

test('Symlink Health cleanup IPC refuses a reviewed broken slot that becomes valid after review', async ({
  appWindow,
  isolatedHome,
}) => {
  // Arrange: the review plan sees a broken Codex slot for a live source skill.
  const sourcePath = join(
    isolatedHome,
    '.agents',
    'skills',
    STALE_CLEANUP_PRESERVES_REPLACEMENT_SKILL_NAME,
  )
  const codexSkillsDir = join(isolatedHome, '.codex', 'skills')
  const codexLinkPath = join(
    codexSkillsDir,
    STALE_CLEANUP_PRESERVES_REPLACEMENT_SKILL_NAME,
  )

  mkdirSync(sourcePath, { recursive: true })
  writeFileSync(
    join(sourcePath, 'SKILL.md'),
    [
      '---',
      `name: ${STALE_CLEANUP_PRESERVES_REPLACEMENT_SKILL_NAME}`,
      'description: E2E fixture for stale cleanup replacement preservation',
      '---',
      '',
    ].join('\n'),
  )
  mkdirSync(codexSkillsDir, { recursive: true })
  symlinkSync('../missing-target-for-stale-cleanup-ui', codexLinkPath)
  await refreshSkillsState(appWindow)

  await appWindow.getByRole('button', { name: 'Scan issues' }).click()
  await expect(
    appWindow.getByRole('heading', { name: 'Symlink cleanup' }),
  ).toBeVisible()
  await expect(
    appWindow
      .getByLabel('Symlink cleanup')
      .getByText(STALE_CLEANUP_PRESERVES_REPLACEMENT_SKILL_NAME, {
        exact: true,
      }),
  ).toBeVisible()

  const reviewedTargetPath = join(
    isolatedHome,
    '.codex',
    'missing-target-for-stale-cleanup-ui',
  )

  // Act: mutate after the UI review, then invoke the real renderer→main IPC
  // with the reviewed stale payload so the main commit guard is exercised.
  rmSync(codexLinkPath, { force: true })
  symlinkSync(sourcePath, codexLinkPath)
  const result = await appWindow.evaluate(
    async ({ linkPath, targetPath, skillName }) => {
      return window.electron.skills.clearBrokenSymlinkSlots({
        items: [
          {
            agentId: 'codex',
            linkName: skillName,
            linkPath,
            targetPath,
          },
        ],
      })
    },
    {
      linkPath: codexLinkPath,
      targetPath: reviewedTargetPath,
      skillName: STALE_CLEANUP_PRESERVES_REPLACEMENT_SKILL_NAME,
    },
  )

  // Assert: main rejects the stale commit and preserves the replacement link.
  expect(result.items).toEqual([
    expect.objectContaining({
      agentId: 'codex',
      skillName: STALE_CLEANUP_PRESERVES_REPLACEMENT_SKILL_NAME,
      linkPath: codexLinkPath,
      outcome: 'error',
      error: expect.objectContaining({ code: 'ESTALE' }),
    }),
  ])
  expect(lstatSync(codexLinkPath).isSymbolicLink()).toBe(true)
  expect(realpathSync.native(codexLinkPath)).toBe(
    realpathSync.native(sourcePath),
  )
})

test('Symlink Health cleanup removes orphan records without creating an Undo affordance', async ({
  appWindow,
  isolatedHome,
}) => {
  // Arrange: no source skill exists; Codex owns only a dangling agent symlink.
  const codexSkillsDir = join(isolatedHome, '.codex', 'skills')
  const orphanLinkPath = join(codexSkillsDir, ORPHAN_CLEANUP_UI_SKILL_NAME)
  const missingSourcePath = join(
    isolatedHome,
    '.agents',
    'skills',
    ORPHAN_CLEANUP_UI_SKILL_NAME,
  )
  mkdirSync(codexSkillsDir, { recursive: true })
  symlinkSync(missingSourcePath, orphanLinkPath)
  await refreshSkillsState(appWindow)

  // Act: clean the orphan-record path from the Symlink Health dialog.
  await appWindow.getByRole('button', { name: 'Scan issues' }).click()
  await expect(
    appWindow.getByRole('heading', { name: 'Symlink cleanup' }),
  ).toBeVisible()
  await expect(appWindow.getByText('Orphan records')).toBeVisible()
  await expect(
    appWindow.getByText(ORPHAN_CLEANUP_UI_SKILL_NAME, { exact: true }),
  ).toBeVisible()
  await appWindow.getByRole('button', { name: 'Clean 1 selected' }).click()

  // Assert: only the dangling symlink is removed; no trash/undo path appears.
  await expect(appWindow.getByText('Cleaned up 1 symlink issue')).toBeVisible()
  await expect(appWindow.getByText('1 orphan symlink removed')).toBeVisible()
  expect(() => lstatSync(orphanLinkPath)).toThrow(/ENOENT/)
  expect(existsSync(missingSourcePath)).toBe(false)
  await expect(appWindow.getByRole('button', { name: /^Undo$/ })).toHaveCount(0)
})

test('inaccessible agent symlinks stay visible for manual review without destructive row affordances', async ({
  appWindow,
  isolatedHome,
}) => {
  // Arrange: a self-referential Codex symlink produces ELOOP, which the app
  // treats as inaccessible/manual-review rather than cleanup-ready broken.
  const codexSkillsDir = join(isolatedHome, '.codex', 'skills')
  const loopLinkPath = join(
    codexSkillsDir,
    INACCESSIBLE_MANUAL_REVIEW_SKILL_NAME,
  )
  mkdirSync(codexSkillsDir, { recursive: true })
  symlinkSync(loopLinkPath, loopLinkPath)
  await refreshSkillsState(appWindow)

  await expect(appWindow.getByText('Manual review')).toBeVisible()
  await expect(
    appWindow.getByRole('button', { name: 'Scan issues' }),
  ).toHaveCount(0)

  // Act: open the Codex-scoped view where row Add/Unlink affordances render.
  await appWindow.evaluate(() => {
    const store = window.__store__ ?? window.__store
    if (!store) throw new Error('Redux store unavailable in E2E build')
    store.dispatch({ type: 'ui/selectAgent', payload: 'codex' })
  })

  // Assert: the row is visible as manual review and does not expose Add/Unlink.
  await expect(
    appWindow.getByText(INACCESSIBLE_MANUAL_REVIEW_SKILL_NAME),
  ).toBeVisible()
  await expect(
    appWindow.getByLabel('Inaccessible link - manual review required'),
  ).toBeVisible()
  await expect(appWindow.getByRole('button', { name: /^Add$/ })).toHaveCount(0)
  await expect(
    appWindow.getByRole('button', {
      name: `Unlink ${INACCESSIBLE_MANUAL_REVIEW_SKILL_NAME} from Codex`,
    }),
  ).toHaveCount(0)

  const inaccessibleSnapshot = await getStoreState(
    appWindow,
    (state, name): string | undefined => {
      const root = state as {
        skills: {
          items: Array<{
            name: string
            symlinks: Array<{ agentId: string; status: string }>
          }>
        }
      }
      return root.skills.items
        .find((skill) => skill.name === name)
        ?.symlinks.find((symlink) => symlink.agentId === 'codex')?.status
    },
    INACCESSIBLE_MANUAL_REVIEW_SKILL_NAME,
  )
  expect(inaccessibleSnapshot).toBe('inaccessible')
})
