import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import { TooltipProvider } from '@/renderer/src/components/ui/tooltip'
import { DEFAULT_SETTINGS } from '@/shared/settings'
import type {
  Agent,
  BulkDeleteResult,
  BulkUnlinkResult,
  FilesystemEntryIdentity,
  Skill,
  SkillName,
  SymlinkInfo,
} from '@/shared/types'
import {
  toAbsolutePath,
  toFileSizeBytes,
  toSkillCount,
  toSkillName,
  toSymlinkCount,
  tombstoneId,
} from '@/shared/types'

const mockUnlinkManyFromAgent = vi.fn()
const mockDeleteSkills = vi.fn()
const mockOnDeleteProgress = vi.fn(() => (): void => {})
const mockRefreshAllData = vi.hoisted(() => vi.fn())

vi.mock('../skills/SkillsList', () => ({
  SkillsList: () => null,
}))
vi.mock('../marketplace', () => ({
  SkillsMarketplace: () => null,
}))
vi.mock('../skills/SearchBox', () => ({
  SearchBox: () => null,
}))
vi.mock('../skills/UnlinkDialog', () => ({
  UnlinkDialog: () => null,
}))
vi.mock('../skills/AddSymlinkModal', () => ({
  AddSymlinkModal: () => null,
}))
vi.mock('../skills/CopyToAgentsModal', () => ({
  CopyToAgentsModal: () => null,
}))
vi.mock('../sidebar/SyncConfirmDialog', () => ({
  SyncConfirmDialog: () => null,
}))
vi.mock('../sidebar/SyncConflictDialog', () => ({
  SyncConflictDialog: () => null,
}))
vi.mock('../sidebar/SyncResultDialog', () => ({
  SyncResultDialog: () => null,
}))
vi.mock('../skills/UndoToast', () => ({
  UndoToast: () => null,
}))
vi.mock('../../redux/thunks', () => ({
  refreshAllData: mockRefreshAllData,
}))
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    custom: vi.fn(() => 'toast-id'),
    dismiss: vi.fn(),
  }),
}))

const CURSOR_AGENT: Agent = {
  id: 'cursor',
  name: 'Cursor',
  path: toAbsolutePath('/Users/test/.cursor/skills'),
  exists: true,
  skillCount: toSkillCount(3),
  localSkillCount: toSkillCount(0),
}

/**
 * Build a source skill with one Cursor slot for list header integration tests.
 * @param name - Skill name shown in Redux and bulk payloads.
 * @param status - Cursor symlink status for this row.
 * @returns Skill fixture loaded through the real skills reducer.
 * @example makeCursorSkill('task', 'valid').symlinks[0]?.status // => 'valid'
 */
function makeCursorSkill(
  name: SkillName,
  status: SymlinkInfo['status'],
  slotName: SkillName = name,
): Skill {
  return {
    name,
    description: '',
    path: toAbsolutePath(`/Users/test/.agents/skills/${slotName}`),
    symlinkCount: toSymlinkCount(status === 'missing' ? 0 : 1),
    symlinks: [
      {
        agentId: 'cursor',
        agentName: 'Cursor',
        status,
        linkPath: toAbsolutePath(`/Users/test/.cursor/skills/${slotName}`),
        targetPath: toAbsolutePath(`/Users/test/.agents/skills/${slotName}`),
        isLocal: false,
      },
    ],
    isSource: true,
    isOrphan: false,
  }
}

/**
 * Render MainContent with the real InstalledListHeader and lightweight child
 * mocks. The store runs the app's listener middleware, so a tab, agent or
 * failed-refresh switch clears the selection the way it does in the app.
 * @returns Browser screen and Redux store used by the mounted MainContent.
 * @example const { screen, store } = await renderMainContentWithListHeader()
 */
async function renderMainContentWithListHeader() {
  const [
    { default: uiReducer },
    { default: skillsReducer },
    { default: skillLockReducer },
    { default: agentsReducer },
    { default: bookmarksReducer },
    { default: marketplaceReducer },
    { default: settingsReducer },
    { default: protectReducer },
    { listenerMiddleware },
    { MainContent },
  ] = await Promise.all([
    import('@/renderer/src/redux/slices/uiSlice'),
    import('@/renderer/src/redux/slices/skillsSlice'),
    import('@/renderer/src/redux/slices/skillLockSlice'),
    import('@/renderer/src/redux/slices/agentsSlice'),
    import('@/renderer/src/redux/slices/bookmarkSlice'),
    import('@/renderer/src/redux/slices/marketplaceSlice'),
    import('@/renderer/src/redux/slices/settingsSlice'),
    import('@/renderer/src/redux/slices/protectSlice'),
    import('@/renderer/src/redux/listener'),
    import('./MainContent'),
  ])
  const store = configureStore({
    reducer: {
      ui: uiReducer,
      skills: skillsReducer,
      skillLock: skillLockReducer,
      agents: agentsReducer,
      bookmarks: bookmarksReducer,
      marketplace: marketplaceReducer,
      settings: settingsReducer,
      protect: protectReducer,
    },
    preloadedState: {
      settings: { ...DEFAULT_SETTINGS },
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware().prepend(listenerMiddleware.middleware),
  })
  const screen = await render(
    <Provider store={store}>
      <TooltipProvider>
        <MainContent />
      </TooltipProvider>
    </Provider>,
  )
  return { screen, store }
}

describe('MainContent list header integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOnDeleteProgress.mockImplementation(() => (): void => {})
    mockUnlinkManyFromAgent.mockResolvedValue({
      items: [
        {
          skillName: 'valid-toolbar-task',
          outcome: 'unlinked',
        },
      ],
    })
    vi.stubGlobal('electron', {
      skills: {
        onDeleteProgress: mockOnDeleteProgress,
        unlinkManyFromAgent: mockUnlinkManyFromAgent,
        deleteSkills: mockDeleteSkills,
      },
      // MainContent now hosts useMarketplaceProgress(); stub its subscription.
      skillsCli: {
        onProgress: vi.fn(() => (): void => {}),
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('reverses the alphabetical sort order when the user clicks the list header sort toggle', async () => {
    // Arrange
    const { screen, store } = await renderMainContentWithListHeader()
    expect(store.getState().ui.sortOrder).toBe('asc')

    // Act
    await screen
      .getByRole('button', { name: 'Name, sorted A to Z, click to reverse' })
      .click()

    // Assert
    expect(store.getState().ui.sortOrder).toBe('desc')
    await expect
      .element(
        screen.getByRole('button', {
          name: 'Name, sorted Z to A, click to reverse',
        }),
      )
      .toBeVisible()
  })

  test('master checkbox selects only the linked Cursor row, keeping broken and inaccessible rows out of the unlink payload', async () => {
    // Arrange — Cursor view; the broken row is ticked but not eligible.
    const { screen, store } = await renderMainContentWithListHeader()
    const { fetchAgents } =
      await import('@/renderer/src/redux/slices/agentsSlice')
    const { selectAgent } = await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills, toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const metadataName = toSkillName('valid-toolbar-task')
    const slotName = toSkillName('valid-toolbar-folder')
    store.dispatch(fetchAgents.fulfilled([CURSOR_AGENT], 'agents-req'))
    store.dispatch(selectAgent('cursor'))
    store.dispatch(
      fetchSkills.fulfilled(
        [
          makeCursorSkill(metadataName, 'valid', slotName),
          makeCursorSkill(toSkillName('broken-toolbar-task'), 'broken'),
          makeCursorSkill(
            toSkillName('inaccessible-toolbar-task'),
            'inaccessible',
          ),
        ],
        'skills-req',
      ),
    )
    store.dispatch(toggleSelection(toSkillName('broken-toolbar-task')))
    await expect.element(screen.getByText('+1 not eligible')).toBeVisible()
    expect(screen.getByText(/hidden by filter/).query()).toBeNull()

    // Act
    await screen
      .getByRole('checkbox', { name: 'Select all 1 visible skill' })
      .click()
    await screen
      .getByRole('button', { name: 'Unlink selected skill from Cursor' })
      .click()
    await screen.getByRole('button', { name: 'Unlink' }).click()

    // Assert
    await expect.poll(() => mockUnlinkManyFromAgent.mock.calls.length).toBe(1)
    expect(mockUnlinkManyFromAgent).toHaveBeenCalledWith({
      agentId: 'cursor',
      items: [
        {
          skillName: 'valid-toolbar-task',
          linkPath: '/Users/test/.cursor/skills/valid-toolbar-folder',
          targetPath: '/Users/test/.agents/skills/valid-toolbar-folder',
        },
      ],
    })
  })

  test('leaves nothing selected when the user switches views while an Unlink runs and it then fails', async () => {
    // Arrange — two linked Cursor rows are ticked and their Unlink is held
    // open, so the view switch lands mid-op.
    const { screen, store } = await renderMainContentWithListHeader()
    const { fetchAgents } =
      await import('@/renderer/src/redux/slices/agentsSlice')
    const { selectAgent } = await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills, toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    store.dispatch(fetchAgents.fulfilled([CURSOR_AGENT], 'agents-req'))
    store.dispatch(selectAgent('cursor'))
    store.dispatch(
      fetchSkills.fulfilled(
        [
          makeCursorSkill(toSkillName('task-one'), 'valid'),
          makeCursorSkill(toSkillName('task-two'), 'valid'),
        ],
        'skills-req',
      ),
    )
    store.dispatch(toggleSelection(toSkillName('task-one')))
    store.dispatch(toggleSelection(toSkillName('task-two')))
    let rejectUnlink: (reason: Error) => void = () => {}
    mockUnlinkManyFromAgent.mockReturnValue(
      new Promise<never>((_resolve, reject) => {
        rejectUnlink = reject
      }),
    )
    await screen
      .getByRole('button', { name: 'Unlink 2 selected skills from Cursor' })
      .click()
    await screen.getByRole('button', { name: 'Unlink' }).click()
    await expect.poll(() => mockUnlinkManyFromAgent.mock.calls.length).toBe(1)

    // Act — back to the global view, then the held Unlink fails.
    store.dispatch(selectAgent(null))
    rejectUnlink(new Error('Socket closed'))

    // Assert — the failure hand-off never re-ticks the cleared rows.
    await expect.poll(() => mockRefreshAllData.mock.calls.length).toBe(1)
    expect(store.getState().skills.selectedSkillNames).toEqual([])
    await expect
      .element(
        screen.getByRole('button', {
          name: 'Name, sorted A to Z, click to reverse',
        }),
      )
      .toBeEnabled()
    expect(screen.getByText(/\d+ selected/).query()).toBeNull()
  })

  test('leaves nothing selected when the user switches views while an Unlink runs and it then partly fails', async () => {
    // Arrange — two linked Cursor rows are ticked and their Unlink is held
    // open, so the view switch lands mid-op.
    const { screen, store } = await renderMainContentWithListHeader()
    const { fetchAgents } =
      await import('@/renderer/src/redux/slices/agentsSlice')
    const { selectAgent } = await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills, toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    store.dispatch(fetchAgents.fulfilled([CURSOR_AGENT], 'agents-req'))
    store.dispatch(selectAgent('cursor'))
    store.dispatch(
      fetchSkills.fulfilled(
        [
          makeCursorSkill(toSkillName('task-one'), 'valid'),
          makeCursorSkill(toSkillName('task-two'), 'valid'),
        ],
        'skills-req',
      ),
    )
    store.dispatch(toggleSelection(toSkillName('task-one')))
    store.dispatch(toggleSelection(toSkillName('task-two')))
    let resolveUnlink: (result: BulkUnlinkResult) => void = () => {}
    mockUnlinkManyFromAgent.mockReturnValue(
      new Promise<BulkUnlinkResult>((resolve) => {
        resolveUnlink = resolve
      }),
    )
    await screen
      .getByRole('button', { name: 'Unlink 2 selected skills from Cursor' })
      .click()
    await screen.getByRole('button', { name: 'Unlink' }).click()
    await expect.poll(() => mockUnlinkManyFromAgent.mock.calls.length).toBe(1)

    // Act — back to the global view, then the held Unlink returns one failure.
    store.dispatch(selectAgent(null))
    resolveUnlink({
      items: [
        { skillName: toSkillName('task-one'), outcome: 'unlinked' },
        {
          skillName: toSkillName('task-two'),
          outcome: 'error',
          error: { message: 'EPERM' },
        },
      ],
    })

    // Assert — the hand-off only narrows, so the failed row is not re-ticked.
    await expect.poll(() => mockRefreshAllData.mock.calls.length).toBe(1)
    expect(store.getState().skills.selectedSkillNames).toEqual([])
    await expect
      .element(
        screen.getByRole('button', {
          name: 'Name, sorted A to Z, click to reverse',
        }),
      )
      .toBeEnabled()
    expect(screen.getByText(/\d+ selected/).query()).toBeNull()
  })

  test('leaves nothing selected when the user switches views while a Delete runs and it then fails', async () => {
    // Arrange — two global rows are ticked and their Delete is held open, so
    // the switch to Cursor's view lands mid-op.
    const { screen, store } = await renderMainContentWithListHeader()
    const { fetchAgents } =
      await import('@/renderer/src/redux/slices/agentsSlice')
    const { selectAgent } = await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills, toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const reviewedIdentity: FilesystemEntryIdentity = {
      kind: 'directory',
      dev: 1,
      ino: 2,
      size: toFileSizeBytes(96),
      ctimeMs: 3,
      mtimeMs: 4,
    }
    store.dispatch(fetchAgents.fulfilled([CURSOR_AGENT], 'agents-req'))
    store.dispatch(
      fetchSkills.fulfilled(
        [
          {
            ...makeCursorSkill(toSkillName('task-one'), 'valid'),
            filesystemIdentity: reviewedIdentity,
          },
          {
            ...makeCursorSkill(toSkillName('task-two'), 'valid'),
            filesystemIdentity: reviewedIdentity,
          },
        ],
        'skills-req',
      ),
    )
    store.dispatch(toggleSelection(toSkillName('task-one')))
    store.dispatch(toggleSelection(toSkillName('task-two')))
    let rejectDelete: (reason: Error) => void = () => {}
    mockDeleteSkills.mockReturnValueOnce(
      new Promise<never>((_resolve, reject) => {
        rejectDelete = reject
      }),
    )
    await screen
      .getByRole('button', { name: 'Move 2 selected skills to app trash' })
      .click()
    await screen.getByRole('button', { name: /^Delete$/ }).click()
    await expect.poll(() => mockDeleteSkills.mock.calls.length).toBe(1)

    // Act — over to Cursor's view, then the held Delete fails.
    store.dispatch(selectAgent('cursor'))
    rejectDelete(new Error('Disk offline'))

    // Assert — the failure hand-off never re-ticks the cleared rows, which
    // Cursor's Unlink would otherwise act on.
    await expect.poll(() => mockRefreshAllData.mock.calls.length).toBe(1)
    expect(store.getState().skills.selectedSkillNames).toEqual([])
    await expect
      .element(
        screen.getByRole('button', {
          name: 'Name, sorted A to Z, click to reverse',
        }),
      )
      .toBeEnabled()
    expect(screen.getByText(/\d+ selected/).query()).toBeNull()
  })

  test('leaves nothing selected when the user switches views while a Delete runs and it then partly fails', async () => {
    // Arrange — two global rows are ticked and their Delete is held open, so
    // the switch to Cursor's view lands mid-op.
    const { screen, store } = await renderMainContentWithListHeader()
    const { fetchAgents } =
      await import('@/renderer/src/redux/slices/agentsSlice')
    const { selectAgent } = await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills, toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const reviewedIdentity: FilesystemEntryIdentity = {
      kind: 'directory',
      dev: 1,
      ino: 2,
      size: toFileSizeBytes(96),
      ctimeMs: 3,
      mtimeMs: 4,
    }
    store.dispatch(fetchAgents.fulfilled([CURSOR_AGENT], 'agents-req'))
    store.dispatch(
      fetchSkills.fulfilled(
        [
          {
            ...makeCursorSkill(toSkillName('task-one'), 'valid'),
            filesystemIdentity: reviewedIdentity,
          },
          {
            ...makeCursorSkill(toSkillName('task-two'), 'valid'),
            filesystemIdentity: reviewedIdentity,
          },
        ],
        'skills-req',
      ),
    )
    store.dispatch(toggleSelection(toSkillName('task-one')))
    store.dispatch(toggleSelection(toSkillName('task-two')))
    let resolveDelete: (result: BulkDeleteResult) => void = () => {}
    mockDeleteSkills.mockReturnValueOnce(
      new Promise<BulkDeleteResult>((resolve) => {
        resolveDelete = resolve
      }),
    )
    await screen
      .getByRole('button', { name: 'Move 2 selected skills to app trash' })
      .click()
    await screen.getByRole('button', { name: /^Delete$/ }).click()
    await expect.poll(() => mockDeleteSkills.mock.calls.length).toBe(1)

    // Act — over to Cursor's view, then the held Delete returns one failure.
    store.dispatch(selectAgent('cursor'))
    resolveDelete({
      items: [
        {
          skillName: toSkillName('task-one'),
          outcome: 'deleted',
          tombstoneId: tombstoneId('1729180800000-task-one-a1b2c3d4'),
          symlinksRemoved: toSymlinkCount(1),
          cascadeAgents: ['cursor'],
        },
        {
          skillName: toSkillName('task-two'),
          outcome: 'error',
          error: { message: 'EBUSY' },
        },
      ],
    })

    // Assert — the hand-off only narrows, so Cursor's Unlink never inherits
    // the failed row.
    await expect.poll(() => mockRefreshAllData.mock.calls.length).toBe(1)
    expect(store.getState().skills.selectedSkillNames).toEqual([])
    await expect
      .element(
        screen.getByRole('button', {
          name: 'Name, sorted A to Z, click to reverse',
        }),
      )
      .toBeEnabled()
    expect(screen.getByText(/\d+ selected/).query()).toBeNull()
  })

  test('moves the visible count from the Installed tab into the list header when the count setting is List header', async () => {
    // Arrange — three rows load under the default Tab badge setting.
    const { screen, store } = await renderMainContentWithListHeader()
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const { setSettings } =
      await import('@/renderer/src/redux/slices/settingsSlice')
    store.dispatch(
      fetchSkills.fulfilled(
        [
          makeCursorSkill(toSkillName('alpha'), 'valid'),
          makeCursorSkill(toSkillName('beta'), 'valid'),
          makeCursorSkill(toSkillName('gamma'), 'valid'),
        ],
        'skills-req',
      ),
    )
    await expect
      .element(
        screen.getByRole('tab', { name: /^Installed, 3 skills visible$/ }),
      )
      .toBeVisible()

    // Act
    store.dispatch(
      setSettings({
        ...DEFAULT_SETTINGS,
        installedSearchCountDisplay: 'inline',
      }),
    )

    // Assert — the header announces the count and the tab drops its badge
    const listHeader = screen.getByRole('group', { name: 'List header' })
    await expect.element(listHeader.getByText(/^3 skills$/)).toBeVisible()
    await expect
      .element(screen.getByRole('tab', { name: /^Installed$/ }))
      .toBeVisible()
    expect(
      screen.getByRole('tab', { name: /skills visible/ }).query(),
    ).toBeNull()
  })

  test('returns the header to rest after a failed refresh, with the master checkbox disabled and Cmd+A selecting nothing', async () => {
    // Arrange — two rows are ticked when the skills refresh fails.
    const { screen, store } = await renderMainContentWithListHeader()
    const { fetchSkills, toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    store.dispatch(
      fetchSkills.fulfilled(
        [
          makeCursorSkill(toSkillName('task-one'), 'valid'),
          makeCursorSkill(toSkillName('task-two'), 'valid'),
        ],
        'skills-req',
      ),
    )
    store.dispatch(toggleSelection(toSkillName('task-one')))
    store.dispatch(toggleSelection(toSkillName('task-two')))
    await expect
      .element(screen.getByText('2 selected', { exact: true }))
      .toBeVisible()

    // Act
    store.dispatch(fetchSkills.pending('refresh-failed'))
    store.dispatch(
      fetchSkills.rejected(new Error('disk read failed'), 'refresh-failed'),
    )
    await expect
      .element(screen.getByRole('checkbox', { name: 'No skills to select' }))
      .toBeDisabled()
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'a',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    )

    // Assert
    expect(store.getState().skills.selectedSkillNames).toEqual([])
    await expect
      .element(
        screen.getByRole('button', {
          name: 'Name, sorted A to Z, click to reverse',
        }),
      )
      .toBeVisible()
    expect(screen.getByText(/\d+ selected/).query()).toBeNull()
  })
})
