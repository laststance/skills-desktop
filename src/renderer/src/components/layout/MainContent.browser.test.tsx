import { configureStore } from '@reduxjs/toolkit'
import type { ReactElement } from 'react'
import { Provider } from 'react-redux'
import { toast } from 'sonner'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  onTestFinished,
  test,
  vi,
} from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'

import { partitionGlobalDeleteTargets } from '@/renderer/src/components/skills/reviewedDestructiveTargets'
import { TooltipProvider } from '@/renderer/src/components/ui/tooltip'
import { BULK_ITEM_FAILED_EVENT } from '@/renderer/src/utils/bulkOpVisuals'
import { DEFAULT_SETTINGS } from '@/shared/settings'
import type {
  AgentId,
  BulkDeleteResult,
  DeleteProgressPayload,
  FilesystemEntryIdentity,
  Skill,
  SkillName,
  SymlinkInfo,
} from '@/shared/types'
import {
  repositoryId,
  toAbsolutePath,
  toBatchItemCount,
  toBatchItemIndex,
  toFileSizeBytes,
  toHttpUrl,
  toIsoTimestamp,
  toSearchQuery,
  toSkillCount,
  toSkillName,
  toSkillRank,
  toSymlinkCount,
  tombstoneId,
} from '@/shared/types'

const mockGetAll = vi.fn()
const mockOnDeleteProgress = vi.fn(
  (_callback: (payload: DeleteProgressPayload) => void) => (): void => {},
)
const mockSkillsDeleteSkills = vi.fn()
const mockClearOrphanSymlinks = vi.fn()
const mockUnlinkManyFromAgent = vi.fn()
const mockRestoreDeletedSkill = vi.fn()
const mockRefreshAllData = vi.hoisted(() => vi.fn())
const mockListHeaderState = vi.hoisted(() => ({ enabled: false }))

const directoryIdentity: FilesystemEntryIdentity = {
  kind: 'directory',
  dev: 1,
  ino: 2,
  size: toFileSizeBytes(96),
  ctimeMs: 3,
  mtimeMs: 4,
}

/** Shape of the UndoToast element MainContent hands to the mocked sonner toast(). */
type UndoToastElement = ReactElement<{
  onUndo: (ids: ReturnType<typeof tombstoneId>[]) => Promise<void>
}>

/** sonner toast() option bag (second argument) carrying the dismiss callbacks. */
type ToastOptions = NonNullable<Parameters<typeof toast>[1]>

/**
 * Type guard that narrows a recorded `toast(...)` call to the one that rendered
 * the UndoToast element, so callers can read `onUndo`/`onDismiss` without casts.
 * @param call - One entry from the mocked `toast` call list.
 * @returns true when the first argument is a React element with an onUndo prop.
 * @example toastMock.mock.calls.find(isUndoToastCall)
 */
function isUndoToastCall(
  call: Parameters<typeof toast>,
): call is [UndoToastElement, ToastOptions] {
  return typeof call[0] === 'object' && call[0] !== null && 'props' in call[0]
}

/**
 * Short-circuit every heavy child MainContent renders so tests focus on the
 * list header wiring and the document-level keyboard shortcuts this file owns.
 * Without these mocks the default render would drag in SkillsMarketplace,
 * SkillsList (which fetches via IPC on mount), six dialogs, and the UndoToast.
 */
vi.mock('../skills/SkillsList', () => ({
  SkillsList: () => null,
}))
vi.mock('../marketplace', () => ({
  SkillsMarketplace: () => null,
}))
vi.mock('../skills/SearchBox', () => ({
  SearchBox: () => null,
}))
vi.mock('../skills/InstalledListHeader', async () => {
  const { useAppSelector } = await import('@/renderer/src/redux/hooks')
  const { selectIsBulkOpBusy } =
    await import('@/renderer/src/redux/slices/skillsSlice')
  return {
    InstalledListHeader: function MockInstalledListHeader({
      onPrimaryAction,
      onCopyAction,
    }: {
      onPrimaryAction: () => void
      onCopyAction?: () => void
    }) {
      // The live count and busy flag double as render-commit signals: the
      // keyboard shortcut refs are current once MainContent draws them.
      const selectedCount = useAppSelector(
        (state) => state.skills.selectedSkillNames.length,
      )
      const isBulkOpBusy = useAppSelector(selectIsBulkOpBusy)
      return (
        <div role="group" aria-label="List header" aria-busy={isBulkOpBusy}>
          <span>{`${selectedCount} selected`}</span>
          {mockListHeaderState.enabled ? (
            <>
              <button type="button" onClick={onPrimaryAction}>
                Open bulk confirm
              </button>
              {onCopyAction ? (
                <button type="button" onClick={onCopyAction}>
                  Open bulk copy
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      )
    },
  }
})
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

beforeEach(() => {
  mockGetAll.mockReset()
  mockOnDeleteProgress.mockReset()
  mockOnDeleteProgress.mockImplementation(() => (): void => {})
  mockSkillsDeleteSkills.mockReset()
  mockClearOrphanSymlinks.mockReset()
  mockUnlinkManyFromAgent.mockReset()
  mockRestoreDeletedSkill.mockReset()
  mockRefreshAllData.mockReset()
  mockListHeaderState.enabled = false
  // The sonner `toast` mock is module-level (created once via vi.mock) and
  // accumulates calls across every test in this file. Reset all four entry
  // points each test so toast assertions (toHaveBeenCalledWith) can't read a
  // stale call left by an earlier delete/unlink and report a false green.
  vi.mocked(toast).mockClear()
  vi.mocked(toast.success).mockClear()
  vi.mocked(toast.error).mockClear()
  vi.mocked(toast.info).mockClear()
  // Install the `electron` IPC bridge — browser mode replaces the preload
  // context, so tests that exercise `window.electron.*` must plant a fake
  // before MainContent's mount effect fires.
  vi.stubGlobal('electron', {
    skills: {
      getAll: mockGetAll,
      onDeleteProgress: mockOnDeleteProgress,
      deleteSkills: mockSkillsDeleteSkills,
      clearOrphanSymlinks: mockClearOrphanSymlinks,
      unlinkManyFromAgent: mockUnlinkManyFromAgent,
      restoreDeletedSkill: mockRestoreDeletedSkill,
    },
    // MainContent now hosts useMarketplaceProgress(), whose mount effect
    // subscribes to install progress — stub it so the effect's cleanup is valid.
    skillsCli: {
      onProgress: vi.fn(() => (): void => {}),
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Build a combined store using each slice's own initialState so tests exercise
 * real defaults without hand-crafting every field. Tests that need non-default
 * state dispatch actions after rendering.
 * @returns Redux store wired with the slices MainContent reads
 */
async function createStore() {
  const { default: uiReducer } =
    await import('@/renderer/src/redux/slices/uiSlice')
  const { default: skillsReducer } =
    await import('@/renderer/src/redux/slices/skillsSlice')
  const { default: skillLockReducer } =
    await import('@/renderer/src/redux/slices/skillLockSlice')
  const { default: agentsReducer } =
    await import('@/renderer/src/redux/slices/agentsSlice')
  const { default: bookmarksReducer } =
    await import('@/renderer/src/redux/slices/bookmarkSlice')
  const { default: marketplaceReducer } =
    await import('@/renderer/src/redux/slices/marketplaceSlice')
  const { default: settingsReducer } =
    await import('@/renderer/src/redux/slices/settingsSlice')
  const { default: protectReducer } =
    await import('@/renderer/src/redux/slices/protectSlice')
  return configureStore({
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
  })
}

/**
 * Render MainContent inside its required provider stack (Redux + Tooltip).
 * @returns { screen, store } — screen exposes vitest-browser-react locators
 */
async function renderMainContent() {
  const store = await createStore()
  const { MainContent } = await import('./MainContent')
  const screen = await render(
    <Provider store={store}>
      <TooltipProvider>
        <MainContent />
      </TooltipProvider>
    </Provider>,
  )
  return { screen, store }
}

/**
 * Dispatch a real KeyboardEvent directly on `document` so MainContent's
 * document-level listener fires through the actual browser event pipeline.
 * @param init - KeyboardEvent init dict. `bubbles` defaults to true so React's
 *   synthetic wrapper observes the event if it ever delegates, and `cancelable`
 *   defaults to true so `defaultPrevented` shows whether the handler took the key.
 * @returns The dispatched event, for `defaultPrevented` checks.
 * @example dispatchKey({ key: 'Escape' }).defaultPrevented // => false with nothing selected
 */
function dispatchKey(init: KeyboardEventInit): KeyboardEvent {
  const keydown = new KeyboardEvent('keydown', {
    ...init,
    bubbles: init.bubbles ?? true,
    cancelable: init.cancelable ?? true,
  })
  document.dispatchEvent(keydown)
  return keydown
}

/**
 * Waits until the list header shows `count` selected rows. The keyboard
 * shortcut refs update in effects after that same commit, so a keydown sent
 * afterwards sees the new selection.
 * @param screen - vitest-browser-react locator root from renderMainContent
 * @param count - Selected-row count the mocked list header should show.
 * @example await waitForSelectedCount(screen, 1)
 */
async function waitForSelectedCount(
  screen: Awaited<ReturnType<typeof renderMainContent>>['screen'],
  count: number,
): Promise<void> {
  await expect
    .element(screen.getByText(`${count} selected`, { exact: true }))
    .toBeVisible()
}

/**
 * Waits until the Installed tab badge counts `count` visible skills, so the
 * ⌘A handler's visible-names ref holds the freshly loaded rows.
 * @param screen - vitest-browser-react locator root from renderMainContent
 * @param count - Visible-skill count the Installed tab should announce.
 * @example await waitForVisibleSkillCount(screen, 2)
 */
async function waitForVisibleSkillCount(
  screen: Awaited<ReturnType<typeof renderMainContent>>['screen'],
  count: number,
): Promise<void> {
  await expect
    .element(
      screen.getByRole('tab', {
        name: `Installed, ${count} ${count === 1 ? 'skill' : 'skills'} visible`,
      }),
    )
    .toBeInTheDocument()
}

/**
 * Waits until the list header reports a running bulk op, so the shortcut
 * handler's busy ref is set before a keydown is sent.
 * @param screen - vitest-browser-react locator root from renderMainContent
 * @example await waitForBulkOpBusy(screen)
 */
async function waitForBulkOpBusy(
  screen: Awaited<ReturnType<typeof renderMainContent>>['screen'],
): Promise<void> {
  await expect
    .element(screen.getByRole('group', { name: 'List header' }))
    .toHaveAttribute('aria-busy', 'true')
}

/**
 * Build a source-repo skill for toolbar facet tests.
 * @param name - Visible skill name.
 * @param source - Repository slug shown in the repo dropdown.
 * @returns Skill row with source metadata and no agent slot.
 */
function makeSourceSkill(name: string, source: string): Skill {
  return {
    name: toSkillName(name),
    description: '',
    path: `/skills/${name}` as never,
    filesystemIdentity: directoryIdentity,
    symlinkCount: toSymlinkCount(0),
    symlinks: [],
    isSource: true,
    isOrphan: false,
    source: repositoryId(source),
    sourceUrl: toHttpUrl(`https://github.com/${source}.git`),
  }
}

/**
 * Build an agent-local skill (real folder under ~/.<agent>/skills/, no source
 * repo) so repo-filter tests can exercise the "N local skills hidden" caveat.
 * @param name - Visible skill name.
 * @param agentId - Agent whose slot holds the local skill.
 * @returns Skill row with one local symlink slot and no source metadata.
 */
function makeAgentLocalSkill(name: string, agentId: AgentId): Skill {
  return {
    name: toSkillName(name),
    description: '',
    path: `/home/user/.${agentId}/skills/${name}` as never,
    symlinkCount: toSymlinkCount(0),
    symlinks: [
      {
        agentId,
        agentName: agentId as SymlinkInfo['agentName'],
        linkPath: `/home/user/.${agentId}/skills/${name}` as never,
        targetPath: `/home/user/.${agentId}/skills/${name}` as never,
        status: 'valid',
        isLocal: true,
      },
    ],
    isSource: false,
    isOrphan: false,
  }
}

describe('MainContent Installed search count display', () => {
  test('shows the current visible count in the Installed tab by default and keeps Marketplace count-free', async () => {
    // Arrange
    const { screen, store } = await renderMainContent()
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    store.dispatch(
      fetchSkills.fulfilled(
        [
          makeSourceSkill('alpha', 'laststance/skills'),
          makeSourceSkill('beta', 'laststance/skills'),
          makeSourceSkill('gamma', 'pbakaus/impeccable'),
        ],
        'req-id',
      ),
    )

    // Assert
    await expect
      .element(
        screen.getByRole('tab', {
          name: /Installed, 3 skills visible/i,
        }),
      )
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('tab', { name: /^Marketplace$/ }))
      .toBeInTheDocument()
  })

  test('updates the Installed tab count when search and repo filters change visible skills', async () => {
    // Arrange
    const { screen, store } = await renderMainContent()
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const { setSearchQuery, setSelectedSources } =
      await import('@/renderer/src/redux/slices/uiSlice')
    store.dispatch(
      fetchSkills.fulfilled(
        [
          makeSourceSkill('alpha', 'laststance/skills'),
          makeSourceSkill('beta', 'laststance/skills'),
          makeSourceSkill('gamma', 'pbakaus/impeccable'),
        ],
        'req-id',
      ),
    )

    // Act
    store.dispatch(setSearchQuery(toSearchQuery('alpha')))

    // Assert
    await expect
      .element(
        screen.getByRole('tab', {
          name: /Installed, 1 skill visible/i,
        }),
      )
      .toBeInTheDocument()

    // Act
    store.dispatch(setSearchQuery(toSearchQuery('')))
    store.dispatch(setSelectedSources([repositoryId('pbakaus/impeccable')]))

    // Assert
    await expect
      .element(
        screen.getByRole('tab', {
          name: /Installed, 1 skill visible/i,
        }),
      )
      .toBeInTheDocument()

    // Act
    store.dispatch(setSearchQuery(toSearchQuery('missing')))

    // Assert
    await expect
      .element(
        screen.getByRole('tab', {
          name: /Installed, 0 skills visible/i,
        }),
      )
      .toBeInTheDocument()
  })
})

describe('MainContent hosts the shared InstallModal', () => {
  test('opens the Install Skill dialog when a skill is selected for install (e.g. from a sidebar bookmark)', async () => {
    // Arrange
    // MainContent is the always-mounted host for <InstallModal/> (hoisted out of
    // SkillsMarketplace, which Radix unmounts when the Marketplace tab is inactive).
    // This test deliberately does NOT mount its own InstallModal, so it fails if
    // MainContent stops rendering it — guarding the cross-tree path that sidebar
    // bookmark installs depend on (BookmarkItem/BookmarkDetailModal unit tests
    // mount their own sibling and cannot catch this regression).
    const { screen, store } = await renderMainContent()
    const { selectSkillForInstall } =
      await import('@/renderer/src/redux/slices/marketplaceSlice')

    // Act
    // Exactly the payload BookmarkItem/BookmarkDetailModal dispatch from the sidebar.
    store.dispatch(
      selectSkillForInstall({
        name: toSkillName('task'),
        repo: repositoryId('vercel-labs/skills'),
      }),
    )

    // Assert
    await expect
      .element(screen.getByRole('dialog', { name: 'Install Skill' }))
      .toBeInTheDocument()
  })
})

describe('MainContent list header', () => {
  test('shows the list header above the list with no bulk-select mode toggle', async () => {
    // Arrange
    const { screen } = await renderMainContent()

    // Act
    const listHeader = screen.getByRole('group', { name: 'List header' })

    // Assert
    await expect.element(listHeader).toBeVisible()
    await expect
      .element(screen.getByRole('button', { name: /bulk select mode/i }))
      .not.toBeInTheDocument()
  })
})

describe('MainContent keyboard shortcuts (Cmd+A)', () => {
  test('selects every visible skill on Cmd+A with no mode to enter first', async () => {
    // Arrange
    const { screen, store } = await renderMainContent()
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const skillFixtures = [
      {
        name: toSkillName('task'),
        description: '',
        path: '/skills/task' as never,
        filesystemIdentity: directoryIdentity,
        symlinkCount: toSymlinkCount(0),
        symlinks: [],
        isSource: true,
        isOrphan: false,
      },
      {
        name: toSkillName('tdd'),
        description: '',
        path: '/skills/tdd' as never,
        filesystemIdentity: directoryIdentity,
        symlinkCount: toSymlinkCount(0),
        symlinks: [],
        isSource: true,
        isOrphan: false,
      },
    ]
    // Seeding via the thunk's fulfilled action avoids mocking the IPC call
    // and exercises the real reducer path that fills `items` in production.
    store.dispatch(fetchSkills.fulfilled(skillFixtures, 'req-id'))
    await waitForVisibleSkillCount(screen, 2)

    // Act
    const keydown = dispatchKey({ key: 'a', metaKey: true })

    // Assert
    expect(store.getState().skills.selectedSkillNames).toEqual(['task', 'tdd'])
    expect(keydown.defaultPrevented).toBe(true)
    await waitForSelectedCount(screen, 2)
  })

  test('selects every visible skill on Ctrl+A with no mode to enter first', async () => {
    // Arrange
    const { screen, store } = await renderMainContent()
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const skillFixtures = [
      {
        name: toSkillName('task'),
        description: '',
        path: '/skills/task' as never,
        filesystemIdentity: directoryIdentity,
        symlinkCount: toSymlinkCount(0),
        symlinks: [],
        isSource: true,
        isOrphan: false,
      },
      {
        name: toSkillName('tdd'),
        description: '',
        path: '/skills/tdd' as never,
        filesystemIdentity: directoryIdentity,
        symlinkCount: toSymlinkCount(0),
        symlinks: [],
        isSource: true,
        isOrphan: false,
      },
    ]
    store.dispatch(fetchSkills.fulfilled(skillFixtures, 'req-id'))
    await waitForVisibleSkillCount(screen, 2)

    // Act
    dispatchKey({ key: 'a', ctrlKey: true })

    // Assert
    expect(store.getState().skills.selectedSkillNames).toEqual(['task', 'tdd'])
  })

  test('does not select skills on Cmd+A while typing in a text field', async () => {
    // Arrange — rows are loaded, so a missing editable-target guard would
    // visibly select them.
    const { screen, store } = await renderMainContent()
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const skillFixtures = [
      {
        name: toSkillName('task'),
        description: '',
        path: '/skills/task' as never,
        filesystemIdentity: directoryIdentity,
        symlinkCount: toSymlinkCount(0),
        symlinks: [],
        isSource: true,
        isOrphan: false,
      },
      {
        name: toSkillName('tdd'),
        description: '',
        path: '/skills/tdd' as never,
        filesystemIdentity: directoryIdentity,
        symlinkCount: toSymlinkCount(0),
        symlinks: [],
        isSource: true,
        isOrphan: false,
      },
    ]
    store.dispatch(fetchSkills.fulfilled(skillFixtures, 'req-id'))
    await waitForVisibleSkillCount(screen, 2)

    const textInput = document.createElement('input')
    document.body.appendChild(textInput)
    try {
      // Act
      textInput.focus()
      textInput.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'a',
          metaKey: true,
          bubbles: true,
        }),
      )

      // Assert
      expect(store.getState().skills.selectedSkillNames).toEqual([])
    } finally {
      // Removal in `finally` so a failing assertion doesn't leak a focused
      // <input> into the reused Chromium page and corrupt `document.activeElement`
      // for the next test (which would then be filtered by isEditableTarget).
      document.body.removeChild(textInput)
    }
  })

  test('keeps native text select-all on Cmd+A inside the search box instead of selecting rows', async () => {
    // Arrange — rows are loaded. The search box renders as <input
    // type="search"> (asserted in SearchBox.browser.test.tsx); a focused
    // stand-in exercises the same editable-target guard.
    const { screen, store } = await renderMainContent()
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const skillFixtures = [
      {
        name: toSkillName('task'),
        description: '',
        path: '/skills/task' as never,
        filesystemIdentity: directoryIdentity,
        symlinkCount: toSymlinkCount(0),
        symlinks: [],
        isSource: true,
        isOrphan: false,
      },
      {
        name: toSkillName('tdd'),
        description: '',
        path: '/skills/tdd' as never,
        filesystemIdentity: directoryIdentity,
        symlinkCount: toSymlinkCount(0),
        symlinks: [],
        isSource: true,
        isOrphan: false,
      },
    ]
    store.dispatch(fetchSkills.fulfilled(skillFixtures, 'req-id'))
    await waitForVisibleSkillCount(screen, 2)

    const searchInput = document.createElement('input')
    searchInput.type = 'search'
    document.body.appendChild(searchInput)
    try {
      // Act — query typed, box still focused, user hits Cmd+A
      searchInput.focus()
      const keydown = new KeyboardEvent('keydown', {
        key: 'a',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      })
      searchInput.dispatchEvent(keydown)

      // Assert — rows stay unselected, the browser keeps its text select-all,
      // and focus stays in the box
      expect(store.getState().skills.selectedSkillNames).toEqual([])
      expect(keydown.defaultPrevented).toBe(false)
      expect(document.activeElement).toBe(searchInput)
    } finally {
      // Removal in `finally` so a failing assertion doesn't leak a focused
      // <input type="search"> into the reused Chromium page.
      document.body.removeChild(searchInput)
    }
  })

  test('ignores Cmd+A while a bulk operation is settling', async () => {
    // Arrange
    const { screen, store } = await renderMainContent()
    const { bulkCopyToAgents, fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const skillFixtures = [
      {
        name: toSkillName('task'),
        description: '',
        path: '/skills/task' as never,
        filesystemIdentity: directoryIdentity,
        symlinkCount: toSymlinkCount(0),
        symlinks: [],
        isSource: true,
        isOrphan: false,
      },
      {
        name: toSkillName('tdd'),
        description: '',
        path: '/skills/tdd' as never,
        filesystemIdentity: directoryIdentity,
        symlinkCount: toSymlinkCount(0),
        symlinks: [],
        isSource: true,
        isOrphan: false,
      },
    ]
    store.dispatch(fetchSkills.fulfilled(skillFixtures, 'req-id'))
    store.dispatch(
      bulkCopyToAgents.pending('copy-req', { items: [], agentIds: [] }),
    )
    await waitForVisibleSkillCount(screen, 2)
    await waitForBulkOpBusy(screen)

    // Act
    dispatchKey({ key: 'a', metaKey: true })

    // Assert
    expect(store.getState().skills.selectedSkillNames).toEqual([])
  })

  test('keeps a tick the search hides when Cmd+A finds no visible rows to select', async () => {
    // Arrange — 'task' is ticked, then a search that matches nothing hides
    // every row. A select-all over zero rows must not wipe that hidden tick.
    const { screen, store } = await renderMainContent()
    const { fetchSkills, toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const { setSearchQuery } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const skillFixtures = [
      {
        name: toSkillName('task'),
        description: '',
        path: '/skills/task' as never,
        filesystemIdentity: directoryIdentity,
        symlinkCount: toSymlinkCount(0),
        symlinks: [],
        isSource: true,
        isOrphan: false,
      },
      {
        name: toSkillName('tdd'),
        description: '',
        path: '/skills/tdd' as never,
        filesystemIdentity: directoryIdentity,
        symlinkCount: toSymlinkCount(0),
        symlinks: [],
        isSource: true,
        isOrphan: false,
      },
    ]
    store.dispatch(fetchSkills.fulfilled(skillFixtures, 'req-id'))
    store.dispatch(toggleSelection(toSkillName('task')))
    store.dispatch(setSearchQuery(toSearchQuery('missing')))
    await waitForVisibleSkillCount(screen, 0)
    await waitForSelectedCount(screen, 1)

    // Act
    dispatchKey({ key: 'a', metaKey: true })

    // Assert
    expect(store.getState().skills.selectedSkillNames).toEqual(['task'])
  })

  test('leaves Cmd+A to the page on the Marketplace tab instead of ticking installed rows', async () => {
    // Arrange — installed rows are loaded, so a shortcut that outlived the
    // Installed tab would tick them unseen while the user browses Marketplace.
    const { screen, store } = await renderMainContent()
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const { setActiveTab } = await import('@/renderer/src/redux/slices/uiSlice')
    const skillFixtures = [
      {
        name: toSkillName('task'),
        description: '',
        path: '/skills/task' as never,
        filesystemIdentity: directoryIdentity,
        symlinkCount: toSymlinkCount(0),
        symlinks: [],
        isSource: true,
        isOrphan: false,
      },
      {
        name: toSkillName('tdd'),
        description: '',
        path: '/skills/tdd' as never,
        filesystemIdentity: directoryIdentity,
        symlinkCount: toSymlinkCount(0),
        symlinks: [],
        isSource: true,
        isOrphan: false,
      },
    ]
    store.dispatch(fetchSkills.fulfilled(skillFixtures, 'req-id'))
    await waitForVisibleSkillCount(screen, 2)
    store.dispatch(setActiveTab('marketplace'))
    await expect
      .element(screen.getByRole('tab', { name: /^Marketplace$/ }))
      .toHaveAttribute('aria-selected', 'true')

    // Act
    const keydown = dispatchKey({ key: 'a', metaKey: true })

    // Assert — no rows ticked, and the browser keeps its own select-all
    expect(store.getState().skills.selectedSkillNames).toEqual([])
    expect(keydown.defaultPrevented).toBe(false)
  })

  test('keeps native text select-all on Cmd+A inside the Inspector pane instead of selecting rows', async () => {
    // Arrange — rows are loaded, and the Inspector's file preview has focus
    const { screen, store } = await renderMainContent()
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    store.dispatch(
      fetchSkills.fulfilled(
        [
          makeSourceSkill('task', 'vercel-labs/skills'),
          makeSourceSkill('tdd', 'vercel-labs/skills'),
        ],
        'req-id',
      ),
    )
    await waitForVisibleSkillCount(screen, 2)
    // Stands in for DetailPanel, which carries the same marker.
    const inspectorPane = document.createElement('aside')
    inspectorPane.setAttribute('data-inspector-pane', '')
    const filePreview = document.createElement('pre')
    filePreview.tabIndex = 0
    filePreview.textContent = 'Use this skill when a test fails.'
    inspectorPane.appendChild(filePreview)
    document.body.appendChild(inspectorPane)
    onTestFinished(() => inspectorPane.remove())
    filePreview.focus()

    // Act
    const keydown = dispatchKey({ key: 'a', metaKey: true })

    // Assert — rows stay unticked and the browser selects the preview text
    expect(store.getState().skills.selectedSkillNames).toEqual([])
    expect(keydown.defaultPrevented).toBe(false)
  })

  test('leaves Cmd+A to an open menu instead of ticking the rows behind it', async () => {
    // Arrange — rows are loaded while a menu is open over the list
    const { screen, store } = await renderMainContent()
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    store.dispatch(
      fetchSkills.fulfilled(
        [
          makeSourceSkill('task', 'vercel-labs/skills'),
          makeSourceSkill('tdd', 'vercel-labs/skills'),
        ],
        'req-id',
      ),
    )
    await waitForVisibleSkillCount(screen, 2)
    const openMenu = document.createElement('div')
    openMenu.setAttribute('role', 'menu')
    openMenu.setAttribute('data-state', 'open')
    document.body.appendChild(openMenu)
    onTestFinished(() => openMenu.remove())

    // Act
    const keydown = dispatchKey({ key: 'a', metaKey: true })

    // Assert
    expect(store.getState().skills.selectedSkillNames).toEqual([])
    expect(keydown.defaultPrevented).toBe(false)
  })
})

describe('MainContent keyboard shortcuts (Esc)', () => {
  test('clears the selection on Esc when skills are selected', async () => {
    // Arrange
    const { screen, store } = await renderMainContent()
    const { toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    store.dispatch(toggleSelection(toSkillName('task')))
    await waitForSelectedCount(screen, 1)

    // Act
    const keydown = dispatchKey({ key: 'Escape' })

    // Assert
    expect(store.getState().skills.selectedSkillNames).toEqual([])
    expect(keydown.defaultPrevented).toBe(true)
    await waitForSelectedCount(screen, 0)
  })

  test('leaves Esc unconsumed when nothing is selected', async () => {
    // Arrange
    const { screen, store } = await renderMainContent()
    await waitForSelectedCount(screen, 0)

    // Act
    const keydown = dispatchKey({ key: 'Escape' })

    // Assert
    expect(keydown.defaultPrevented).toBe(false)
    expect(store.getState().skills.selectedSkillNames).toEqual([])
  })

  test('does not clear the selection on Esc while the user is typing in a text field', async () => {
    // Arrange
    const { screen, store } = await renderMainContent()
    const { toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    store.dispatch(toggleSelection(toSkillName('task')))
    // Wait for the selection commit so the Escape guard is exercised via the
    // editable-target branch, not the empty-selection one.
    await waitForSelectedCount(screen, 1)

    const textInput = document.createElement('input')
    document.body.appendChild(textInput)
    try {
      // Act
      textInput.focus()
      textInput.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      )

      // Assert
      expect(store.getState().skills.selectedSkillNames).toEqual(['task'])
    } finally {
      document.body.removeChild(textInput)
    }
  })

  test('keeps the selection on Esc while a bulk operation is settling', async () => {
    // Arrange
    const { screen, store } = await renderMainContent()
    const { bulkCopyToAgents, toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    store.dispatch(toggleSelection(toSkillName('task')))
    store.dispatch(
      bulkCopyToAgents.pending('copy-req', { items: [], agentIds: [] }),
    )
    await waitForSelectedCount(screen, 1)
    await waitForBulkOpBusy(screen)

    // Act
    dispatchKey({ key: 'Escape' })

    // Assert
    expect(store.getState().skills.selectedSkillNames).toEqual(['task'])
  })

  test('does not clear the selection when Escape closes an open install modal overlaying the Installed tab', async () => {
    // Arrange
    // The always-mounted InstallModal (hoisted onto MainContent so sidebar
    // bookmark installs open it on any tab) can overlay the Installed tab
    // while rows are ticked. Escape must close ONLY the modal; without the
    // open-dialog guard in handleKey, the same Escape would also clear the
    // selection — a double-fire that silently wipes the user's batch.
    const { screen, store } = await renderMainContent()
    const { toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const { selectSkillForInstall } =
      await import('@/renderer/src/redux/slices/marketplaceSlice')

    store.dispatch(toggleSelection(toSkillName('task')))
    await waitForSelectedCount(screen, 1)

    // Open the shared InstallModal (exactly the sidebar bookmark install path),
    // then wait for the Radix dialog to mount with data-state="open".
    store.dispatch(
      selectSkillForInstall({
        name: toSkillName('task'),
        repo: repositoryId('vercel-labs/skills'),
      }),
    )
    await expect
      .element(screen.getByRole('dialog', { name: 'Install Skill' }))
      .toBeInTheDocument()

    // Act — a real keypress: the browser runs React's close render between
    // Radix's listener and ours, so the dialog is already gone when ours runs
    await userEvent.keyboard('{Escape}')

    // Assert
    await expect
      .element(screen.getByRole('dialog', { name: 'Install Skill' }))
      .not.toBeInTheDocument()
    expect(store.getState().skills.selectedSkillNames).toEqual(['task'])
  })

  test('does not clear the selection when Escape closes an open dropdown menu', async () => {
    // Arrange — Radix DropdownMenu.Content owns Escape while it is open. The
    // document selection shortcut must not also consume that same keydown.
    const { screen, store } = await renderMainContent()
    const { fetchSkills, toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    store.dispatch(
      fetchSkills.fulfilled(
        [
          makeSourceSkill('alpha', 'vercel-labs/skills'),
          makeSourceSkill('beta', 'pbakaus/impeccable'),
        ],
        'req-id',
      ),
    )
    store.dispatch(toggleSelection(toSkillName('alpha')))
    await waitForSelectedCount(screen, 1)
    await screen
      .getByRole('button', { name: /Filter by source repository/i })
      .click()
    await expect.element(screen.getByRole('menu')).toBeVisible()

    // Act — a real keypress, so React closes the menu before our listener runs
    await userEvent.keyboard('{Escape}')

    // Assert
    await expect.element(screen.getByRole('menu')).not.toBeInTheDocument()
    expect(store.getState().skills.selectedSkillNames).toEqual(['alpha'])
  })

  test('keeps the selection when Escape cancels the bulk Delete confirmation', async () => {
    // Arrange — the header's Delete confirmation is open over a ticked row
    const { screen, store } = await renderMainContent()
    const { setBulkConfirm } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills, toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const taskSkill: Skill = {
      name: toSkillName('task'),
      description: '',
      path: toAbsolutePath('/Users/me/.agents/skills/task'),
      filesystemIdentity: directoryIdentity,
      symlinkCount: toSymlinkCount(0),
      symlinks: [],
      isSource: true,
      isOrphan: false,
    }
    store.dispatch(fetchSkills.fulfilled([taskSkill], 'req-id'))
    store.dispatch(toggleSelection(toSkillName('task')))
    store.dispatch(
      setBulkConfirm({
        kind: 'delete',
        origin: 'selection',
        skillNames: [toSkillName('task')],
        agentId: null,
        agentName: null,
        sourceSummary: null,
        ...partitionGlobalDeleteTargets([taskSkill], [toSkillName('task')]),
      }),
    )
    await expect
      .element(screen.getByRole('button', { name: /^Delete$/ }))
      .toBeVisible()

    // Act — a real keypress, so React closes the dialog before our listener runs
    await userEvent.keyboard('{Escape}')

    // Assert — only the dialog closes; the batch stays ticked for a retry
    await expect
      .element(screen.getByRole('button', { name: /^Delete$/ }))
      .not.toBeInTheDocument()
    expect(store.getState().ui.bulkConfirm).toBeNull()
    expect(store.getState().skills.selectedSkillNames).toEqual(['task'])
    expect(mockSkillsDeleteSkills).not.toHaveBeenCalled()
  })
})

describe('MainContent bulk delete — uniform delete pipeline', () => {
  // After the CLI removal path was retired (npx skills spawn was unreliable
  // for ~/.agents/skills targets), every global-view bulk delete — including
  // skills tracked in `~/.agents/.skill-lock.json` via a `source` field —
  // must flow through the same `skills:deleteSkills` IPC. Lock-file entries
  // becoming stale is the accepted trade-off; spawn failures are not.

  /**
   * Build a Skill fixture with either a `source` (CLI-tracked in the lock
   * file) or no source (plain). The pipeline now treats both identically.
   */
  function makeSkill(
    name: SkillName,
    cliTracked: boolean,
    folderName: SkillName = name,
  ): Skill {
    return {
      name,
      description: '',
      path: toAbsolutePath(`/home/user/.agents/skills/${folderName}`),
      filesystemIdentity: directoryIdentity,
      symlinkCount: toSymlinkCount(0),
      symlinks: [],
      isSource: true,
      isOrphan: false,
      ...(cliTracked
        ? { source: repositoryId('vercel-labs/agent-skills') }
        : {}),
    }
  }

  test('deletes both source-tracked and plain skills through a single delete call', async () => {
    // Arrange
    const { screen, store } = await renderMainContent()
    const { setBulkConfirm } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')

    const result: BulkDeleteResult = {
      items: [
        {
          skillName: toSkillName('brainstorming'),
          outcome: 'deleted',
          tombstoneId: tombstoneId('1729180800000-brainstorming-a1b2c3d4'),
          symlinksRemoved: toSymlinkCount(0),
          cascadeAgents: [],
        },
        {
          skillName: toSkillName('local-skill'),
          outcome: 'deleted',
          tombstoneId: tombstoneId('1729180800000-local-skill-e5f6a7b8'),
          symlinksRemoved: toSymlinkCount(0),
          cascadeAgents: [],
        },
      ],
    }
    mockSkillsDeleteSkills.mockResolvedValue(result)

    const selectedSkills = [
      makeSkill(toSkillName('brainstorming'), true),
      makeSkill(toSkillName('local-skill'), false),
    ]
    store.dispatch(fetchSkills.fulfilled(selectedSkills, 'req-id'))
    store.dispatch(
      setBulkConfirm({
        kind: 'delete',
        origin: 'selection',
        skillNames: [toSkillName('brainstorming'), toSkillName('local-skill')],
        agentId: null,
        agentName: null,
        sourceSummary: null,
        ...partitionGlobalDeleteTargets(selectedSkills, [
          toSkillName('brainstorming'),
          toSkillName('local-skill'),
        ]),
      }),
    )

    // Act
    await screen.getByRole('button', { name: /^Delete$/ }).click()

    // Assert
    // Single IPC call carrying BOTH reviewed row identities — partition is gone,
    // no second pipeline. Assert the payload verbatim so thunk tweaks surface.
    await expect.poll(() => mockSkillsDeleteSkills.mock.calls.length).toBe(1)
    expect(mockSkillsDeleteSkills.mock.calls[0][0]).toEqual({
      items: [
        {
          skillName: 'brainstorming',
          skillPath: '/home/user/.agents/skills/brainstorming',
          filesystemIdentity: directoryIdentity,
        },
        {
          skillName: 'local-skill',
          skillPath: '/home/user/.agents/skills/local-skill',
          filesystemIdentity: directoryIdentity,
        },
      ],
    })
    // Flush the microtask queue and re-assert: `expect.poll` is satisfied at the
    // first hit, so a regression that triggers a *second* IPC call on a later
    // microtask would otherwise slip through.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mockSkillsDeleteSkills).toHaveBeenCalledTimes(1)
  })

  test('passes reviewed source path when metadata name differs from folder basename', async () => {
    const { screen, store } = await renderMainContent()
    const { setBulkConfirm } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const metadataName = toSkillName('metadata-title')
    const folderName = toSkillName('folder-basename')
    mockSkillsDeleteSkills.mockResolvedValue({
      items: [
        {
          skillName: metadataName,
          outcome: 'deleted',
          tombstoneId: tombstoneId('1729180800000-metadata-title-a1b2c3d4'),
          symlinksRemoved: toSymlinkCount(1),
          cascadeAgents: ['cursor'],
        },
      ],
    })

    // Arrange
    const selectedSkills = [makeSkill(metadataName, false, folderName)]
    store.dispatch(fetchSkills.fulfilled(selectedSkills, 'req'))
    store.dispatch(
      setBulkConfirm({
        kind: 'delete',
        origin: 'selection',
        skillNames: [metadataName],
        agentId: null,
        agentName: null,
        sourceSummary: null,
        ...partitionGlobalDeleteTargets(selectedSkills, [metadataName]),
      }),
    )

    // Act
    await screen.getByRole('button', { name: /^Delete$/ }).click()

    // Assert
    await expect.poll(() => mockSkillsDeleteSkills.mock.calls.length).toBe(1)
    expect(mockSkillsDeleteSkills.mock.calls[0][0]).toEqual({
      items: [
        {
          skillName: 'metadata-title',
          skillPath: '/home/user/.agents/skills/folder-basename',
          filesystemIdentity: directoryIdentity,
        },
      ],
    })
  })

  test('uses header-captured delete targets when live rows drift before confirm', async () => {
    mockListHeaderState.enabled = true
    const { screen, store } = await renderMainContent()
    const { fetchSkills, toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const skillName = toSkillName('snapshot-delete')
    const originalSkill = makeSkill(
      skillName,
      false,
      toSkillName('reviewed-folder'),
    )
    const replacementSkill: Skill = {
      ...originalSkill,
      path: toAbsolutePath('/home/user/.agents/skills/replacement-folder'),
      filesystemIdentity: {
        ...directoryIdentity,
        ino: 999,
      },
    }
    mockSkillsDeleteSkills.mockResolvedValue({
      items: [
        {
          skillName,
          outcome: 'deleted',
          tombstoneId: tombstoneId('1729180800000-snapshot-delete-a1b2c3d4'),
          symlinksRemoved: toSymlinkCount(0),
          cascadeAgents: [],
        },
      ],
    } satisfies BulkDeleteResult)

    // Arrange: open the real bulk-confirm path, then replace the live row with
    // the same display name but a different reviewed filesystem identity.
    store.dispatch(fetchSkills.fulfilled([originalSkill], 'req-original'))
    store.dispatch(toggleSelection(skillName))
    await screen.getByRole('button', { name: 'Open bulk confirm' }).click()
    store.dispatch(fetchSkills.fulfilled([replacementSkill], 'req-replace'))

    // Act
    await screen.getByRole('button', { name: /^Delete$/ }).click()

    // Assert
    await expect.poll(() => mockSkillsDeleteSkills.mock.calls.length).toBe(1)
    expect(mockSkillsDeleteSkills.mock.calls[0][0]).toEqual({
      items: [
        {
          skillName: 'snapshot-delete',
          skillPath: '/home/user/.agents/skills/reviewed-folder',
          filesystemIdentity: directoryIdentity,
        },
      ],
    })
  })

  test('uses header-captured unlink targets when live rows drift before confirm', async () => {
    mockListHeaderState.enabled = true
    const { screen, store } = await renderMainContent()
    const { fetchAgents } =
      await import('@/renderer/src/redux/slices/agentsSlice')
    const { selectAgent } = await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills, toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const skillName = toSkillName('snapshot-unlink')
    const originalSkill: Skill = {
      name: skillName,
      description: '',
      path: toAbsolutePath('/home/user/.agents/skills/snapshot-unlink'),
      filesystemIdentity: directoryIdentity,
      symlinkCount: toSymlinkCount(1),
      symlinks: [
        {
          agentId: 'cursor',
          agentName: 'Cursor',
          linkPath: toAbsolutePath('/home/user/.cursor/skills/reviewed-link'),
          targetPath: toAbsolutePath(
            '/home/user/.agents/skills/reviewed-target',
          ),
          status: 'valid',
          isLocal: false,
        },
      ],
      isSource: true,
      isOrphan: false,
    }
    const replacementSkill: Skill = {
      ...originalSkill,
      symlinks: [
        {
          ...originalSkill.symlinks[0],
          linkPath: toAbsolutePath(
            '/home/user/.cursor/skills/replacement-link',
          ),
          targetPath: toAbsolutePath(
            '/home/user/.agents/skills/replacement-target',
          ),
        },
      ],
    }
    mockUnlinkManyFromAgent.mockResolvedValue({
      items: [{ skillName, outcome: 'unlinked' }],
    })

    // Arrange
    store.dispatch(
      fetchAgents.fulfilled(
        [
          {
            id: 'cursor',
            name: 'Cursor',
            path: toAbsolutePath('/home/user/.cursor/skills'),
            exists: true,
            skillCount: toSkillCount(1),
            localSkillCount: toSkillCount(0),
          },
        ],
        'req-agent',
      ),
    )
    store.dispatch(selectAgent('cursor'))
    store.dispatch(fetchSkills.fulfilled([originalSkill], 'req-original'))
    store.dispatch(toggleSelection(skillName))
    await screen.getByRole('button', { name: 'Open bulk confirm' }).click()
    store.dispatch(fetchSkills.fulfilled([replacementSkill], 'req-replace'))

    // Act
    await screen.getByRole('button', { name: /^Unlink$/ }).click()

    // Assert
    await expect.poll(() => mockUnlinkManyFromAgent.mock.calls.length).toBe(1)
    expect(mockUnlinkManyFromAgent.mock.calls[0][0]).toEqual({
      agentId: 'cursor',
      items: [
        {
          skillName: 'snapshot-unlink',
          linkPath: '/home/user/.cursor/skills/reviewed-link',
          targetPath: '/home/user/.agents/skills/reviewed-target',
        },
      ],
    })
  })

  test('routes global orphan deletes through reviewed orphan cleanup identity', async () => {
    const { screen, store } = await renderMainContent()
    const { setBulkConfirm } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const orphanSkillName = toSkillName('abandoned')
    const orphanSkill: Skill = {
      name: orphanSkillName,
      description: '',
      path: toAbsolutePath('/Users/me/.agents/skills/abandoned'),
      symlinkCount: toSymlinkCount(0),
      symlinks: [
        {
          agentId: 'devin',
          agentName: 'Devin' as never,
          linkPath: toAbsolutePath('/Users/me/.config/devin/skills/abandoned'),
          targetPath: toAbsolutePath('/Users/me/.agents/skills/abandoned'),
          status: 'broken',
          isLocal: false,
        },
      ],
      isSource: false,
      isOrphan: true,
    }
    mockClearOrphanSymlinks.mockResolvedValue({
      items: [
        {
          skillName: orphanSkillName,
          outcome: 'orphan-cleared',
          symlinksRemoved: toSymlinkCount(1),
          cascadeAgents: ['devin'],
        },
      ],
    })

    // Arrange: the global confirmation references an orphan row; this must not
    // fall back to deleteSkills because that path rescans by name in main.
    store.dispatch(fetchSkills.fulfilled([orphanSkill], 'req-id'))
    store.dispatch(
      setBulkConfirm({
        kind: 'delete',
        origin: 'selection',
        skillNames: [orphanSkillName],
        agentId: null,
        agentName: null,
        sourceSummary: null,
        ...partitionGlobalDeleteTargets([orphanSkill], [orphanSkillName]),
      }),
    )

    // Act
    await expect
      .element(
        screen.getByText(
          'This removes reviewed dangling symlinks for 1 orphan skill. Source skill files are already missing, and this cleanup cannot be undone from the notification.',
        ),
      )
      .toBeVisible()
    await screen.getByRole('button', { name: /^Delete$/ }).click()

    // Assert
    await expect.poll(() => mockClearOrphanSymlinks.mock.calls.length).toBe(1)
    expect(mockClearOrphanSymlinks.mock.calls[0][0]).toEqual({
      items: [
        {
          skillName: 'abandoned',
          agents: [
            {
              agentId: 'devin',
              linkPath: '/Users/me/.config/devin/skills/abandoned',
              targetPath: '/Users/me/.agents/skills/abandoned',
            },
          ],
        },
      ],
    })
    expect(mockSkillsDeleteSkills).not.toHaveBeenCalled()
    expect(store.getState().ui.undoToast).toBeNull()
  })

  test('keeps failed source rows selected after mixed source and orphan delete', async () => {
    const { screen, store } = await renderMainContent()
    const { setBulkConfirm } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills, toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const sourceSkillName = toSkillName('source-task')
    const orphanSkillName = toSkillName('abandoned')
    const sourceSkill: Skill = {
      name: sourceSkillName,
      description: '',
      path: toAbsolutePath('/Users/me/.agents/skills/source-task'),
      filesystemIdentity: directoryIdentity,
      symlinkCount: toSymlinkCount(0),
      symlinks: [],
      isSource: true,
      isOrphan: false,
    }
    const orphanSkill: Skill = {
      name: orphanSkillName,
      description: '',
      path: toAbsolutePath('/Users/me/.agents/skills/abandoned'),
      symlinkCount: toSymlinkCount(0),
      symlinks: [
        {
          agentId: 'devin',
          agentName: 'Devin' as never,
          linkPath: toAbsolutePath('/Users/me/.config/devin/skills/abandoned'),
          targetPath: toAbsolutePath('/Users/me/.agents/skills/abandoned'),
          status: 'broken',
          isLocal: false,
        },
      ],
      isSource: false,
      isOrphan: true,
    }
    mockSkillsDeleteSkills.mockResolvedValue({
      items: [
        {
          skillName: sourceSkillName,
          outcome: 'error',
          error: { message: 'Disk denied' },
        },
      ],
    } satisfies BulkDeleteResult)
    mockClearOrphanSymlinks.mockResolvedValue({
      items: [
        {
          skillName: orphanSkillName,
          outcome: 'orphan-cleared',
          symlinksRemoved: toSymlinkCount(1),
          cascadeAgents: ['devin'],
        },
      ],
    })

    // Arrange: mixed batch has one retryable source failure and one orphan
    // cleanup success; the source failure must stay selected for retry.
    store.dispatch(fetchSkills.fulfilled([sourceSkill, orphanSkill], 'req-id'))
    store.dispatch(toggleSelection(sourceSkillName))
    store.dispatch(toggleSelection(orphanSkillName))
    store.dispatch(
      setBulkConfirm({
        kind: 'delete',
        origin: 'selection',
        skillNames: [sourceSkillName, orphanSkillName],
        agentId: null,
        agentName: null,
        sourceSummary: null,
        ...partitionGlobalDeleteTargets(
          [sourceSkill, orphanSkill],
          [sourceSkillName, orphanSkillName],
        ),
      }),
    )

    // Act
    await screen.getByRole('button', { name: /^Delete$/ }).click()

    // Assert
    await expect.poll(() => mockClearOrphanSymlinks.mock.calls.length).toBe(1)
    expect(store.getState().skills.selectedSkillNames).toEqual([
      sourceSkillName,
    ])
    await expect
      .element(screen.getByText('1 selected', { exact: true }))
      .toBeVisible()
  })

  test('keeps source ESTALE selected instead of treating it as orphan rescan', async () => {
    const { screen, store } = await renderMainContent()
    const { setBulkConfirm } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills, toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const sourceSkillName = toSkillName('source-stale-task')
    const orphanSkillName = toSkillName('abandoned')
    const sourceSkill: Skill = {
      name: sourceSkillName,
      description: '',
      path: toAbsolutePath('/Users/me/.agents/skills/source-stale-task'),
      filesystemIdentity: directoryIdentity,
      symlinkCount: toSymlinkCount(0),
      symlinks: [],
      isSource: true,
      isOrphan: false,
    }
    const orphanSkill: Skill = {
      name: orphanSkillName,
      description: '',
      path: toAbsolutePath('/Users/me/.agents/skills/abandoned'),
      symlinkCount: toSymlinkCount(0),
      symlinks: [
        {
          agentId: 'devin',
          agentName: 'Devin' as never,
          linkPath: toAbsolutePath('/Users/me/.config/devin/skills/abandoned'),
          targetPath: toAbsolutePath('/Users/me/.agents/skills/abandoned'),
          status: 'broken',
          isLocal: false,
        },
      ],
      isSource: false,
      isOrphan: true,
    }
    mockSkillsDeleteSkills.mockResolvedValue({
      items: [
        {
          skillName: sourceSkillName,
          outcome: 'error',
          error: {
            message: 'Reviewed skill folder changed since review',
            code: 'ESTALE',
          },
        },
      ],
    } satisfies BulkDeleteResult)
    mockClearOrphanSymlinks.mockResolvedValue({
      items: [
        {
          skillName: orphanSkillName,
          outcome: 'orphan-cleared',
          symlinksRemoved: toSymlinkCount(1),
          cascadeAgents: ['devin'],
        },
      ],
    })

    // Arrange: source ESTALE is retry-visible; only orphan ESTALE/preflight
    // rows should become rescan-required and be removed from retry selection.
    store.dispatch(fetchSkills.fulfilled([sourceSkill, orphanSkill], 'req-id'))
    store.dispatch(toggleSelection(sourceSkillName))
    store.dispatch(toggleSelection(orphanSkillName))
    store.dispatch(
      setBulkConfirm({
        kind: 'delete',
        origin: 'selection',
        skillNames: [sourceSkillName, orphanSkillName],
        agentId: null,
        agentName: null,
        sourceSummary: null,
        ...partitionGlobalDeleteTargets(
          [sourceSkill, orphanSkill],
          [sourceSkillName, orphanSkillName],
        ),
      }),
    )

    // Act
    await screen.getByRole('button', { name: /^Delete$/ }).click()

    // Assert
    await expect.poll(() => mockClearOrphanSymlinks.mock.calls.length).toBe(1)
    expect(store.getState().skills.selectedSkillNames).toEqual([
      sourceSkillName,
    ])
    await expect
      .element(screen.getByText('1 selected', { exact: true }))
      .toBeVisible()
  })

  test('excludes stale orphan preflight errors from retry selection and names rescan in the summary', async () => {
    const { screen, store } = await renderMainContent()
    const { setBulkConfirm } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills, toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const sourceSkillName = toSkillName('source-task')
    const orphanSkillName = toSkillName('stale-abandoned')
    const sourceSkill: Skill = {
      name: sourceSkillName,
      description: '',
      path: toAbsolutePath('/Users/me/.agents/skills/source-task'),
      filesystemIdentity: directoryIdentity,
      symlinkCount: toSymlinkCount(0),
      symlinks: [],
      isSource: true,
      isOrphan: false,
    }
    const staleOrphanSkill: Skill = {
      name: orphanSkillName,
      description: '',
      path: toAbsolutePath('/Users/me/.agents/skills/stale-abandoned'),
      symlinkCount: toSymlinkCount(0),
      symlinks: [
        {
          agentId: 'devin',
          agentName: 'Devin' as never,
          linkPath: toAbsolutePath(
            '/Users/me/.config/devin/skills/stale-abandoned',
          ),
          status: 'broken',
          isLocal: false,
        },
      ],
      isSource: false,
      isOrphan: true,
    }
    mockSkillsDeleteSkills.mockResolvedValue({
      items: [
        {
          skillName: sourceSkillName,
          outcome: 'deleted',
          tombstoneId: tombstoneId('source-task-delete'),
          symlinksRemoved: toSymlinkCount(0),
          cascadeAgents: [],
        },
      ],
    } satisfies BulkDeleteResult)

    // Arrange: the source row succeeds, but the orphan row is stale before IPC.
    store.dispatch(
      fetchSkills.fulfilled([sourceSkill, staleOrphanSkill], 'req-id'),
    )
    store.dispatch(toggleSelection(sourceSkillName))
    store.dispatch(toggleSelection(orphanSkillName))
    store.dispatch(
      setBulkConfirm({
        kind: 'delete',
        origin: 'selection',
        skillNames: [sourceSkillName, orphanSkillName],
        agentId: null,
        agentName: null,
        sourceSummary: null,
        ...partitionGlobalDeleteTargets(
          [sourceSkill, staleOrphanSkill],
          [sourceSkillName, orphanSkillName],
        ),
      }),
    )

    // Act
    await screen.getByRole('button', { name: /^Delete$/ }).click()

    // Assert
    await expect.poll(() => mockSkillsDeleteSkills.mock.calls.length).toBe(1)
    expect(mockClearOrphanSymlinks).not.toHaveBeenCalled()
    expect(store.getState().skills.selectedSkillNames).toEqual([])
    await expect
      .element(screen.getByText('0 selected', { exact: true }))
      .toBeVisible()
    expect(store.getState().ui.undoToast?.summary).toBe(
      'Deleted 1 of 2 skills. 1 orphan skill needs a rescan before cleanup.',
    )
  })

  test('restores unresolved mixed delete selection when source delete rejects', async () => {
    const { screen, store } = await renderMainContent()
    const { setBulkConfirm } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills, toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const sourceSkillName = toSkillName('source-task')
    const orphanSkillName = toSkillName('abandoned')
    const sourceSkill: Skill = {
      name: sourceSkillName,
      description: '',
      path: toAbsolutePath('/Users/me/.agents/skills/source-task'),
      filesystemIdentity: directoryIdentity,
      symlinkCount: toSymlinkCount(0),
      symlinks: [],
      isSource: true,
      isOrphan: false,
    }
    const orphanSkill: Skill = {
      name: orphanSkillName,
      description: '',
      path: toAbsolutePath('/Users/me/.agents/skills/abandoned'),
      symlinkCount: toSymlinkCount(0),
      symlinks: [
        {
          agentId: 'devin',
          agentName: 'Devin' as never,
          linkPath: toAbsolutePath('/Users/me/.config/devin/skills/abandoned'),
          targetPath: toAbsolutePath('/Users/me/.agents/skills/abandoned'),
          status: 'broken',
          isLocal: false,
        },
      ],
      isSource: false,
      isOrphan: true,
    }
    mockSkillsDeleteSkills.mockRejectedValueOnce(new Error('Disk offline'))

    // Arrange: source delete rejects before orphan cleanup can run, so both
    // unresolved rows must remain selected for a later retry.
    store.dispatch(fetchSkills.fulfilled([sourceSkill, orphanSkill], 'req-id'))
    store.dispatch(toggleSelection(sourceSkillName))
    store.dispatch(toggleSelection(orphanSkillName))
    store.dispatch(
      setBulkConfirm({
        kind: 'delete',
        origin: 'selection',
        skillNames: [sourceSkillName, orphanSkillName],
        agentId: null,
        agentName: null,
        sourceSummary: null,
        ...partitionGlobalDeleteTargets(
          [sourceSkill, orphanSkill],
          [sourceSkillName, orphanSkillName],
        ),
      }),
    )

    // Act
    await screen.getByRole('button', { name: /^Delete$/ }).click()

    // Assert
    await expect.poll(() => mockSkillsDeleteSkills.mock.calls.length).toBe(1)
    expect(mockClearOrphanSymlinks).not.toHaveBeenCalled()
    expect(store.getState().skills.selectedSkillNames).toEqual([
      sourceSkillName,
      orphanSkillName,
    ])
    await expect
      .element(screen.getByText('2 selected', { exact: true }))
      .toBeVisible()
    expect(mockRefreshAllData).toHaveBeenCalledTimes(1)
  })

  test('restores orphan-only selection and refreshes when reviewed orphan cleanup rejects', async () => {
    const { screen, store } = await renderMainContent()
    const { setBulkConfirm } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills, toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const orphanSkillName = toSkillName('abandoned')
    const orphanSkill: Skill = {
      name: orphanSkillName,
      description: '',
      path: toAbsolutePath('/Users/me/.agents/skills/abandoned'),
      symlinkCount: toSymlinkCount(0),
      symlinks: [
        {
          agentId: 'devin',
          agentName: 'Devin' as never,
          linkPath: toAbsolutePath('/Users/me/.config/devin/skills/abandoned'),
          targetPath: toAbsolutePath('/Users/me/.agents/skills/abandoned'),
          status: 'broken',
          isLocal: false,
        },
      ],
      isSource: false,
      isOrphan: true,
    }
    mockClearOrphanSymlinks.mockRejectedValueOnce(new Error('Disk offline'))

    // Arrange
    store.dispatch(fetchSkills.fulfilled([orphanSkill], 'req-id'))
    store.dispatch(toggleSelection(orphanSkillName))
    store.dispatch(
      setBulkConfirm({
        kind: 'delete',
        origin: 'selection',
        skillNames: [orphanSkillName],
        agentId: null,
        agentName: null,
        sourceSummary: null,
        ...partitionGlobalDeleteTargets([orphanSkill], [orphanSkillName]),
      }),
    )

    // Act
    await screen.getByRole('button', { name: /^Delete$/ }).click()

    // Assert
    await expect.poll(() => mockClearOrphanSymlinks.mock.calls.length).toBe(1)
    expect(store.getState().skills.selectedSkillNames).toEqual([
      orphanSkillName,
    ])
    await expect
      .element(screen.getByText('1 selected', { exact: true }))
      .toBeVisible()
    expect(mockRefreshAllData).toHaveBeenCalledTimes(1)
  })

  test('does not count stale orphan rows as cleanup-ready in delete confirmation', async () => {
    const { screen, store } = await renderMainContent()
    const { setBulkConfirm } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const orphanSkillName = toSkillName('stale-abandoned')
    const staleOrphanSkill: Skill = {
      name: orphanSkillName,
      description: '',
      path: toAbsolutePath('/Users/me/.agents/skills/stale-abandoned'),
      symlinkCount: toSymlinkCount(0),
      symlinks: [
        {
          agentId: 'devin',
          agentName: 'Devin' as never,
          linkPath: toAbsolutePath(
            '/Users/me/.config/devin/skills/stale-abandoned',
          ),
          status: 'broken',
          isLocal: false,
        },
      ],
      isSource: false,
      isOrphan: true,
    }

    // Arrange
    store.dispatch(fetchSkills.fulfilled([staleOrphanSkill], 'req-id'))
    store.dispatch(
      setBulkConfirm({
        kind: 'delete',
        origin: 'selection',
        skillNames: [orphanSkillName],
        agentId: null,
        agentName: null,
        sourceSummary: null,
        ...partitionGlobalDeleteTargets([staleOrphanSkill], [orphanSkillName]),
      }),
    )

    // Assert
    await expect
      .element(
        screen.getByText(
          'No selected orphan skills are cleanup-ready. 1 orphan skill needs a rescan before cleanup because the reviewed target identity is missing.',
        ),
      )
      .toBeVisible()
    await expect
      .element(screen.getByRole('button', { name: /^Delete$/ }))
      .toBeDisabled()
    expect(
      screen
        .getByText(/removes reviewed dangling symlinks for 1 orphan skill/)
        .query(),
    ).toBeNull()
  })

  test('labels stale source rows as delete rescans, not orphan cleanup rescans', async () => {
    const { screen, store } = await renderMainContent()
    const { setBulkConfirm } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const sourceSkillName = toSkillName('source-missing-identity')
    const staleSourceSkill: Skill = {
      name: sourceSkillName,
      description: '',
      path: toAbsolutePath('/Users/me/.agents/skills/source-missing-identity'),
      symlinkCount: toSymlinkCount(0),
      symlinks: [],
      isSource: true,
      isOrphan: false,
    }

    // Arrange
    store.dispatch(fetchSkills.fulfilled([staleSourceSkill], 'req-id'))
    store.dispatch(
      setBulkConfirm({
        kind: 'delete',
        origin: 'selection',
        skillNames: [sourceSkillName],
        agentId: null,
        agentName: null,
        sourceSummary: null,
        ...partitionGlobalDeleteTargets([staleSourceSkill], [sourceSkillName]),
      }),
    )

    // Assert
    await expect
      .element(
        screen.getByText(
          'No selected skills are ready to delete. 1 selected skill needs a rescan before delete because the reviewed filesystem identity is missing.',
        ),
      )
      .toBeVisible()
    await expect
      .element(screen.getByRole('button', { name: /^Delete$/ }))
      .toBeDisabled()
    expect(screen.getByText(/orphan skill needs a rescan/).query()).toBeNull()
  })
})

describe('MainContent SkillTypeFilter dropdown options', () => {
  // Pins agent-only type filters: the dropdown is gated by `selectedAgentId`
  // (source view never offers it), and each option writes the Redux state that
  // selectors use to narrow the visible list.

  test('offers an Orphan filter marked with a destructive dot when an agent is selected', async () => {
    // Arrange
    const { screen, store } = await renderMainContent()
    const { fetchAgents } =
      await import('@/renderer/src/redux/slices/agentsSlice')
    const { selectAgent } = await import('@/renderer/src/redux/slices/uiSlice')

    store.dispatch(
      fetchAgents.fulfilled(
        [
          {
            id: 'cursor',
            name: 'Cursor',
            path: toAbsolutePath('/Users/me/.cursor/skills'),
            exists: true,
            skillCount: toSkillCount(0),
            localSkillCount: toSkillCount(0),
          },
        ],
        'req-id',
      ),
    )
    store.dispatch(selectAgent('cursor'))

    // Act
    // Open the dropdown from the agent-only skill type trigger.
    await screen
      .getByRole('button', { name: /Skill type filter: All/i })
      .click()

    // Assert
    const orphanItem = screen.getByRole('menuitemradio', { name: /Orphan/i })
    await expect.element(orphanItem).toBeInTheDocument()
    // The colored dot is a sibling span; assert the className substring is
    // present somewhere within the menu item's subtree so a future markup
    // tweak (wrapping the dot in another span, etc.) still passes.
    const orphanItemElement = orphanItem.element()
    const dot = orphanItemElement.querySelector('.bg-destructive')
    expect(
      dot,
      'Orphan menu item should contain a span with bg-destructive',
    ).not.toBeNull()
  })

  test('offers a G-Stack filter marked with a sky dot when an agent is selected', async () => {
    // Arrange
    const { screen, store } = await renderMainContent()
    const { fetchAgents } =
      await import('@/renderer/src/redux/slices/agentsSlice')
    const { selectAgent } = await import('@/renderer/src/redux/slices/uiSlice')

    store.dispatch(
      fetchAgents.fulfilled(
        [
          {
            id: 'cursor',
            name: 'Cursor',
            path: toAbsolutePath('/Users/me/.cursor/skills'),
            exists: true,
            skillCount: toSkillCount(0),
            localSkillCount: toSkillCount(0),
          },
        ],
        'req-id',
      ),
    )
    store.dispatch(selectAgent('cursor'))

    // Act
    // Open the dropdown — G-Stack sits beside Symlinked/Local as a type filter.
    await screen
      .getByRole('button', { name: /Skill type filter: All/i })
      .click()

    // Assert
    const gstackItem = screen.getByRole('menuitemradio', { name: /G-Stack/i })
    await expect.element(gstackItem).toBeInTheDocument()
    const dot = gstackItem.element().querySelector('.bg-gstack')
    expect(
      dot,
      'G-Stack menu item should contain a span with bg-gstack',
    ).not.toBeNull()
  })

  test('offers a Unique filter marked with a violet dot and a discoverability hint when an agent is selected', async () => {
    // Arrange
    const { screen, store } = await renderMainContent()
    const { fetchAgents } =
      await import('@/renderer/src/redux/slices/agentsSlice')
    const { selectAgent } = await import('@/renderer/src/redux/slices/uiSlice')

    store.dispatch(
      fetchAgents.fulfilled(
        [
          {
            id: 'cursor',
            name: 'Cursor',
            path: toAbsolutePath('/Users/me/.cursor/skills'),
            exists: true,
            skillCount: toSkillCount(0),
            localSkillCount: toSkillCount(0),
          },
        ],
        'req-id',
      ),
    )
    store.dispatch(selectAgent('cursor'))

    // Act
    // Open the dropdown — Unique is the single-agent skill type filter.
    await screen
      .getByRole('button', { name: /Skill type filter: All/i })
      .click()

    // Assert
    const uniqueItem = screen.getByRole('menuitemradio', { name: /Unique/i })
    await expect.element(uniqueItem).toBeInTheDocument()
    const uniqueItemElement = uniqueItem.element()
    const dot = uniqueItemElement.querySelector('.bg-violet-400')
    expect(
      dot,
      'Unique menu item should contain a span with bg-violet-400',
    ).not.toBeNull()
    // The hint makes the opaque "Unique" label discoverable on hover.
    expect(uniqueItemElement.getAttribute('title')).toBe(
      'Available to only one agent',
    )
  })

  test('narrows the visible list to only single-agent skills when the Unique filter is chosen', async () => {
    // Arrange
    const { screen, store } = await renderMainContent()
    const { fetchAgents } =
      await import('@/renderer/src/redux/slices/agentsSlice')
    const { selectAgent } = await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')

    // A skill available to exactly one agent (a lone valid slot in cursor).
    const uniqueSkill: Skill = {
      name: toSkillName('cursor-unique'),
      description: '',
      path: toAbsolutePath('/skills/cursor-unique'),
      symlinkCount: toSymlinkCount(1),
      symlinks: [
        {
          agentId: 'cursor',
          agentName: 'Cursor',
          linkPath: toAbsolutePath('/cursor/skills/cursor-unique'),
          targetPath: toAbsolutePath('/skills/cursor-unique'),
          status: 'valid',
          isLocal: false,
        },
      ],
      isSource: true,
      isOrphan: false,
    }
    // A skill shared by two agents — visible in the cursor view, but NOT unique.
    const sharedSkill: Skill = {
      name: toSkillName('shared-two'),
      description: '',
      path: toAbsolutePath('/skills/shared-two'),
      symlinkCount: toSymlinkCount(2),
      symlinks: [
        {
          agentId: 'cursor',
          agentName: 'Cursor',
          linkPath: toAbsolutePath('/cursor/skills/shared-two'),
          targetPath: toAbsolutePath('/skills/shared-two'),
          status: 'valid',
          isLocal: false,
        },
        {
          agentId: 'codex',
          agentName: 'Codex',
          linkPath: toAbsolutePath('/codex/skills/shared-two'),
          targetPath: toAbsolutePath('/skills/shared-two'),
          status: 'valid',
          isLocal: false,
        },
      ],
      isSource: true,
      isOrphan: false,
    }

    store.dispatch(
      fetchAgents.fulfilled(
        [
          {
            id: 'cursor',
            name: 'Cursor',
            path: toAbsolutePath('/Users/me/.cursor/skills'),
            exists: true,
            skillCount: toSkillCount(0),
            localSkillCount: toSkillCount(0),
          },
        ],
        'req-id',
      ),
    )
    store.dispatch(selectAgent('cursor'))
    store.dispatch(fetchSkills.fulfilled([uniqueSkill, sharedSkill], 'req-id'))

    // Act
    await screen
      .getByRole('button', { name: /Skill type filter: All/i })
      .click()
    await screen.getByRole('menuitemradio', { name: /Unique/i }).click()

    // Assert
    // Slice state — single source of truth that the selector reads from.
    expect(store.getState().ui.skillTypeFilter).toBe('unique')

    // Selector view — only the single-agent skill survives the filter.
    const { selectFilteredSkills } =
      await import('@/renderer/src/redux/selectors')
    const filtered = selectFilteredSkills(store.getState() as never)
    expect(filtered.map((skill) => skill.name)).toEqual(['cursor-unique'])
  })

  test('narrows the visible list to only orphan skills when the Orphan filter is chosen', async () => {
    // Arrange
    const { screen, store } = await renderMainContent()
    const { fetchAgents } =
      await import('@/renderer/src/redux/slices/agentsSlice')
    const { selectAgent } = await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')

    const orphanSkill: Skill = {
      name: toSkillName('orphan-one'),
      description: '',
      path: toAbsolutePath('/skills/orphan-one'),
      symlinkCount: toSymlinkCount(1),
      symlinks: [
        {
          agentId: 'cursor',
          agentName: 'Cursor',
          linkPath: toAbsolutePath('/cursor/skills/orphan-one'),
          targetPath: toAbsolutePath('/skills/orphan-one'),
          status: 'broken',
          isLocal: false,
        },
      ],
      isSource: false,
      isOrphan: true,
    }
    const linkedSkill: Skill = {
      name: toSkillName('linked-one'),
      description: '',
      path: toAbsolutePath('/skills/linked-one'),
      filesystemIdentity: directoryIdentity,
      symlinkCount: toSymlinkCount(1),
      symlinks: [
        {
          agentId: 'cursor',
          agentName: 'Cursor',
          linkPath: toAbsolutePath('/cursor/skills/linked-one'),
          targetPath: toAbsolutePath('/skills/linked-one'),
          status: 'valid',
          isLocal: false,
        },
      ],
      isSource: true,
      isOrphan: false,
    }

    store.dispatch(
      fetchAgents.fulfilled(
        [
          {
            id: 'cursor',
            name: 'Cursor',
            path: toAbsolutePath('/Users/me/.cursor/skills'),
            exists: true,
            skillCount: toSkillCount(0),
            localSkillCount: toSkillCount(0),
          },
        ],
        'req-id',
      ),
    )
    store.dispatch(selectAgent('cursor'))
    store.dispatch(fetchSkills.fulfilled([orphanSkill, linkedSkill], 'req-id'))

    // Act
    await screen
      .getByRole('button', { name: /Skill type filter: All/i })
      .click()
    await screen.getByRole('menuitemradio', { name: /Orphan/i }).click()

    // Assert
    // Slice state — single source of truth that the selector reads from.
    expect(store.getState().ui.skillTypeFilter).toBe('orphan')

    // Selector view — the filtered list now contains only the orphan.
    const { selectFilteredSkills } =
      await import('@/renderer/src/redux/selectors')
    const filtered = selectFilteredSkills(store.getState() as never)
    expect(filtered.map((skill) => skill.name)).toEqual(['orphan-one'])
  })

  test('keeps the dropdown open and reveals Clear excludes when a type is excluded', async () => {
    // Arrange
    const { screen, store } = await renderMainContent()
    const { fetchAgents } =
      await import('@/renderer/src/redux/slices/agentsSlice')
    const { selectAgent } = await import('@/renderer/src/redux/slices/uiSlice')

    store.dispatch(
      fetchAgents.fulfilled(
        [
          {
            id: 'cursor',
            name: 'Cursor',
            path: toAbsolutePath('/Users/me/.cursor/skills'),
            exists: true,
            skillCount: toSkillCount(0),
            localSkillCount: toSkillCount(0),
          },
        ],
        'req-id',
      ),
    )
    store.dispatch(selectAgent('cursor'))

    // Act
    await screen
      .getByRole('button', { name: /Skill type filter: All/i })
      .click()
    await screen.getByRole('menuitemcheckbox', { name: /Local/i }).click()

    // Assert
    expect(store.getState().ui.excludedSkillTypeFilters).toEqual(['local'])
    await expect
      .element(screen.getByRole('menuitem', { name: /Clear excludes/i }))
      .toBeInTheDocument()
  })
})

describe('MainContent repo facet dropdown', () => {
  test('filters by a repository when its source-count option is picked', async () => {
    // Arrange
    const { screen, store } = await renderMainContent()
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')

    store.dispatch(
      fetchSkills.fulfilled(
        [
          makeSourceSkill('alpha', 'vercel-labs/skills'),
          makeSourceSkill('beta', 'vercel-labs/skills'),
          makeSourceSkill('gamma', 'pbakaus/impeccable'),
        ],
        'req-id',
      ),
    )

    // Act
    await screen
      .getByRole('button', { name: /Filter by source repository/i })
      .click()
    await screen
      .getByRole('menuitemcheckbox', {
        name: /pbakaus\/impeccable, 1 skill/i,
      })
      .click()

    // Assert
    expect(store.getState().ui.selectedSources).toEqual([
      repositoryId('pbakaus/impeccable'),
    ])
  })
})

describe('MainContent filter pills (Agent + Source orthogonal)', () => {
  // The Agent pill and the Source pill are independent narrowings — the user
  // can be in "agent: Claude Code" view AND filter by "from: vercel-labs/foo"
  // simultaneously. These tests pin the contract: each pill renders only
  // when its own state is set, and clearing one does not touch the other.

  test('shows a Source pill naming the repo and hides it again when the pill is cleared', async () => {
    // Arrange
    const { screen, store } = await renderMainContent()
    const { setSelectedSources } =
      await import('@/renderer/src/redux/slices/uiSlice')

    // No source filter active: pill must not render.
    expect(screen.getByTestId('source-filter-pill').query()).toBeNull()

    // Act — turn on the source filter
    store.dispatch(setSelectedSources([repositoryId('vercel-labs/skills')]))

    // Assert — the pill appears, naming the repo
    const pill = screen.getByTestId('source-filter-pill')
    await expect.element(pill).toBeInTheDocument()
    await expect.element(pill).toMatchTextContent(/from/)
    await expect.element(pill).toMatchTextContent('vercel-labs/skills')

    // Act — clear the filter via the pill's Clear button
    // Clear button inside the pill resets the slice field.
    await pill.getByRole('button', { name: /Clear/i }).click()

    // Assert — filter is empty and the pill is gone
    await expect.poll(() => store.getState().ui.selectedSources).toEqual([])
    expect(screen.getByTestId('source-filter-pill').query()).toBeNull()
  })

  test('shows both the Agent and Source pills when an agent and a source are filtered together', async () => {
    // Arrange
    const { screen, store } = await renderMainContent()
    const { fetchAgents } =
      await import('@/renderer/src/redux/slices/agentsSlice')
    const { selectAgent, setSelectedSources } =
      await import('@/renderer/src/redux/slices/uiSlice')

    // Seed an agent fixture so MainContent's `agents.find(...)` resolves.
    store.dispatch(
      fetchAgents.fulfilled(
        [
          {
            id: 'claude-code',
            name: 'Claude Code',
            path: toAbsolutePath('/Users/me/.claude/skills'),
            exists: true,
            skillCount: toSkillCount(0),
            localSkillCount: toSkillCount(0),
          },
        ],
        'req-id',
      ),
    )

    // Act
    store.dispatch(selectAgent('claude-code'))
    store.dispatch(setSelectedSources([repositoryId('vercel-labs/skills')]))

    // Assert
    await expect
      .element(screen.getByTestId('agent-filter-pill'))
      .toMatchTextContent('Claude Code')
    await expect
      .element(screen.getByTestId('source-filter-pill'))
      .toMatchTextContent('vercel-labs/skills')
  })

  test('keeps the Agent pill and agent filter when only the Source pill is cleared', async () => {
    // Arrange
    const { screen, store } = await renderMainContent()
    const { fetchAgents } =
      await import('@/renderer/src/redux/slices/agentsSlice')
    const { selectAgent, setSelectedSources } =
      await import('@/renderer/src/redux/slices/uiSlice')

    store.dispatch(
      fetchAgents.fulfilled(
        [
          {
            id: 'claude-code',
            name: 'Claude Code',
            path: toAbsolutePath('/Users/me/.claude/skills'),
            exists: true,
            skillCount: toSkillCount(0),
            localSkillCount: toSkillCount(0),
          },
        ],
        'req-id',
      ),
    )
    store.dispatch(selectAgent('claude-code'))
    store.dispatch(setSelectedSources([repositoryId('vercel-labs/skills')]))

    // Act
    // Clear ONLY the source pill.
    await screen
      .getByTestId('source-filter-pill')
      .getByRole('button', { name: /Clear/i })
      .click()

    // Assert
    // Agent pill must still be rendered with its label intact; selectedSources
    // must be empty. This pins Issue 4 from the design review: source clear
    // does not bleed into agent state.
    await expect.poll(() => store.getState().ui.selectedSources).toEqual([])
    expect(store.getState().ui.selectedAgentId).toBe('claude-code')
    await expect
      .element(screen.getByTestId('agent-filter-pill'))
      .toMatchTextContent('Claude Code')
  })
})

describe('MainContent hidden-locals caveat', () => {
  // The repo include-filter hides source-less local skills. This inline caveat
  // tells the user how many were dropped so an empty-looking list is explained.

  test('shows "N local skills hidden" when the repo filter suppresses source-less locals', async () => {
    // Arrange — cursor view with one repo skill and two source-less locals
    const { screen, store } = await renderMainContent()
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const { selectAgent, setSelectedSources } =
      await import('@/renderer/src/redux/slices/uiSlice')
    store.dispatch(
      fetchSkills.fulfilled(
        [
          makeSourceSkill('repo-skill', 'vercel-labs/skills'),
          makeAgentLocalSkill('local-one', 'cursor'),
          makeAgentLocalSkill('local-two', 'cursor'),
        ],
        'req-id',
      ),
    )
    store.dispatch(selectAgent('cursor'))

    // Act — turn on the repo include-filter
    store.dispatch(setSelectedSources([repositoryId('vercel-labs/skills')]))

    // Assert — both suppressed locals are reported, pluralized
    await expect
      .element(screen.getByText(/2 local skills hidden/))
      .toBeInTheDocument()
  })

  test('omits the caveat when no repo filter is active', async () => {
    // Arrange — same source-less locals in the cursor view, filter left empty
    const { screen, store } = await renderMainContent()
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const { selectAgent } = await import('@/renderer/src/redux/slices/uiSlice')
    store.dispatch(
      fetchSkills.fulfilled(
        [
          makeAgentLocalSkill('local-one', 'cursor'),
          makeAgentLocalSkill('local-two', 'cursor'),
        ],
        'req-id',
      ),
    )
    store.dispatch(selectAgent('cursor'))

    // Anchor on the always-rendered trigger so the toolbar is known to be live…
    await expect
      .element(
        screen.getByRole('button', { name: /Filter by source repository/i }),
      )
      .toBeInTheDocument()

    // Assert — …then confirm the caveat is absent with nothing filtered out
    expect(screen.getByText(/local skills hidden/).query()).toBeNull()
  })
})

describe('MainContent toolbar quick actions', () => {
  // The sort toggle moved into the list header; its MainContent-level test
  // lives in MainContent.listHeader.browser.test.tsx with the real header.
  test('switches to the Marketplace tab and clears any open skill preview', async () => {
    // Arrange
    const { screen, store } = await renderMainContent()
    const { setPreviewSkill } =
      await import('@/renderer/src/redux/slices/marketplaceSlice')
    store.dispatch(
      setPreviewSkill({
        rank: toSkillRank(1),
        name: toSkillName('task'),
        repo: repositoryId('vercel-labs/skills'),
        url: toHttpUrl('https://skills.sh/task'),
      }),
    )

    // Act
    await screen.getByRole('tab', { name: /^Marketplace$/ }).click()

    // Assert
    expect(store.getState().ui.activeTab).toBe('marketplace')
    expect(store.getState().marketplace.previewSkill).toBeNull()
  })
})

describe('MainContent filter pill clear actions', () => {
  test('clears the agent filter when the user clears the agent pill', async () => {
    // Arrange
    const { screen, store } = await renderMainContent()
    const { fetchAgents } =
      await import('@/renderer/src/redux/slices/agentsSlice')
    const { selectAgent } = await import('@/renderer/src/redux/slices/uiSlice')
    store.dispatch(
      fetchAgents.fulfilled(
        [
          {
            id: 'cursor',
            name: 'Cursor',
            path: toAbsolutePath('/Users/me/.cursor/skills'),
            exists: true,
            skillCount: toSkillCount(0),
            localSkillCount: toSkillCount(0),
          },
        ],
        'req-id',
      ),
    )
    store.dispatch(selectAgent('cursor'))

    // Act
    await screen
      .getByTestId('agent-filter-pill')
      .getByRole('button', { name: /Clear/i })
      .click()

    // Assert
    expect(store.getState().ui.selectedAgentId).toBeNull()
    expect(screen.getByTestId('agent-filter-pill').query()).toBeNull()
  })

  test('clears every source when the collapsed multi-repo pill is cleared', async () => {
    // Arrange
    // Selecting more than SOURCE_FILTER_MAX_VISIBLE_REPOS (3) repos collapses the
    // individual pills into one "N repos" pill whose Clear wipes the whole set.
    const { screen, store } = await renderMainContent()
    const { setSelectedSources } =
      await import('@/renderer/src/redux/slices/uiSlice')
    store.dispatch(
      setSelectedSources([
        repositoryId('org/repo-one'),
        repositoryId('org/repo-two'),
        repositoryId('org/repo-three'),
        repositoryId('org/repo-four'),
      ]),
    )
    await expect
      .element(screen.getByTestId('source-filter-pill'))
      .toMatchTextContent('4 repos')

    // Act
    await screen
      .getByTestId('source-filter-pill')
      .getByRole('button', { name: /Clear/i })
      .click()

    // Assert
    await expect.poll(() => store.getState().ui.selectedSources).toEqual([])
    expect(screen.getByTestId('source-filter-pill').query()).toBeNull()
  })
})

describe('MainContent repo facet bulk shortcuts', () => {
  test('clears the include filter when the user picks "Show all repos"', async () => {
    // Arrange
    const { screen, store } = await renderMainContent()
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const { setSelectedSources } =
      await import('@/renderer/src/redux/slices/uiSlice')
    store.dispatch(
      fetchSkills.fulfilled(
        [
          makeSourceSkill('alpha', 'vercel-labs/skills'),
          makeSourceSkill('gamma', 'pbakaus/impeccable'),
        ],
        'req-id',
      ),
    )
    store.dispatch(setSelectedSources([repositoryId('vercel-labs/skills')]))

    // Act
    // One repo selected flips the trigger aria-label to "Filtering by …".
    await screen.getByRole('button', { name: /source repositor/i }).click()
    await screen.getByRole('menuitem', { name: /Show all repos/i }).click()

    // Assert
    await expect.poll(() => store.getState().ui.selectedSources).toEqual([])
  })

  test('ticks every facet repo when the user picks "Select all repos"', async () => {
    // Arrange
    const { screen, store } = await renderMainContent()
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    store.dispatch(
      fetchSkills.fulfilled(
        [
          makeSourceSkill('alpha', 'vercel-labs/skills'),
          makeSourceSkill('gamma', 'pbakaus/impeccable'),
        ],
        'req-id',
      ),
    )

    // Act
    await screen
      .getByRole('button', { name: /Filter by source repository/i })
      .click()
    await screen.getByRole('menuitem', { name: /Select all repos/i }).click()

    // Assert
    await expect
      .poll(() => [...store.getState().ui.selectedSources].sort())
      .toEqual(
        [
          repositoryId('pbakaus/impeccable'),
          repositoryId('vercel-labs/skills'),
        ].sort(),
      )
  })
})

describe('MainContent skill-type exclude toggles', () => {
  /**
   * Seed a single Cursor agent and select it so the agent-only skill-type
   * filter dropdown (with its Exclude checkboxes) is rendered.
   * @returns Browser screen + store with the cursor agent selected.
   */
  async function renderWithCursorAgentSelected() {
    const { screen, store } = await renderMainContent()
    const { fetchAgents } =
      await import('@/renderer/src/redux/slices/agentsSlice')
    const { selectAgent } = await import('@/renderer/src/redux/slices/uiSlice')
    store.dispatch(
      fetchAgents.fulfilled(
        [
          {
            id: 'cursor',
            name: 'Cursor',
            path: toAbsolutePath('/Users/me/.cursor/skills'),
            exists: true,
            skillCount: toSkillCount(0),
            localSkillCount: toSkillCount(0),
          },
        ],
        'req-id',
      ),
    )
    store.dispatch(selectAgent('cursor'))
    return { screen, store }
  }

  test('excludes Symlinked skills when its exclude checkbox is ticked', async () => {
    // Arrange
    const { screen, store } = await renderWithCursorAgentSelected()

    // Act
    await screen
      .getByRole('button', { name: /Skill type filter: All/i })
      .click()
    await screen.getByRole('menuitemcheckbox', { name: /^Symlinked$/i }).click()

    // Assert
    expect(store.getState().ui.excludedSkillTypeFilters).toEqual(['symlinked'])
  })

  test('excludes G-Stack skills when its exclude checkbox is ticked', async () => {
    // Arrange
    const { screen, store } = await renderWithCursorAgentSelected()

    // Act
    await screen
      .getByRole('button', { name: /Skill type filter: All/i })
      .click()
    await screen.getByRole('menuitemcheckbox', { name: /^G-Stack$/i }).click()

    // Assert
    expect(store.getState().ui.excludedSkillTypeFilters).toEqual(['gstack'])
  })

  test('excludes Orphan skills when its exclude checkbox is ticked', async () => {
    // Arrange
    const { screen, store } = await renderWithCursorAgentSelected()

    // Act
    await screen
      .getByRole('button', { name: /Skill type filter: All/i })
      .click()
    await screen.getByRole('menuitemcheckbox', { name: /^Orphan$/i }).click()

    // Assert
    expect(store.getState().ui.excludedSkillTypeFilters).toEqual(['orphan'])
  })

  test('clears all excludes when the user picks "Clear excludes"', async () => {
    // Arrange
    const { screen, store } = await renderWithCursorAgentSelected()
    const { toggleExcludedSkillTypeFilter } =
      await import('@/renderer/src/redux/slices/uiSlice')
    store.dispatch(toggleExcludedSkillTypeFilter('local'))
    expect(store.getState().ui.excludedSkillTypeFilters).toEqual(['local'])

    // Act
    await screen
      .getByRole('button', { name: /Skill type filter:.*excluding/i })
      .click()
    await screen.getByRole('menuitem', { name: /Clear excludes/i }).click()

    // Assert
    await expect
      .poll(() => store.getState().ui.excludedSkillTypeFilters)
      .toEqual([])
  })
})

describe('MainContent bulk copy action', () => {
  test('opens the bulk copy-to-agents modal from the global list header', async () => {
    // Arrange — the list header's Copy action runs MainContent's real handler.
    mockListHeaderState.enabled = true
    const { screen, store } = await renderMainContent()
    const { fetchSkills, toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    store.dispatch(
      fetchSkills.fulfilled([makeSourceSkill('alpha', 'org/repo')], 'req-id'),
    )
    store.dispatch(toggleSelection(toSkillName('alpha')))

    // Act
    await screen.getByRole('button', { name: 'Open bulk copy' }).click()

    // Assert
    expect(store.getState().skills.bulkCopyModalOpen).toBe(true)
  })
})

describe('MainContent delete progress wiring', () => {
  test('mirrors main-process delete progress into Redux', async () => {
    // Arrange — capture the progress callback MainContent subscribes on mount.
    const { store } = await renderMainContent()
    const progressCallback = mockOnDeleteProgress.mock.calls.at(-1)?.[0]
    expect(typeof progressCallback).toBe('function')

    // Act
    progressCallback?.({
      current: toBatchItemIndex(3),
      total: toBatchItemCount(12),
    })

    // Assert
    expect(store.getState().skills.bulkProgress).toEqual({
      current: 3,
      total: 12,
    })
  })
})

describe('MainContent stale-source delete summary', () => {
  test('names the rescan-needed source row in the undo summary after a partial delete', async () => {
    // Arrange — one deletable source row plus one stale (identity-less) source
    // row, so the delete succeeds for one and the summary appends rescan guidance.
    const { screen, store } = await renderMainContent()
    const { setBulkConfirm } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const deletableName = toSkillName('fresh-source')
    const staleName = toSkillName('stale-source')
    const deletableSkill: Skill = {
      name: deletableName,
      description: '',
      path: toAbsolutePath('/Users/me/.agents/skills/fresh-source'),
      filesystemIdentity: directoryIdentity,
      symlinkCount: toSymlinkCount(0),
      symlinks: [],
      isSource: true,
      isOrphan: false,
    }
    const staleSkill: Skill = {
      name: staleName,
      description: '',
      path: toAbsolutePath('/Users/me/.agents/skills/stale-source'),
      symlinkCount: toSymlinkCount(0),
      symlinks: [],
      isSource: true,
      isOrphan: false,
    }
    mockSkillsDeleteSkills.mockResolvedValue({
      items: [
        {
          skillName: deletableName,
          outcome: 'deleted',
          tombstoneId: tombstoneId('1729180800000-fresh-source-a1b2c3d4'),
          symlinksRemoved: toSymlinkCount(0),
          cascadeAgents: [],
        },
      ],
    } satisfies BulkDeleteResult)
    store.dispatch(
      fetchSkills.fulfilled([deletableSkill, staleSkill], 'req-id'),
    )
    store.dispatch(
      setBulkConfirm({
        kind: 'delete',
        origin: 'selection',
        skillNames: [deletableName, staleName],
        agentId: null,
        agentName: null,
        sourceSummary: null,
        ...partitionGlobalDeleteTargets(
          [deletableSkill, staleSkill],
          [deletableName, staleName],
        ),
      }),
    )

    // Act
    await screen.getByRole('button', { name: /^Delete$/ }).click()

    // Assert
    await expect.poll(() => mockSkillsDeleteSkills.mock.calls.length).toBe(1)
    await expect
      .poll(() => store.getState().ui.undoToast?.summary)
      .toContain('1 selected skill needs a rescan before delete.')
  })
})

describe('MainContent undo bulk delete', () => {
  /**
   * Run a successful bulk delete with N tombstones, then return the live
   * `onUndo` callback MainContent handed to the (mocked-away) UndoToast.
   * @param tombstoneIds - Tombstone ids the deleted rows resolve to.
   * @returns The captured onUndo callback plus the store for assertions.
   */
  async function deleteAndCaptureOnUndo(
    tombstoneIds: ReturnType<typeof tombstoneId>[],
  ) {
    // The sonner `toast` mock is module-level and accumulates calls across the
    // whole file. Clear it so the captured onUndo belongs to THIS test's mounted
    // MainContent (and store), not an earlier delete that left a stale toast.
    vi.mocked(toast).mockClear()
    vi.mocked(toast.success).mockClear()
    vi.mocked(toast.info).mockClear()
    vi.mocked(toast.error).mockClear()
    const { screen, store } = await renderMainContent()
    const { setBulkConfirm } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const skills: Skill[] = tombstoneIds.map((_, index) => ({
      name: toSkillName(`undo-skill-${index}`),
      description: '',
      path: `/Users/me/.agents/skills/undo-skill-${index}` as never,
      filesystemIdentity: directoryIdentity,
      symlinkCount: toSymlinkCount(0),
      symlinks: [],
      isSource: true,
      isOrphan: false,
    }))
    const skillNames = skills.map((skill) => skill.name)
    mockSkillsDeleteSkills.mockResolvedValue({
      items: skills.map((skill, index) => ({
        skillName: skill.name,
        outcome: 'deleted',
        tombstoneId: tombstoneIds[index],
        symlinksRemoved: toSymlinkCount(0),
        cascadeAgents: [],
      })),
    } satisfies BulkDeleteResult)
    store.dispatch(fetchSkills.fulfilled(skills, 'req-id'))
    store.dispatch(
      setBulkConfirm({
        kind: 'delete',
        origin: 'selection',
        skillNames,
        agentId: null,
        agentName: null,
        sourceSummary: null,
        ...partitionGlobalDeleteTargets(skills, skillNames),
      }),
    )
    await screen.getByRole('button', { name: /^Delete$/ }).click()
    await expect.poll(() => mockSkillsDeleteSkills.mock.calls.length).toBe(1)

    // The undo toast is rendered via the mocked `toast(<UndoToast/>)`; pull the
    // onUndo prop off the React element passed to that mock to drive restore.
    await expect
      .poll(() => vi.mocked(toast).mock.calls.some(isUndoToastCall))
      .toBe(true)
    const undoToastCall = vi.mocked(toast).mock.calls.find(isUndoToastCall)
    const onUndo: (ids: ReturnType<typeof tombstoneId>[]) => Promise<void> =
      undoToastCall![0].props.onUndo
    return { onUndo, store }
  }

  test('toasts a full-success message and clears the undo toast when every row restores', async () => {
    // Arrange
    const onlyTombstone = tombstoneId('1729180800000-undo-skill-0-a1b2c3d4')
    const { onUndo, store } = await deleteAndCaptureOnUndo([onlyTombstone])
    mockRestoreDeletedSkill.mockResolvedValue({
      outcome: 'restored',
      symlinksRestored: 0,
      symlinksSkipped: 0,
    })

    // Act
    await onUndo([onlyTombstone])

    // Assert
    expect(vi.mocked(toast.success)).toHaveBeenCalledWith('Restored 1 skill.')
    await expect.poll(() => store.getState().ui.undoToast).toBeNull()
    expect(mockRefreshAllData).toHaveBeenCalled()
  })

  test('toasts a partial-restore message when some rows fail to restore', async () => {
    // Arrange — two tombstones; first restores, second rejects at the IPC.
    const firstTombstone = tombstoneId('1729180800000-undo-skill-0-a1b2c3d4')
    const secondTombstone = tombstoneId('1729180800000-undo-skill-1-e5f6a7b8')
    const { onUndo } = await deleteAndCaptureOnUndo([
      firstTombstone,
      secondTombstone,
    ])
    mockRestoreDeletedSkill
      .mockResolvedValueOnce({
        outcome: 'restored',
        symlinksRestored: 0,
        symlinksSkipped: 0,
      })
      .mockRejectedValueOnce(new Error('Disk offline'))

    // Act
    await onUndo([firstTombstone, secondTombstone])

    // Assert
    expect(vi.mocked(toast.info)).toHaveBeenCalledWith(
      'Restored 1 of 2 skills.',
    )
  })

  test('toasts a restore-failed message when the undo dispatch rejects', async () => {
    // Arrange — capture the live onUndo, then drive the defensive rejection
    // branch (the undo thunk rejects when handed a non-iterable id list).
    const onlyTombstone = tombstoneId('1729180800000-undo-skill-0-a1b2c3d4')
    const { onUndo } = await deleteAndCaptureOnUndo([onlyTombstone])

    // Act
    await onUndo(null as never)

    // Assert
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      'Restore failed',
      expect.objectContaining({ description: expect.any(String) }),
    )
  })
})

describe('MainContent list header primary action guards', () => {
  test('does nothing when the header primary action fires with no rows selected', async () => {
    // Arrange — nothing is selected, so the header's primary action must
    // early-return without opening any confirmation dialog.
    mockListHeaderState.enabled = true
    const { screen, store } = await renderMainContent()

    // Act
    await screen.getByRole('button', { name: 'Open bulk confirm' }).click()

    // Assert
    expect(store.getState().ui.bulkConfirm).toBeNull()
  })

  test('does nothing when only protected rows are selected in agent view', async () => {
    // Arrange — the row is visible and selected, but protection excludes it from
    // agent-view bulk unlink candidates before the confirm dialog can open.
    mockListHeaderState.enabled = true
    const { screen, store } = await renderMainContent()
    const { fetchAgents } =
      await import('@/renderer/src/redux/slices/agentsSlice')
    const { selectAgent } = await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills, toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const { addProtection } =
      await import('@/renderer/src/redux/slices/protectSlice')
    const skillName = toSkillName('protected-link')
    const protectedSkill: Skill = {
      name: skillName,
      description: '',
      path: toAbsolutePath('/home/user/.agents/skills/protected-link'),
      filesystemIdentity: directoryIdentity,
      symlinkCount: toSymlinkCount(1),
      symlinks: [
        {
          agentId: 'cursor',
          agentName: 'Cursor',
          linkPath: toAbsolutePath('/home/user/.cursor/skills/protected-link'),
          targetPath: toAbsolutePath(
            '/home/user/.agents/skills/protected-link',
          ),
          status: 'valid',
          isLocal: false,
        },
      ],
      isSource: true,
      isOrphan: false,
    }
    store.dispatch(
      fetchAgents.fulfilled(
        [
          {
            id: 'cursor',
            name: 'Cursor',
            path: toAbsolutePath('/home/user/.cursor/skills'),
            exists: true,
            skillCount: toSkillCount(1),
            localSkillCount: toSkillCount(0),
          },
        ],
        'req-agent',
      ),
    )
    store.dispatch(selectAgent('cursor'))
    store.dispatch(fetchSkills.fulfilled([protectedSkill], 'req-protected'))
    store.dispatch(toggleSelection(skillName))
    store.dispatch(addProtection({ name: skillName }))

    // Act
    await screen.getByRole('button', { name: 'Open bulk confirm' }).click()

    // Assert
    expect(store.getState().ui.bulkConfirm).toBeNull()
  })

  test('blocks unlink and prompts a rescan when the selected agent slot went stale', async () => {
    // Arrange — a cursor row is selectable (status valid) yet its slot lost the
    // reviewed targetPath, so buildAgentUnlinkTargets reports it stale.
    mockListHeaderState.enabled = true
    const { screen, store } = await renderMainContent()
    const { fetchAgents } =
      await import('@/renderer/src/redux/slices/agentsSlice')
    const { selectAgent } = await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills, toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const skillName = toSkillName('stale-unlink')
    const staleSkill: Skill = {
      name: skillName,
      description: '',
      path: toAbsolutePath('/home/user/.agents/skills/stale-unlink'),
      filesystemIdentity: directoryIdentity,
      symlinkCount: toSymlinkCount(1),
      symlinks: [
        {
          agentId: 'cursor',
          agentName: 'Cursor',
          linkPath: toAbsolutePath('/home/user/.cursor/skills/stale-link'),
          // Missing targetPath → buildAgentUnlinkTargets pushes it to staleNames.
          targetPath: undefined,
          status: 'valid',
          isLocal: false,
        },
      ],
      isSource: true,
      isOrphan: false,
    }
    store.dispatch(
      fetchAgents.fulfilled(
        [
          {
            id: 'cursor',
            name: 'Cursor',
            path: toAbsolutePath('/home/user/.cursor/skills'),
            exists: true,
            skillCount: toSkillCount(1),
            localSkillCount: toSkillCount(0),
          },
        ],
        'req-agent',
      ),
    )
    store.dispatch(selectAgent('cursor'))
    store.dispatch(fetchSkills.fulfilled([staleSkill], 'req-stale'))
    store.dispatch(toggleSelection(skillName))

    // Act
    await screen.getByRole('button', { name: 'Open bulk confirm' }).click()

    // Assert
    await expect
      .poll(() => vi.mocked(toast.error).mock.calls.length)
      .toBeGreaterThan(0)
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith('Bulk unlink failed', {
      description: 'Selection changed. Rescan before unlinking.',
    })
    expect(store.getState().ui.bulkConfirm).toBeNull()
    expect(mockRefreshAllData).toHaveBeenCalled()
  })
})

describe('MainContent bulk unlink result toasts', () => {
  /**
   * Render agent view, select one row, and open the unlink confirmation dialog
   * so each test only has to mock the IPC result and click Unlink.
   * @returns { screen, store } after the unlink confirm dialog is open.
   */
  async function openUnlinkConfirmForCursor() {
    mockListHeaderState.enabled = true
    const { screen, store } = await renderMainContent()
    const { fetchAgents } =
      await import('@/renderer/src/redux/slices/agentsSlice')
    const { selectAgent } = await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills, toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const skillName = toSkillName('linked-skill')
    const linkedSkill: Skill = {
      name: skillName,
      description: '',
      path: toAbsolutePath('/home/user/.agents/skills/linked-skill'),
      filesystemIdentity: directoryIdentity,
      symlinkCount: toSymlinkCount(1),
      symlinks: [
        {
          agentId: 'cursor',
          agentName: 'Cursor',
          linkPath: toAbsolutePath('/home/user/.cursor/skills/linked-link'),
          targetPath: toAbsolutePath('/home/user/.agents/skills/linked-target'),
          status: 'valid',
          isLocal: false,
        },
      ],
      isSource: true,
      isOrphan: false,
    }
    store.dispatch(
      fetchAgents.fulfilled(
        [
          {
            id: 'cursor',
            name: 'Cursor',
            path: toAbsolutePath('/home/user/.cursor/skills'),
            exists: true,
            skillCount: toSkillCount(1),
            localSkillCount: toSkillCount(0),
          },
        ],
        'req-agent',
      ),
    )
    store.dispatch(selectAgent('cursor'))
    store.dispatch(fetchSkills.fulfilled([linkedSkill], 'req-linked'))
    store.dispatch(toggleSelection(skillName))
    await screen.getByRole('button', { name: 'Open bulk confirm' }).click()
    return { screen, store, skillName }
  }

  test('toasts a partial success summary when some rows unlink and some error', async () => {
    // Arrange — IPC returns one unlinked and one errored slot.
    const { screen } = await openUnlinkConfirmForCursor()
    mockUnlinkManyFromAgent.mockResolvedValue({
      items: [
        { skillName: 'linked-skill', outcome: 'unlinked' },
        {
          skillName: 'sibling-skill',
          outcome: 'error',
          error: { message: 'EPERM' },
        },
      ],
    })

    // Act
    await screen.getByRole('button', { name: /^Unlink$/ }).click()

    // Assert
    await expect.poll(() => vi.mocked(toast.success).mock.calls.length).toBe(1)
    expect(vi.mocked(toast.success)).toHaveBeenCalledWith(
      'Unlinked 1 of 2 skills from Cursor.',
    )
  })

  test('toasts a failure summary when every slot errors on unlink', async () => {
    // Arrange — IPC returns only error outcomes, so unlinkedCount is zero.
    const { screen } = await openUnlinkConfirmForCursor()
    mockUnlinkManyFromAgent.mockResolvedValue({
      items: [
        {
          skillName: 'linked-skill',
          outcome: 'error',
          error: { message: 'EPERM' },
        },
      ],
    })

    // Act
    await screen.getByRole('button', { name: /^Unlink$/ }).click()

    // Assert
    await expect.poll(() => vi.mocked(toast.error).mock.calls.length).toBe(1)
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith('Bulk unlink failed', {
      description: 'Unlinked 0 of 1 skill from Cursor.',
    })
  })

  test('toasts a failure when the unlink thunk rejects at the IPC boundary', async () => {
    // Arrange — the unlink IPC rejects, so the thunk does not fulfil.
    const { screen } = await openUnlinkConfirmForCursor()
    mockUnlinkManyFromAgent.mockRejectedValue(new Error('Socket closed'))

    // Act
    await screen.getByRole('button', { name: /^Unlink$/ }).click()

    // Assert
    await expect.poll(() => vi.mocked(toast.error).mock.calls.length).toBe(1)
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      'Bulk unlink failed',
      expect.objectContaining({ description: expect.any(String) }),
    )
  })
})

describe('MainContent selection hand-off after a bulk op settles', () => {
  /**
   * Build a global source skill with a reviewed directory identity, so the
   * header's Delete (and a card's own Delete) can target it.
   * @param name - Skill name, also its folder under ~/.agents/skills.
   * @returns Skill row with no agent symlinks.
   * @example makeGlobalSkill('task') // => { name: 'task', path: '/home/user/.agents/skills/task', ... }
   */
  function makeGlobalSkill(name: string): Skill {
    return {
      name: toSkillName(name),
      description: '',
      path: toAbsolutePath(`/home/user/.agents/skills/${name}`),
      filesystemIdentity: directoryIdentity,
      symlinkCount: toSymlinkCount(0),
      symlinks: [],
      isSource: true,
      isOrphan: false,
    }
  }

  /**
   * Build a skill with a valid Cursor symlink, so the header's Unlink in
   * Cursor's view can target it.
   * @param name - Skill name, also its link name under ~/.cursor/skills.
   * @returns Skill row linked into Cursor.
   * @example makeCursorLinkedSkill('task-one') // => { name: 'task-one', symlinks: [{ agentId: 'cursor', ... }], ... }
   */
  function makeCursorLinkedSkill(name: string): Skill {
    return {
      name: toSkillName(name),
      description: '',
      path: toAbsolutePath(`/home/user/.agents/skills/${name}`),
      filesystemIdentity: directoryIdentity,
      symlinkCount: toSymlinkCount(1),
      symlinks: [
        {
          agentId: 'cursor',
          agentName: 'Cursor',
          linkPath: toAbsolutePath(`/home/user/.cursor/skills/${name}`),
          targetPath: toAbsolutePath(`/home/user/.agents/skills/${name}`),
          status: 'valid',
          isLocal: false,
        },
      ],
      isSource: true,
      isOrphan: false,
    }
  }

  test('clears every tick, rows hidden by the search included, after a header Delete fully succeeds', async () => {
    // Arrange — 'task' is visible and ticked; 'other' is ticked but hidden by
    // the search, so the Delete never touches it.
    mockListHeaderState.enabled = true
    const { screen, store } = await renderMainContent()
    const { setSearchQuery } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills, toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    store.dispatch(
      fetchSkills.fulfilled(
        [makeGlobalSkill('other'), makeGlobalSkill('task')],
        'req-id',
      ),
    )
    store.dispatch(toggleSelection(toSkillName('task')))
    store.dispatch(toggleSelection(toSkillName('other')))
    store.dispatch(setSearchQuery(toSearchQuery('task')))
    mockSkillsDeleteSkills.mockResolvedValue({
      items: [
        {
          skillName: toSkillName('task'),
          outcome: 'deleted',
          tombstoneId: tombstoneId('1729180800000-task-a1b2c3d4'),
          symlinksRemoved: toSymlinkCount(0),
          cascadeAgents: [],
        },
      ],
    } satisfies BulkDeleteResult)
    await screen.getByRole('button', { name: 'Open bulk confirm' }).click()

    // Act
    await screen.getByRole('button', { name: /^Delete$/ }).click()

    // Assert
    await expect
      .element(screen.getByText('0 selected', { exact: true }))
      .toBeVisible()
    expect(store.getState().skills.selectedSkillNames).toEqual([])
    expect(mockSkillsDeleteSkills.mock.calls[0][0]).toEqual({
      items: [
        {
          skillName: 'task',
          skillPath: '/home/user/.agents/skills/task',
          filesystemIdentity: directoryIdentity,
        },
      ],
    })
  })

  test('drops a protected skip from the selection after a header Delete', async () => {
    // Arrange — global view lets a protected row stay ticked; the Delete
    // skips it and removes 'task'.
    mockListHeaderState.enabled = true
    const { screen, store } = await renderMainContent()
    const { fetchSkills, toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const { addProtection } =
      await import('@/renderer/src/redux/slices/protectSlice')
    store.dispatch(
      fetchSkills.fulfilled(
        [makeGlobalSkill('guarded'), makeGlobalSkill('task')],
        'req-id',
      ),
    )
    store.dispatch(toggleSelection(toSkillName('guarded')))
    store.dispatch(toggleSelection(toSkillName('task')))
    store.dispatch(addProtection({ name: toSkillName('guarded') }))
    mockSkillsDeleteSkills.mockResolvedValue({
      items: [
        {
          skillName: toSkillName('task'),
          outcome: 'deleted',
          tombstoneId: tombstoneId('1729180800000-task-a1b2c3d4'),
          symlinksRemoved: toSymlinkCount(0),
          cascadeAgents: [],
        },
      ],
    } satisfies BulkDeleteResult)
    await screen.getByRole('button', { name: 'Open bulk confirm' }).click()

    // Act
    await screen.getByRole('button', { name: /^Delete$/ }).click()

    // Assert
    await expect
      .element(screen.getByText('0 selected', { exact: true }))
      .toBeVisible()
    expect(store.getState().skills.selectedSkillNames).toEqual([])
    expect(mockSkillsDeleteSkills.mock.calls[0][0]).toEqual({
      items: [
        {
          skillName: 'task',
          skillPath: '/home/user/.agents/skills/task',
          filesystemIdentity: directoryIdentity,
        },
      ],
    })
  })

  test('keeps only the failed row ticked after a header Unlink partly fails', async () => {
    // Arrange — Cursor view; both 'task' rows are ticked and visible, and
    // 'other' is ticked but hidden by the search.
    mockListHeaderState.enabled = true
    const { screen, store } = await renderMainContent()
    const { fetchAgents } =
      await import('@/renderer/src/redux/slices/agentsSlice')
    const { selectAgent, setSearchQuery } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills, toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    store.dispatch(
      fetchAgents.fulfilled(
        [
          {
            id: 'cursor',
            name: 'Cursor',
            path: toAbsolutePath('/home/user/.cursor/skills'),
            exists: true,
            skillCount: toSkillCount(3),
            localSkillCount: toSkillCount(0),
          },
        ],
        'req-agent',
      ),
    )
    store.dispatch(selectAgent('cursor'))
    store.dispatch(
      fetchSkills.fulfilled(
        [
          makeCursorLinkedSkill('other'),
          makeCursorLinkedSkill('task-one'),
          makeCursorLinkedSkill('task-two'),
        ],
        'req-linked',
      ),
    )
    store.dispatch(toggleSelection(toSkillName('task-one')))
    store.dispatch(toggleSelection(toSkillName('task-two')))
    store.dispatch(toggleSelection(toSkillName('other')))
    store.dispatch(setSearchQuery(toSearchQuery('task')))
    mockUnlinkManyFromAgent.mockResolvedValue({
      items: [
        { skillName: 'task-one', outcome: 'unlinked' },
        {
          skillName: 'task-two',
          outcome: 'error',
          error: { message: 'EPERM' },
        },
      ],
    })
    await screen.getByRole('button', { name: 'Open bulk confirm' }).click()

    // Act
    await screen.getByRole('button', { name: /^Unlink$/ }).click()

    // Assert
    await expect
      .element(screen.getByText('1 selected', { exact: true }))
      .toBeVisible()
    expect(store.getState().skills.selectedSkillNames).toEqual(['task-two'])
  })

  test('keeps the attempted rows ticked when a header Unlink rejects', async () => {
    // Arrange — Cursor view; both 'task' rows are ticked and visible, and
    // 'other' is ticked but hidden by the search.
    mockListHeaderState.enabled = true
    const { screen, store } = await renderMainContent()
    const { fetchAgents } =
      await import('@/renderer/src/redux/slices/agentsSlice')
    const { selectAgent, setSearchQuery } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills, toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    store.dispatch(
      fetchAgents.fulfilled(
        [
          {
            id: 'cursor',
            name: 'Cursor',
            path: toAbsolutePath('/home/user/.cursor/skills'),
            exists: true,
            skillCount: toSkillCount(3),
            localSkillCount: toSkillCount(0),
          },
        ],
        'req-agent',
      ),
    )
    store.dispatch(selectAgent('cursor'))
    store.dispatch(
      fetchSkills.fulfilled(
        [
          makeCursorLinkedSkill('other'),
          makeCursorLinkedSkill('task-one'),
          makeCursorLinkedSkill('task-two'),
        ],
        'req-linked',
      ),
    )
    store.dispatch(toggleSelection(toSkillName('task-one')))
    store.dispatch(toggleSelection(toSkillName('task-two')))
    store.dispatch(toggleSelection(toSkillName('other')))
    store.dispatch(setSearchQuery(toSearchQuery('task')))
    mockUnlinkManyFromAgent.mockRejectedValue(new Error('Socket closed'))
    await screen.getByRole('button', { name: 'Open bulk confirm' }).click()

    // Act
    await screen.getByRole('button', { name: /^Unlink$/ }).click()

    // Assert
    await expect
      .element(screen.getByText('2 selected', { exact: true }))
      .toBeVisible()
    expect(store.getState().skills.selectedSkillNames).toEqual([
      'task-one',
      'task-two',
    ])
  })

  test('flashes every attempted row when a header Unlink rejects', async () => {
    // Arrange — Cursor view with two ticked rows; the unlink IPC rejects
    mockListHeaderState.enabled = true
    const { screen, store } = await renderMainContent()
    const { fetchAgents } =
      await import('@/renderer/src/redux/slices/agentsSlice')
    const { selectAgent } = await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills, toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    store.dispatch(
      fetchAgents.fulfilled(
        [
          {
            id: 'cursor',
            name: 'Cursor',
            path: toAbsolutePath('/home/user/.cursor/skills'),
            exists: true,
            skillCount: toSkillCount(2),
            localSkillCount: toSkillCount(0),
          },
        ],
        'req-agent',
      ),
    )
    store.dispatch(selectAgent('cursor'))
    store.dispatch(
      fetchSkills.fulfilled(
        [makeCursorLinkedSkill('task-one'), makeCursorLinkedSkill('task-two')],
        'req-linked',
      ),
    )
    store.dispatch(toggleSelection(toSkillName('task-one')))
    store.dispatch(toggleSelection(toSkillName('task-two')))
    mockUnlinkManyFromAgent.mockRejectedValue(new Error('Socket closed'))
    const flashedNames: SkillName[] = []
    const recordFlash = (
      event: WindowEventMap[typeof BULK_ITEM_FAILED_EVENT],
    ): void => {
      flashedNames.push(event.detail.skillName)
    }
    window.addEventListener(BULK_ITEM_FAILED_EVENT, recordFlash)
    onTestFinished(() => {
      window.removeEventListener(BULK_ITEM_FAILED_EVENT, recordFlash)
    })
    await screen.getByRole('button', { name: 'Open bulk confirm' }).click()

    // Act
    await screen.getByRole('button', { name: /^Unlink$/ }).click()

    // Assert — the red edge marks each row that failed, as a per-item error does
    await expect.poll(() => mockRefreshAllData.mock.calls.length).toBe(1)
    expect(flashedNames).toEqual(['task-one', 'task-two'])
  })

  test('leaves the other ticks alone after a card Delete succeeds', async () => {
    // Arrange — 'task' and 'tdd' are ticked; the card's own Delete on 'task'
    // opens the same dialog with a row origin (SkillItem's delete button).
    const { screen, store } = await renderMainContent()
    const { setBulkConfirm } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills, toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const taskSkill = makeGlobalSkill('task')
    store.dispatch(
      fetchSkills.fulfilled([taskSkill, makeGlobalSkill('tdd')], 'req-id'),
    )
    store.dispatch(toggleSelection(toSkillName('task')))
    store.dispatch(toggleSelection(toSkillName('tdd')))
    mockSkillsDeleteSkills.mockResolvedValue({
      items: [
        {
          skillName: toSkillName('task'),
          outcome: 'deleted',
          tombstoneId: tombstoneId('1729180800000-task-a1b2c3d4'),
          symlinksRemoved: toSymlinkCount(0),
          cascadeAgents: [],
        },
      ],
    } satisfies BulkDeleteResult)
    store.dispatch(
      setBulkConfirm({
        kind: 'delete',
        origin: 'row',
        skillNames: [toSkillName('task')],
        agentId: null,
        agentName: null,
        sourceSummary: null,
        ...partitionGlobalDeleteTargets([taskSkill], [toSkillName('task')]),
      }),
    )

    // Act
    await screen.getByRole('button', { name: /^Delete$/ }).click()

    // Assert — refreshAllData runs after the selection hand-off point.
    await expect.poll(() => mockRefreshAllData.mock.calls.length).toBe(1)
    expect(store.getState().skills.selectedSkillNames).toEqual(['tdd'])
    await expect
      .element(screen.getByText('1 selected', { exact: true }))
      .toBeVisible()
  })

  test('leaves the other ticks alone after a card Delete clears an orphan row', async () => {
    // Arrange — the orphan, 'task' and 'tdd' are ticked; the orphan card's own
    // Delete opens the dialog with a row origin and runs the orphan cleanup
    const { screen, store } = await renderMainContent()
    const { setBulkConfirm } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills, toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const orphanSkillName = toSkillName('abandoned')
    const orphanSkill: Skill = {
      name: orphanSkillName,
      description: '',
      path: toAbsolutePath('/home/user/.agents/skills/abandoned'),
      symlinkCount: toSymlinkCount(0),
      symlinks: [
        {
          agentId: 'cursor',
          agentName: 'Cursor',
          linkPath: toAbsolutePath('/home/user/.cursor/skills/abandoned'),
          targetPath: toAbsolutePath('/home/user/.agents/skills/abandoned'),
          status: 'broken',
          isLocal: false,
        },
      ],
      isSource: false,
      isOrphan: true,
    }
    store.dispatch(
      fetchSkills.fulfilled(
        [orphanSkill, makeGlobalSkill('task'), makeGlobalSkill('tdd')],
        'req-id',
      ),
    )
    store.dispatch(toggleSelection(orphanSkillName))
    store.dispatch(toggleSelection(toSkillName('task')))
    store.dispatch(toggleSelection(toSkillName('tdd')))
    mockClearOrphanSymlinks.mockResolvedValue({
      items: [
        {
          skillName: orphanSkillName,
          outcome: 'orphan-cleared',
          symlinksRemoved: toSymlinkCount(1),
          cascadeAgents: ['cursor'],
        },
      ],
    })
    store.dispatch(
      setBulkConfirm({
        kind: 'delete',
        origin: 'row',
        skillNames: [orphanSkillName],
        agentId: null,
        agentName: null,
        sourceSummary: null,
        ...partitionGlobalDeleteTargets([orphanSkill], [orphanSkillName]),
      }),
    )

    // Act
    await screen.getByRole('button', { name: /^Delete$/ }).click()

    // Assert — only the cleared orphan leaves the selection
    await expect.poll(() => mockRefreshAllData.mock.calls.length).toBe(1)
    expect(store.getState().skills.selectedSkillNames).toEqual(['task', 'tdd'])
    await expect
      .element(screen.getByText('2 selected', { exact: true }))
      .toBeVisible()
  })

  test('leaves every tick in place after a card Delete fails', async () => {
    // Arrange — 'task' and 'tdd' are ticked; the card's own Delete on 'task'
    // fails, and a row-started op must not narrow the selection to it.
    const { screen, store } = await renderMainContent()
    const { setBulkConfirm } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills, toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const taskSkill = makeGlobalSkill('task')
    store.dispatch(
      fetchSkills.fulfilled([taskSkill, makeGlobalSkill('tdd')], 'req-id'),
    )
    store.dispatch(toggleSelection(toSkillName('task')))
    store.dispatch(toggleSelection(toSkillName('tdd')))
    mockSkillsDeleteSkills.mockResolvedValue({
      items: [
        {
          skillName: toSkillName('task'),
          outcome: 'error',
          error: { message: 'EACCES' },
        },
      ],
    } satisfies BulkDeleteResult)
    store.dispatch(
      setBulkConfirm({
        kind: 'delete',
        origin: 'row',
        skillNames: [toSkillName('task')],
        agentId: null,
        agentName: null,
        sourceSummary: null,
        ...partitionGlobalDeleteTargets([taskSkill], [toSkillName('task')]),
      }),
    )

    // Act
    await screen.getByRole('button', { name: /^Delete$/ }).click()

    // Assert — refreshAllData runs after the selection hand-off point.
    await expect.poll(() => mockRefreshAllData.mock.calls.length).toBe(1)
    expect(store.getState().skills.selectedSkillNames).toEqual(['task', 'tdd'])
    await expect
      .element(screen.getByText('2 selected', { exact: true }))
      .toBeVisible()
  })

  test('keeps the ticked rows and leaves the failed row unticked after a card Delete on an unticked row fails', async () => {
    // Arrange — 'task' and 'tdd' are ticked; the card's own Delete runs on the
    // unticked 'other' and fails. A selection hand-off would narrow the ticks
    // to that one failure, clearing both.
    const { screen, store } = await renderMainContent()
    const { setBulkConfirm } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills, toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const otherSkill = makeGlobalSkill('other')
    store.dispatch(
      fetchSkills.fulfilled(
        [otherSkill, makeGlobalSkill('task'), makeGlobalSkill('tdd')],
        'req-id',
      ),
    )
    store.dispatch(toggleSelection(toSkillName('task')))
    store.dispatch(toggleSelection(toSkillName('tdd')))
    mockSkillsDeleteSkills.mockResolvedValue({
      items: [
        {
          skillName: toSkillName('other'),
          outcome: 'error',
          error: { message: 'EACCES' },
        },
      ],
    } satisfies BulkDeleteResult)
    store.dispatch(
      setBulkConfirm({
        kind: 'delete',
        origin: 'row',
        skillNames: [toSkillName('other')],
        agentId: null,
        agentName: null,
        sourceSummary: null,
        ...partitionGlobalDeleteTargets([otherSkill], [toSkillName('other')]),
      }),
    )

    // Act
    await screen.getByRole('button', { name: /^Delete$/ }).click()

    // Assert — refreshAllData runs after the selection hand-off point.
    await expect.poll(() => mockRefreshAllData.mock.calls.length).toBe(1)
    expect(store.getState().skills.selectedSkillNames).toEqual(['task', 'tdd'])
    await expect
      .element(screen.getByText('2 selected', { exact: true }))
      .toBeVisible()
  })

  test('keeps the attempted rows ticked when a header Delete rejects', async () => {
    // Arrange — both 'task' rows are ticked and visible; 'other' is ticked
    // but hidden by the search, so the Delete never touches it.
    mockListHeaderState.enabled = true
    const { screen, store } = await renderMainContent()
    const { setSearchQuery } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills, toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    store.dispatch(
      fetchSkills.fulfilled(
        [
          makeGlobalSkill('other'),
          makeGlobalSkill('task-one'),
          makeGlobalSkill('task-two'),
        ],
        'req-id',
      ),
    )
    store.dispatch(toggleSelection(toSkillName('task-one')))
    store.dispatch(toggleSelection(toSkillName('task-two')))
    store.dispatch(toggleSelection(toSkillName('other')))
    store.dispatch(setSearchQuery(toSearchQuery('task')))
    mockSkillsDeleteSkills.mockRejectedValue(new Error('Disk offline'))
    await screen.getByRole('button', { name: 'Open bulk confirm' }).click()

    // Act
    await screen.getByRole('button', { name: /^Delete$/ }).click()

    // Assert — refreshAllData runs after the selection hand-off point.
    await expect.poll(() => mockRefreshAllData.mock.calls.length).toBe(1)
    expect(store.getState().skills.selectedSkillNames).toEqual([
      'task-one',
      'task-two',
    ])
    await expect
      .element(screen.getByText('2 selected', { exact: true }))
      .toBeVisible()
    expect(mockSkillsDeleteSkills.mock.calls[0][0]).toEqual({
      items: [
        {
          skillName: 'task-one',
          skillPath: '/home/user/.agents/skills/task-one',
          filesystemIdentity: directoryIdentity,
        },
        {
          skillName: 'task-two',
          skillPath: '/home/user/.agents/skills/task-two',
          filesystemIdentity: directoryIdentity,
        },
      ],
    })
  })

  test('leaves every tick in place when a card Delete rejects', async () => {
    // Arrange — 'task' and 'tdd' are ticked; the card's own Delete on 'task'
    // rejects at the IPC boundary, and a row-started op must not narrow the
    // selection to its one target.
    const { screen, store } = await renderMainContent()
    const { setBulkConfirm } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills, toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const taskSkill = makeGlobalSkill('task')
    store.dispatch(
      fetchSkills.fulfilled([taskSkill, makeGlobalSkill('tdd')], 'req-id'),
    )
    store.dispatch(toggleSelection(toSkillName('task')))
    store.dispatch(toggleSelection(toSkillName('tdd')))
    mockSkillsDeleteSkills.mockRejectedValue(new Error('Disk offline'))
    store.dispatch(
      setBulkConfirm({
        kind: 'delete',
        origin: 'row',
        skillNames: [toSkillName('task')],
        agentId: null,
        agentName: null,
        sourceSummary: null,
        ...partitionGlobalDeleteTargets([taskSkill], [toSkillName('task')]),
      }),
    )

    // Act
    await screen.getByRole('button', { name: /^Delete$/ }).click()

    // Assert — refreshAllData runs after the selection hand-off point.
    await expect.poll(() => mockRefreshAllData.mock.calls.length).toBe(1)
    expect(store.getState().skills.selectedSkillNames).toEqual(['task', 'tdd'])
    await expect
      .element(screen.getByText('2 selected', { exact: true }))
      .toBeVisible()
  })
})

describe('MainContent bulk delete failure toasts', () => {
  test('marks orphan rows as errored when cleanup rejects after a source delete succeeds', async () => {
    // Arrange — a source row deletes successfully, then orphan cleanup rejects;
    // because prior successes exist, the orphan rows are appended as errors
    // rather than restoring the whole selection.
    const { screen, store } = await renderMainContent()
    const { setBulkConfirm } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const sourceSkillName = toSkillName('kept-source')
    const orphanSkillName = toSkillName('dropped-orphan')
    const sourceSkill: Skill = {
      name: sourceSkillName,
      description: '',
      path: toAbsolutePath('/Users/me/.agents/skills/kept-source'),
      filesystemIdentity: directoryIdentity,
      symlinkCount: toSymlinkCount(0),
      symlinks: [],
      isSource: true,
      isOrphan: false,
    }
    const orphanSkill: Skill = {
      name: orphanSkillName,
      description: '',
      path: toAbsolutePath('/Users/me/.agents/skills/dropped-orphan'),
      symlinkCount: toSymlinkCount(0),
      symlinks: [
        {
          agentId: 'devin',
          agentName: 'Devin' as never,
          linkPath: toAbsolutePath(
            '/Users/me/.config/devin/skills/dropped-orphan',
          ),
          targetPath: toAbsolutePath('/Users/me/.agents/skills/dropped-orphan'),
          status: 'broken',
          isLocal: false,
        },
      ],
      isSource: false,
      isOrphan: true,
    }
    mockSkillsDeleteSkills.mockResolvedValue({
      items: [
        {
          skillName: sourceSkillName,
          outcome: 'deleted',
          tombstoneId: tombstoneId('1729180800000-kept-source-a1b2c3d4'),
          symlinksRemoved: toSymlinkCount(0),
          cascadeAgents: [],
        },
      ],
    } satisfies BulkDeleteResult)
    mockClearOrphanSymlinks.mockRejectedValue(new Error('Trash unavailable'))
    store.dispatch(fetchSkills.fulfilled([sourceSkill, orphanSkill], 'req-id'))
    store.dispatch(
      setBulkConfirm({
        kind: 'delete',
        origin: 'selection',
        skillNames: [sourceSkillName, orphanSkillName],
        agentId: null,
        agentName: null,
        sourceSummary: null,
        ...partitionGlobalDeleteTargets(
          [sourceSkill, orphanSkill],
          [sourceSkillName, orphanSkillName],
        ),
      }),
    )

    // Act
    await screen.getByRole('button', { name: /^Delete$/ }).click()

    // Assert — the successful source delete still produced an undo toast, so the
    // batch did not abort when orphan cleanup rejected.
    await expect.poll(() => mockClearOrphanSymlinks.mock.calls.length).toBe(1)
    await expect.poll(() => store.getState().ui.undoToast).not.toBeNull()
  })

  test('does nothing further when the delete IPC reports no items at all', async () => {
    // Arrange — a single source target whose delete fulfils with an empty item
    // list, so there is nothing to summarize or undo.
    const { screen, store } = await renderMainContent()
    const { setBulkConfirm } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const sourceSkillName = toSkillName('empty-result')
    const sourceSkill: Skill = {
      name: sourceSkillName,
      description: '',
      path: toAbsolutePath('/Users/me/.agents/skills/empty-result'),
      filesystemIdentity: directoryIdentity,
      symlinkCount: toSymlinkCount(0),
      symlinks: [],
      isSource: true,
      isOrphan: false,
    }
    mockSkillsDeleteSkills.mockResolvedValue({
      items: [],
    } satisfies BulkDeleteResult)
    store.dispatch(fetchSkills.fulfilled([sourceSkill], 'req-id'))
    store.dispatch(
      setBulkConfirm({
        kind: 'delete',
        origin: 'selection',
        skillNames: [sourceSkillName],
        agentId: null,
        agentName: null,
        sourceSummary: null,
        ...partitionGlobalDeleteTargets([sourceSkill], [sourceSkillName]),
      }),
    )

    // Act
    await screen.getByRole('button', { name: /^Delete$/ }).click()

    // Assert
    await expect.poll(() => mockSkillsDeleteSkills.mock.calls.length).toBe(1)
    expect(store.getState().ui.undoToast).toBeNull()
    expect(vi.mocked(toast.success)).not.toHaveBeenCalled()
  })

  test('toasts a delete failure when every row errors and no tombstone is produced', async () => {
    // Arrange — the delete fulfils, but every item errored, so there is no
    // tombstone and no success: the no-undo error branch must fire.
    const { screen, store } = await renderMainContent()
    const { setBulkConfirm } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const sourceSkillName = toSkillName('all-error')
    const sourceSkill: Skill = {
      name: sourceSkillName,
      description: '',
      path: toAbsolutePath('/Users/me/.agents/skills/all-error'),
      filesystemIdentity: directoryIdentity,
      symlinkCount: toSymlinkCount(0),
      symlinks: [],
      isSource: true,
      isOrphan: false,
    }
    mockSkillsDeleteSkills.mockResolvedValue({
      items: [
        {
          skillName: sourceSkillName,
          outcome: 'error',
          error: { message: 'Disk denied' },
        },
      ],
    } satisfies BulkDeleteResult)
    store.dispatch(fetchSkills.fulfilled([sourceSkill], 'req-id'))
    store.dispatch(
      setBulkConfirm({
        kind: 'delete',
        origin: 'selection',
        skillNames: [sourceSkillName],
        agentId: null,
        agentName: null,
        sourceSummary: null,
        ...partitionGlobalDeleteTargets([sourceSkill], [sourceSkillName]),
      }),
    )

    // Act
    await screen.getByRole('button', { name: /^Delete$/ }).click()

    // Assert
    await expect.poll(() => vi.mocked(toast.error).mock.calls.length).toBe(1)
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      'Bulk delete failed',
      expect.objectContaining({ description: expect.any(String) }),
    )
    expect(store.getState().ui.undoToast).toBeNull()
  })
})

describe('MainContent bulk delete undo toast lifecycle', () => {
  test('clears the persisted undo toast when the notification is dismissed', async () => {
    // Arrange — run a successful delete so an undo toast is registered, then
    // pull the onDismiss option off the toast() call to simulate a dismiss.
    const { screen, store } = await renderMainContent()
    const { setBulkConfirm } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const sourceSkillName = toSkillName('dismiss-me')
    const sourceSkill: Skill = {
      name: sourceSkillName,
      description: '',
      path: toAbsolutePath('/Users/me/.agents/skills/dismiss-me'),
      filesystemIdentity: directoryIdentity,
      symlinkCount: toSymlinkCount(0),
      symlinks: [],
      isSource: true,
      isOrphan: false,
    }
    mockSkillsDeleteSkills.mockResolvedValue({
      items: [
        {
          skillName: sourceSkillName,
          outcome: 'deleted',
          tombstoneId: tombstoneId('1729180800000-dismiss-me-a1b2c3d4'),
          symlinksRemoved: toSymlinkCount(0),
          cascadeAgents: [],
        },
      ],
    } satisfies BulkDeleteResult)
    store.dispatch(fetchSkills.fulfilled([sourceSkill], 'req-id'))
    store.dispatch(
      setBulkConfirm({
        kind: 'delete',
        origin: 'selection',
        skillNames: [sourceSkillName],
        agentId: null,
        agentName: null,
        sourceSummary: null,
        ...partitionGlobalDeleteTargets([sourceSkill], [sourceSkillName]),
      }),
    )
    await screen.getByRole('button', { name: /^Delete$/ }).click()
    await expect.poll(() => store.getState().ui.undoToast).not.toBeNull()

    // The undo toast is rendered via toast(<UndoToast/>, options); grab the
    // onDismiss option from that call to drive the dismissal side effect.
    const undoToastCall = vi.mocked(toast).mock.calls.find(isUndoToastCall)

    // Act — sonner types onDismiss as (toast: ToastT) => void; the handler
    // ignores its argument, so a single cast is required to call it bare.
    undoToastCall![1].onDismiss?.(undefined as never)

    // Assert
    expect(store.getState().ui.undoToast).toBeNull()
  })

  test('keeps a newer undo toast when an older notification is dismissed late', async () => {
    vi.mocked(toast).mockClear()
    vi.mocked(toast.success).mockClear()
    vi.mocked(toast.info).mockClear()
    vi.mocked(toast.error).mockClear()

    // Arrange — run a delete to capture the first toast's dismiss handler,
    // then simulate a second bulk operation replacing the persisted undo state.
    const { screen, store } = await renderMainContent()
    const { setBulkConfirm, setUndoToast } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const sourceSkillName = toSkillName('stale-dismiss-me')
    const sourceSkill: Skill = {
      name: sourceSkillName,
      description: '',
      path: toAbsolutePath('/Users/me/.agents/skills/stale-dismiss-me'),
      filesystemIdentity: directoryIdentity,
      symlinkCount: toSymlinkCount(0),
      symlinks: [],
      isSource: true,
      isOrphan: false,
    }
    mockSkillsDeleteSkills.mockResolvedValue({
      items: [
        {
          skillName: sourceSkillName,
          outcome: 'deleted',
          tombstoneId: tombstoneId('1729180800000-stale-dismiss-a1b2c3d4'),
          symlinksRemoved: toSymlinkCount(0),
          cascadeAgents: [],
        },
      ],
    } satisfies BulkDeleteResult)
    store.dispatch(fetchSkills.fulfilled([sourceSkill], 'req-id'))
    store.dispatch(
      setBulkConfirm({
        kind: 'delete',
        origin: 'selection',
        skillNames: [sourceSkillName],
        agentId: null,
        agentName: null,
        sourceSummary: null,
        ...partitionGlobalDeleteTargets([sourceSkill], [sourceSkillName]),
      }),
    )
    await screen.getByRole('button', { name: /^Delete$/ }).click()
    await expect.poll(() => store.getState().ui.undoToast).not.toBeNull()
    const oldToastCall = vi.mocked(toast).mock.calls.find(isUndoToastCall)
    const newerToast = {
      id: 'bulk-delete-newer',
      kind: 'delete' as const,
      skillNames: [toSkillName('newer-delete')],
      tombstoneIds: [tombstoneId('1729180800000-newer-delete-a1b2c3d4')],
      expiresAt: toIsoTimestamp('2026-04-17T12:00:15.000Z'),
      summary: 'Deleted 1 skill. 0 symlinks removed.',
    }
    store.dispatch(setUndoToast(newerToast))

    // Act — sonner types onDismiss as (toast: ToastT) => void; the handler
    // ignores its argument, so a single cast is required to call it bare.
    oldToastCall![1].onDismiss?.(undefined as never)

    // Assert
    expect(store.getState().ui.undoToast).toEqual(newerToast)
  })
})

describe('MainContent bulk confirm cancellation', () => {
  test('closes the confirmation dialog without acting when Cancel is clicked', async () => {
    // Arrange — open a delete confirmation, then cancel it.
    const { screen, store } = await renderMainContent()
    const { setBulkConfirm } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const sourceSkillName = toSkillName('cancel-me')
    const sourceSkill: Skill = {
      name: sourceSkillName,
      description: '',
      path: toAbsolutePath('/Users/me/.agents/skills/cancel-me'),
      filesystemIdentity: directoryIdentity,
      symlinkCount: toSymlinkCount(0),
      symlinks: [],
      isSource: true,
      isOrphan: false,
    }
    store.dispatch(fetchSkills.fulfilled([sourceSkill], 'req-id'))
    store.dispatch(
      setBulkConfirm({
        kind: 'delete',
        origin: 'selection',
        skillNames: [sourceSkillName],
        agentId: null,
        agentName: null,
        sourceSummary: null,
        ...partitionGlobalDeleteTargets([sourceSkill], [sourceSkillName]),
      }),
    )
    await expect
      .element(screen.getByRole('button', { name: /^Delete$/ }))
      .toBeVisible()

    // Act
    await screen.getByRole('button', { name: 'Cancel' }).click()

    // Assert
    expect(store.getState().ui.bulkConfirm).toBeNull()
    expect(mockSkillsDeleteSkills).not.toHaveBeenCalled()
  })
})
