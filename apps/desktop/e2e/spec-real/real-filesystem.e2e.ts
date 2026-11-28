import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import {
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test'

import {
  countSourceSkillDirs,
  countValidSymlinks,
  entryKind,
  filesystemIdentitiesEqual,
  filesystemIdentityForPath,
  lockHasSkill,
  readSkillLock,
  stableSerialize,
  trashEntriesForSkill,
  type FilesystemEntryIdentity,
} from '../helpers/filesystem-truth'
import {
  captureProtectedSnapshots,
  createRealHomeLaunchContext,
  launchRealHomeElectron,
  preflightRealHome,
} from '../helpers/real-home'
import { dispatchAction, getStoreState } from '../helpers/redux'

const SKILL_NAME = 'azure-ai'
const REPO = 'microsoft/azure-skills'
const UNDO_WINDOW_MS_FOR_TEST = 15_000

interface DisplayTruth {
  azurePresent: boolean
  azurePath: string | null
  gooseStatus: string | undefined
  sourceSkillCount: number | null
  gooseLinkedCount: number | null
}

/**
 * Select the display facts this lane compares with independent filesystem truth.
 * @param state - Serialized renderer Redux state.
 * @returns Azure row, source count, and Goose count in plain serializable form.
 * @example selectDisplayTruth(store.getState())
 */
function selectDisplayTruth(state: unknown): DisplayTruth {
  const root = state as {
    skills?: {
      items?: Array<{
        name: string
        path: string
        symlinks?: Array<{ agentId: string; status: string }>
      }>
    }
    agents?: { items?: Array<{ id: string; skillCount: number }> }
    ui?: { sourceStats?: { skillCount: number } | null }
  }
  const azure = root.skills?.items?.find((skill) => skill.name === SKILL_NAME)
  const goose = root.agents?.items?.find((agent) => agent.id === 'goose')
  return {
    azurePresent: Boolean(azure),
    azurePath: azure?.path ?? null,
    gooseStatus: azure?.symlinks?.find((slot) => slot.agentId === 'goose')
      ?.status,
    sourceSkillCount: root.ui?.sourceStats?.skillCount ?? null,
    gooseLinkedCount: goose?.skillCount ?? null,
  }
}

/**
 * Wait until Redux agrees with direct filesystem measurements.
 * @param page - Electron renderer page.
 * @param home - Real host home directory.
 * @param gooseSkillsDir - Goose skills directory selected as the sacrificial target.
 * @param azurePresent - Whether azure-ai should be displayed.
 * @returns Nothing; assertions carry the failure.
 * @example await waitForDisplayTruth(page, home, gooseDir, true)
 */
async function waitForDisplayTruth(
  page: Page,
  home: string,
  gooseSkillsDir: string,
  azurePresent: boolean,
): Promise<{ sourceCount: number; gooseCount: number }> {
  const sourceCount = await countSourceSkillDirs(
    join(home, '.agents', 'skills'),
  )
  const gooseCount = await countValidSymlinks(gooseSkillsDir)
  const expected: DisplayTruth = {
    azurePresent,
    azurePath: azurePresent
      ? join(home, '.agents', 'skills', SKILL_NAME)
      : null,
    gooseStatus: azurePresent ? 'valid' : undefined,
    sourceSkillCount: sourceCount,
    gooseLinkedCount: gooseCount,
  }
  await expect
    .poll(async () => getStoreState(page, selectDisplayTruth), {
      timeout: 20_000,
    })
    .toEqual(expected)
  return { sourceCount, gooseCount }
}

/**
 * Wait for the app's own undo-window eviction to remove the azure-ai tombstone
 * and prune its lock record.
 * @param home - Real host home directory.
 * @param lockPath - Lock path visible to the app.
 * @returns Nothing; assertions carry the failure.
 * @example await waitForUndoEviction(home, lockPath)
 */
async function waitForUndoEviction(
  home: string,
  lockPath: string,
): Promise<void> {
  const trashDir = join(home, '.agents', '.trash')
  await expect
    .poll(
      async () => ({
        trashEntries: await trashEntriesForSkill(trashDir, SKILL_NAME),
        locked: lockHasSkill(await readSkillLock(lockPath), SKILL_NAME),
      }),
      { timeout: UNDO_WINDOW_MS_FOR_TEST + 15_000 },
    )
    .toEqual({ trashEntries: [], locked: false })
}

/**
 * Best-effort cleanup of only the azure-ai installation whose filesystem
 * identity this test captured. Ambiguous ownership is reported, never deleted.
 * @param page - Electron renderer page.
 * @param home - Real host home directory.
 * @param lockPath - Lock path visible to the app.
 * @param createdIdentity - Identity captured immediately after install.
 * @returns True when cleanup was invoked and eviction finished.
 * @example await cleanupOwnedInstall(page, home, lockPath, identity)
 */
async function cleanupOwnedInstall(
  page: Page,
  home: string,
  lockPath: string,
  createdIdentity: FilesystemEntryIdentity,
): Promise<boolean> {
  const sourcePath = join(home, '.agents', 'skills', SKILL_NAME)
  if (!(await entryKind(sourcePath))) return false
  const currentIdentity = await filesystemIdentityForPath(sourcePath)
  if (!filesystemIdentitiesEqual(createdIdentity, currentIdentity)) {
    throw new Error(
      'azure-ai ownership became ambiguous during the real-filesystem test; manual inspection required, no cleanup delete attempted',
    )
  }
  const result = await page.evaluate(
    async (payload) => {
      return window.electron.skills.deleteSkill(payload)
    },
    {
      skillName: SKILL_NAME,
      skillPath: sourcePath,
      filesystemIdentity: currentIdentity,
    },
  )
  if (!result.success) {
    throw new Error(`cleanup delete failed: ${result.error ?? 'unknown error'}`)
  }
  await waitForUndoEviction(home, lockPath)
  return true
}

test('real HOME azure-ai install and delete keep app display equal to filesystem truth', async () => {
  // protects: the real end-to-end user chain from production UI through the
  // in-process manager to the real filesystem, lock, agent symlink, display,
  // deletion, and undo-window cleanup.
  // fails_when: display state diverges from independently measured filesystem
  // truth, PATH-resolved CLI delegation is required, protected directories are
  // touched, or test-created artifacts survive eviction.
  // no_claim: this single lifecycle does not prove every matrix permutation,
  // and an empty PATH cannot detect a hypothetical absolute-path subprocess.
  test.skip(
    process.env['E2E_REAL_HOME'] !== '1',
    'real-HOME lane is opt-in; set E2E_REAL_HOME=1 explicitly',
  )

  const home = homedir()
  const preflight = await preflightRealHome(home)
  test.skip(
    !preflight.ok,
    `real-HOME preflight failed without mutation: ${preflight.reasons.join('; ')}`,
  )

  const baselineLock = await readSkillLock(preflight.lockPath)
  const baselineProtected = preflight.protectedSnapshots
  const context = await createRealHomeLaunchContext()
  const sourcePath = join(home, '.agents', 'skills', SKILL_NAME)
  const gooseLinkPath = join(preflight.gooseSkillsDir, SKILL_NAME)
  let app: ElectronApplication | undefined
  let page: Page | undefined
  let createdIdentity: FilesystemEntryIdentity | undefined
  let deletionStarted = false
  let evictionComplete = false

  try {
    // Arrange — production build, real HOME, temporary userData, and a PATH
    // containing no npx/node/git/gh executable.
    app = await launchRealHomeElectron(home, context)
    page = await app.firstWindow()
    const appPage = page
    await page.waitForLoadState('domcontentloaded')
    await page.waitForFunction(() => {
      const store = window.__store__ ?? window.__store
      const state = store?.getState() as
        | { agents?: { items?: Array<{ id: string; exists: boolean }> } }
        | undefined
      const agentsReady = state?.agents?.items?.some(
        (agent) => agent.id === 'goose' && agent.exists,
      )
      const skillsReady =
        (state as { skills?: { loading?: boolean } } | undefined)?.skills
          ?.loading === false
      const sourceStatsReady =
        (state as { ui?: { sourceStats?: unknown } } | undefined)?.ui
          ?.sourceStats !== null &&
        (state as { ui?: { sourceStats?: unknown } } | undefined)?.ui
          ?.sourceStats !== undefined
      return Boolean(agentsReady && skillsReady && sourceStatsReady)
    })
    expect(
      await getStoreState(
        page,
        (state) => selectDisplayTruth(state).azurePresent,
      ),
      'preflight proved no filesystem azure-ai, so the initial scan must not display one',
    ).toBe(false)

    await page.getByRole('tab', { name: 'Marketplace' }).click()
    const marketplaceSkill = {
      rank: 1,
      name: SKILL_NAME,
      repo: REPO,
      url: `https://skills.sh/${REPO}/${SKILL_NAME}`,
      installCount: 1,
    }
    const meta = { arg: SKILL_NAME, requestId: 'real-fs-azure-ai' }
    await dispatchAction(page, {
      type: 'marketplace/search/pending',
      meta: { ...meta, requestStatus: 'pending' },
    })
    await dispatchAction(page, {
      type: 'marketplace/search/fulfilled',
      payload: [marketplaceSkill],
      meta: { ...meta, requestStatus: 'fulfilled' },
    })

    // Act — install through the real Marketplace dialog. Claude is explicitly
    // unchecked because its live working set is protected.
    await expect(
      page.getByText('Found 1 skill for "azure-ai"', { exact: true }),
    ).toBeVisible()
    await page
      .getByRole('button', { name: 'Install', exact: true })
      .first()
      .click()
    const dialog = page.getByRole('dialog', { name: 'Install Skill' })
    await dialog
      .getByRole('radio', { name: 'Universal plus selected agents' })
      .click()
    const claudeCheckbox = dialog.getByRole('checkbox', { name: 'Claude Code' })
    if (
      (await claudeCheckbox.count()) > 0 &&
      (await claudeCheckbox.isChecked())
    ) {
      await claudeCheckbox.click()
    }
    const gooseCheckbox = dialog.getByRole('checkbox', { name: 'Goose' })
    await expect(gooseCheckbox).toBeVisible()
    if (!(await gooseCheckbox.isChecked())) await gooseCheckbox.click()
    await dialog.getByRole('button', { name: 'Install', exact: true }).click()
    // Wait for the install thunk to settle rather than only for the success
    // close. A settled failure can still leave a copied canonical tree behind,
    // so ownership identity must be captured before any assertion can fail.
    await expect
      .poll(
        async () => {
          const installState = await getStoreState(appPage, (state) => {
            const marketplace = (
              state as {
                marketplace?: {
                  status?: string
                  selectedSkill?: unknown
                }
              }
            ).marketplace
            return {
              status: marketplace?.status,
              hasSelectedSkill: Boolean(marketplace?.selectedSkill),
            }
          })
          if (installState.status === 'installing') return false
          return (
            installState.status === 'error' || !installState.hasSelectedSkill
          )
        },
        { timeout: 90_000 },
      )
      .toBe(true)
    if (await entryKind(sourcePath)) {
      createdIdentity = await filesystemIdentityForPath(sourcePath)
    }
    await expect(dialog).toHaveCount(0)

    // Assert install truth before any tab navigation can hide a missing
    // automatic refresh behind a user-triggered one.
    expect(await entryKind(sourcePath)).toBe('directory')
    expect(await readFile(join(sourcePath, 'SKILL.md'), 'utf8')).toContain(
      'name: azure-ai',
    )
    expect(createdIdentity).toBeDefined()
    expect(await entryKind(gooseLinkPath)).toBe('symlink')
    const postInstallLock = await readSkillLock(preflight.lockPath)
    expect(lockHasSkill(postInstallLock, SKILL_NAME)).toBe(true)
    expect(
      (postInstallLock as { skills: Record<string, { source?: string }> })
        .skills[SKILL_NAME]?.source,
    ).toBe(REPO)
    expect(await captureProtectedSnapshots(home)).toEqual(baselineProtected)

    const installedTruth = await waitForDisplayTruth(
      page,
      home,
      preflight.gooseSkillsDir,
      true,
    )
    await expect(
      page.getByText(`${installedTruth.sourceCount} skills`, { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', {
        name: new RegExp(
          `^Filter skills by Goose \\(${installedTruth.gooseCount} linked`,
        ),
      }),
    ).toBeVisible()
    await expect(
      page.getByRole('img', {
        name: new RegExp(`^${SKILL_NAME} is installed`),
      }),
    ).toBeVisible()

    await page.getByRole('tab', { name: 'Installed' }).click()
    await dispatchAction(page, {
      type: 'ui/setSearchQuery',
      payload: SKILL_NAME,
    })
    const azureCard = page.locator(`[data-skill-name="${SKILL_NAME}"]`)
    await expect(azureCard).toBeVisible()

    // Act — delete through the visible selection and confirmation controls.
    await azureCard.hover()
    await azureCard
      .getByRole('checkbox', { name: `Select ${SKILL_NAME}` })
      .click()
    const listHeader = page.getByRole('group', { name: 'List header' })
    await listHeader
      .getByRole('button', { name: 'Move selected skill to app trash' })
      .click()
    await page
      .getByRole('heading', { name: 'Delete 1 skill?' })
      .waitFor({ state: 'visible' })
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    deletionStarted = true

    // Assert delete truth while the tombstone is still inside its undo window.
    await expect
      .poll(async () => entryKind(sourcePath), { timeout: 15_000 })
      .toBeNull()
    await expect.poll(async () => entryKind(gooseLinkPath)).toBeNull()
    expect(
      await trashEntriesForSkill(join(home, '.agents', '.trash'), SKILL_NAME),
    ).toHaveLength(1)
    await waitForDisplayTruth(page, home, preflight.gooseSkillsDir, false)
    await expect(azureCard).toHaveCount(0)
    expect(await captureProtectedSnapshots(home)).toEqual(baselineProtected)

    // Assert final app-owned eviction and lock pruning, then prove the real
    // lock and protected working sets returned to their pre-run state.
    await waitForUndoEviction(home, preflight.lockPath)
    evictionComplete = true
    const finalLock = await readSkillLock(preflight.lockPath)
    if (baselineLock === null) {
      expect(lockHasSkill(finalLock, SKILL_NAME)).toBe(false)
    } else {
      expect(stableSerialize(finalLock)).toBe(stableSerialize(baselineLock))
    }
    expect(await captureProtectedSnapshots(home)).toEqual(baselineProtected)
  } finally {
    try {
      const sourceStillExists = Boolean(await entryKind(sourcePath))
      if (app && page && createdIdentity && sourceStillExists) {
        deletionStarted = await cleanupOwnedInstall(
          page,
          home,
          preflight.lockPath,
          createdIdentity,
        )
        evictionComplete = deletionStarted
      } else if (app && deletionStarted && !evictionComplete) {
        await waitForUndoEviction(home, preflight.lockPath)
      }
    } catch (cleanupError) {
      console.error(
        'real-filesystem cleanup requires inspection:',
        cleanupError,
      )
    }
    await app?.close()
    await context.cleanup()
  }
})
