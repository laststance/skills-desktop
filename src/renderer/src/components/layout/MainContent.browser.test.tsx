import { configureStore } from '@reduxjs/toolkit'
import type { ReactElement } from 'react'
import { Provider } from 'react-redux'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import { partitionGlobalDeleteTargets } from '@/renderer/src/components/skills/reviewedDestructiveTargets'
import { TooltipProvider } from '@/renderer/src/components/ui/tooltip'
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
import { repositoryId, tombstoneId } from '@/shared/types'

const mockGetAll = vi.fn()
const mockShellOpenExternal = vi.fn()
const mockOnDeleteProgress = vi.fn(
  (_callback: (payload: DeleteProgressPayload) => void) => () => {},
)
const mockSkillsDeleteSkills = vi.fn()
const mockClearOrphanSymlinks = vi.fn()
const mockUnlinkManyFromAgent = vi.fn()
const mockRestoreDeletedSkill = vi.fn()
const mockRefreshAllData = vi.hoisted(() => vi.fn())
const mockSelectionToolbarState = vi.hoisted(() => ({ enabled: false }))

const directoryIdentity: FilesystemEntryIdentity = {
  kind: 'directory',
  dev: 1,
  ino: 2,
  size: 96,
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
 * toggle button and the document-level keyboard shortcuts this file owns.
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
vi.mock('../skills/SelectionToolbar', () => ({
  SelectionToolbar: ({
    onPrimaryAction,
    onCopyAction,
  }: {
    onPrimaryAction: () => void
    onCopyAction?: () => void
  }) =>
    mockSelectionToolbarState.enabled ? (
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
    ) : null,
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

beforeEach(() => {
  mockGetAll.mockReset()
  mockShellOpenExternal.mockReset()
  mockOnDeleteProgress.mockReset()
  mockOnDeleteProgress.mockImplementation(() => () => {})
  mockSkillsDeleteSkills.mockReset()
  mockClearOrphanSymlinks.mockReset()
  mockUnlinkManyFromAgent.mockReset()
  mockRestoreDeletedSkill.mockReset()
  mockRefreshAllData.mockReset()
  mockSelectionToolbarState.enabled = false
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
      onProgress: vi.fn(() => () => {}),
    },
    shell: {
      openExternal: mockShellOpenExternal,
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
 *   synthetic wrapper observes the event if it ever delegates; caller may
 *   override via an explicit `bubbles: false`.
 */
function dispatchKey(init: KeyboardEventInit): void {
  document.dispatchEvent(
    new KeyboardEvent('keydown', { ...init, bubbles: init.bubbles ?? true }),
  )
}

/**
 * Wait for MainContent's re-render that reflects bulkSelectMode=true. The
 * toggle button's aria-label only flips to "Exit bulk select mode" after
 * the render commits; effects run on the microtask immediately following
 * commit, which drains before this assertion's first polled iteration. By
 * the time this resolves, `bulkSelectModeRef.current === true` so the
 * keydown handler below will not early-return.
 * @param screen - vitest-browser-react locator root from renderMainContent
 */
async function waitForBulkSelectReady(
  screen: Awaited<ReturnType<typeof renderMainContent>>['screen'],
): Promise<void> {
  await expect
    .element(screen.getByRole('button', { name: /Exit bulk select mode/i }))
    .toBeInTheDocument()
}

/**
 * Build a source-repo skill for toolbar facet tests.
 * @param name - Visible skill name.
 * @param source - Repository slug shown in the repo dropdown.
 * @returns Skill row with source metadata and no agent slot.
 */
function makeSourceSkill(name: string, source: string): Skill {
  return {
    name: name as SkillName,
    description: '',
    path: `/skills/${name}` as never,
    filesystemIdentity: directoryIdentity,
    symlinkCount: 0,
    symlinks: [],
    isSource: true,
    isOrphan: false,
    source: repositoryId(source),
    sourceUrl: `https://github.com/${source}.git`,
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
    name: name as SkillName,
    description: '',
    path: `/home/user/.${agentId}/skills/${name}` as never,
    symlinkCount: 0,
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
  it('shows the current visible count in the Installed tab by default and keeps Marketplace count-free', async () => {
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

  it('updates the Installed tab count when search and repo filters change visible skills', async () => {
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
    store.dispatch(setSearchQuery('alpha'))

    // Assert
    await expect
      .element(
        screen.getByRole('tab', {
          name: /Installed, 1 skill visible/i,
        }),
      )
      .toBeInTheDocument()

    // Act
    store.dispatch(setSearchQuery(''))
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
    store.dispatch(setSearchQuery('missing'))

    // Assert
    await expect
      .element(
        screen.getByRole('tab', {
          name: /Installed, 0 skills visible/i,
        }),
      )
      .toBeInTheDocument()
  })

  it('moves the current visible count into the toolbar when the inline setting is selected', async () => {
    // Arrange
    const { screen, store } = await renderMainContent()
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const { setSettings } =
      await import('@/renderer/src/redux/slices/settingsSlice')
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
    store.dispatch(
      setSettings({
        ...DEFAULT_SETTINGS,
        installedSearchCountDisplay: 'inline',
      }),
    )

    // Assert
    await expect.element(screen.getByText(/^3 skills$/)).toBeInTheDocument()
    await expect
      .element(screen.getByRole('tab', { name: /^Installed$/ }))
      .toBeInTheDocument()
    expect(
      screen.getByRole('tab', { name: /Installed, 3 skills visible/i }).query(),
    ).toBeNull()
  })
})

describe('MainContent hosts the shared InstallModal', () => {
  it('opens the Install Skill dialog when a skill is selected for install (e.g. from a sidebar bookmark)', async () => {
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
        name: 'task',
        repo: repositoryId('vercel-labs/skills'),
      }),
    )

    // Assert
    await expect
      .element(screen.getByRole('dialog', { name: 'Install Skill' }))
      .toBeInTheDocument()
  })
})

describe('MainContent bulk-select toggle button', () => {
  it('labels the bulk toggle "Select" and unpressed before the user enters bulk mode', async () => {
    // Arrange
    const { screen } = await renderMainContent()

    // Act
    const toggle = screen.getByRole('button', {
      name: /Enter bulk select mode/i,
    })

    // Assert
    await expect.element(toggle).toHaveTextContent(/Select/)
    await expect.element(toggle).toHaveAttribute('aria-pressed', 'false')
  })

  it('enters bulk select mode when the user clicks Select', async () => {
    // Arrange
    const { screen, store } = await renderMainContent()

    // Act
    await screen
      .getByRole('button', { name: /Enter bulk select mode/i })
      .click()

    // Assert
    expect(store.getState().ui.bulkSelectMode).toBe(true)
  })

  it('flips the bulk toggle to a pressed "Cancel" once bulk mode is active', async () => {
    // Arrange
    const { screen, store } = await renderMainContent()
    const { enterBulkSelectMode } =
      await import('@/renderer/src/redux/slices/uiSlice')

    // Act
    store.dispatch(enterBulkSelectMode())

    // Assert
    const toggle = screen.getByRole('button', {
      name: /Exit bulk select mode/i,
    })
    await expect.element(toggle).toHaveTextContent(/Cancel/)
    await expect.element(toggle).toHaveAttribute('aria-pressed', 'true')
  })

  it('clears the accumulated selection when the user clicks Cancel to leave bulk mode', async () => {
    // Arrange
    const { screen, store } = await renderMainContent()
    const { enterBulkSelectMode } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')

    store.dispatch(enterBulkSelectMode())
    store.dispatch(toggleSelection('task' as SkillName))
    store.dispatch(toggleSelection('tdd' as SkillName))
    expect(store.getState().skills.selectedSkillNames.length).toBe(2)

    // Act
    await screen.getByRole('button', { name: /Exit bulk select mode/i }).click()

    // Assert
    expect(store.getState().ui.bulkSelectMode).toBe(false)
    expect(store.getState().skills.selectedSkillNames).toEqual([])
  })
})

describe('MainContent keyboard shortcuts (Cmd+A)', () => {
  it('ignores Cmd+A outside bulk mode so nothing gets silently selected', async () => {
    // Arrange
    const { store } = await renderMainContent()

    // Act
    dispatchKey({ key: 'a', metaKey: true })

    // Assert
    expect(store.getState().skills.selectedSkillNames).toEqual([])
  })

  it('ignores Ctrl+A outside bulk mode so nothing gets silently selected', async () => {
    // Arrange
    const { store } = await renderMainContent()

    // Act
    dispatchKey({ key: 'a', ctrlKey: true })

    // Assert
    expect(store.getState().skills.selectedSkillNames).toEqual([])
  })

  it('selects every visible skill on Cmd+A while in bulk mode', async () => {
    const { screen, store } = await renderMainContent()
    const { enterBulkSelectMode } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const skillFixtures = [
      {
        name: 'task' as SkillName,
        description: '',
        path: '/skills/task' as never,
        filesystemIdentity: directoryIdentity,
        symlinkCount: 0,
        symlinks: [],
        isSource: true,
        isOrphan: false,
      },
      {
        name: 'tdd' as SkillName,
        description: '',
        path: '/skills/tdd' as never,
        filesystemIdentity: directoryIdentity,
        symlinkCount: 0,
        symlinks: [],
        isSource: true,
        isOrphan: false,
      },
    ]

    // Arrange
    // Seeding via the thunk's fulfilled action avoids mocking the IPC call
    // and exercises the real reducer path that fills `items` in production.
    store.dispatch(fetchSkills.fulfilled(skillFixtures, 'req-id'))
    store.dispatch(enterBulkSelectMode())

    await waitForBulkSelectReady(screen)

    // Act
    dispatchKey({ key: 'a', metaKey: true })

    // Assert
    const selectedNames = store.getState().skills.selectedSkillNames
    expect(selectedNames).toContain('task')
    expect(selectedNames).toContain('tdd')
    expect(selectedNames.length).toBe(2)
  })

  it('does not select skills on Cmd+A while typing in a text field', async () => {
    const { screen, store } = await renderMainContent()
    const { enterBulkSelectMode } =
      await import('@/renderer/src/redux/slices/uiSlice')

    // Arrange
    store.dispatch(enterBulkSelectMode())
    // Wait for the bulk-mode render to commit so `bulkSelectModeRef.current`
    // is true when keydown fires. Without this wait the guard can pass via
    // the bulkSelectMode early-return instead of the editable-target branch.
    await waitForBulkSelectReady(screen)

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

  it('selects every visible skill on Cmd+A even while the search box is focused, blurring it first', async () => {
    const { screen, store } = await renderMainContent()
    const { enterBulkSelectMode } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const skillFixtures = [
      {
        name: 'task' as SkillName,
        description: '',
        path: '/skills/task' as never,
        filesystemIdentity: directoryIdentity,
        symlinkCount: 0,
        symlinks: [],
        isSource: true,
        isOrphan: false,
      },
      {
        name: 'tdd' as SkillName,
        description: '',
        path: '/skills/tdd' as never,
        filesystemIdentity: directoryIdentity,
        symlinkCount: 0,
        symlinks: [],
        isSource: true,
        isOrphan: false,
      },
    ]

    // Arrange — skills loaded and bulk mode on. The search box renders as
    // <input type="search"> (asserted in SearchBox.browser.test.tsx); here we
    // stand in a focused search input to exercise the handler's special case,
    // mirroring the focused-text-field test above for a clean contrast pair.
    store.dispatch(fetchSkills.fulfilled(skillFixtures, 'req-id'))
    store.dispatch(enterBulkSelectMode())
    await waitForBulkSelectReady(screen)

    const searchInput = document.createElement('input')
    searchInput.type = 'search'
    document.body.appendChild(searchInput)
    try {
      // Act — the canonical flow: query typed, box still focused, user hits Cmd+A
      searchInput.focus()
      expect(document.activeElement).toBe(searchInput)
      searchInput.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'a',
          metaKey: true,
          bubbles: true,
        }),
      )

      // Assert — every filtered row is selected (pre-fix bug: nothing happened)...
      const selectedNames = store.getState().skills.selectedSkillNames
      expect(selectedNames).toContain('task')
      expect(selectedNames).toContain('tdd')
      expect(selectedNames.length).toBe(2)
      // ...and the box was blurred so the browser didn't just select its own text
      expect(document.activeElement).not.toBe(searchInput)
    } finally {
      // Removal in `finally` so a failing assertion doesn't leak a focused
      // <input type="search"> into the reused Chromium page.
      document.body.removeChild(searchInput)
    }
  })
})

describe('MainContent keyboard shortcuts (Esc 2-step)', () => {
  it('clears the selection but stays in bulk mode on the first Esc when skills are selected', async () => {
    // Arrange
    const { screen, store } = await renderMainContent()
    const { enterBulkSelectMode } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')

    store.dispatch(enterBulkSelectMode())
    store.dispatch(toggleSelection('task' as SkillName))
    expect(store.getState().skills.selectedSkillNames.length).toBe(1)

    await waitForBulkSelectReady(screen)

    // Act
    dispatchKey({ key: 'Escape' })

    // Assert
    expect(store.getState().skills.selectedSkillNames).toEqual([])
    expect(store.getState().ui.bulkSelectMode).toBe(true)
  })

  it('leaves bulk mode on Esc once the selection is already empty', async () => {
    // Arrange
    const { screen, store } = await renderMainContent()
    const { enterBulkSelectMode } =
      await import('@/renderer/src/redux/slices/uiSlice')

    store.dispatch(enterBulkSelectMode())

    await waitForBulkSelectReady(screen)

    // Act
    dispatchKey({ key: 'Escape' })

    // Assert
    expect(store.getState().ui.bulkSelectMode).toBe(false)
  })

  it('ignores Esc entirely when the user is not in bulk mode', async () => {
    // Arrange
    const { store } = await renderMainContent()

    // Act
    dispatchKey({ key: 'Escape' })

    // Assert
    expect(store.getState().ui.bulkSelectMode).toBe(false)
    expect(store.getState().skills.selectedSkillNames).toEqual([])
  })

  it('does not clear the selection on Esc while the user is typing in a text field', async () => {
    // Arrange
    const { screen, store } = await renderMainContent()
    const { enterBulkSelectMode } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')

    store.dispatch(enterBulkSelectMode())
    store.dispatch(toggleSelection('task' as SkillName))
    // Same race as the Cmd+A editable-target test: wait for bulk-mode commit
    // so the Escape guard is exercised via the editable-target branch.
    await waitForBulkSelectReady(screen)

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
      expect(store.getState().ui.bulkSelectMode).toBe(true)
    } finally {
      document.body.removeChild(textInput)
    }
  })

  it('does not clear the selection or exit bulk mode when Escape closes an open install modal overlaying the Installed tab', async () => {
    // Arrange
    // The always-mounted InstallModal (hoisted onto MainContent so sidebar
    // bookmark installs open it on any tab) can now overlay the Installed tab
    // while bulk-select is active. Escape must close ONLY the modal; without the
    // open-dialog guard in handleKey, the same Escape would also clear the
    // selection — a double-fire that silently wipes the user's batch.
    const { screen, store } = await renderMainContent()
    const { enterBulkSelectMode } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const { selectSkillForInstall } =
      await import('@/renderer/src/redux/slices/marketplaceSlice')

    store.dispatch(enterBulkSelectMode())
    store.dispatch(toggleSelection('task' as SkillName))
    await waitForBulkSelectReady(screen)

    // Open the shared InstallModal (exactly the sidebar bookmark install path),
    // then wait for the Radix dialog to mount with data-state="open".
    store.dispatch(
      selectSkillForInstall({
        name: 'task',
        repo: repositoryId('vercel-labs/skills'),
      }),
    )
    await expect
      .element(screen.getByRole('dialog', { name: 'Install Skill' }))
      .toBeInTheDocument()

    // Act
    dispatchKey({ key: 'Escape' })

    // Assert
    expect(store.getState().skills.selectedSkillNames).toEqual(['task'])
    expect(store.getState().ui.bulkSelectMode).toBe(true)
  })

  it('does not clear the selection or exit bulk mode when Escape closes an open dropdown menu', async () => {
    // Arrange — Radix DropdownMenu.Content owns Escape while it is open. The
    // document bulk shortcut must not also consume that same keydown.
    const { screen, store } = await renderMainContent()
    const { enterBulkSelectMode } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    store.dispatch(enterBulkSelectMode())
    store.dispatch(toggleSelection('task' as SkillName))
    await waitForBulkSelectReady(screen)

    const openMenu = document.createElement('div')
    openMenu.setAttribute('role', 'menu')
    openMenu.setAttribute('data-state', 'open')
    document.body.appendChild(openMenu)

    try {
      // Act
      dispatchKey({ key: 'Escape' })

      // Assert
      expect(store.getState().skills.selectedSkillNames).toEqual(['task'])
      expect(store.getState().ui.bulkSelectMode).toBe(true)
    } finally {
      document.body.removeChild(openMenu)
    }
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
      path: `/home/user/.agents/skills/${folderName}` as Skill['path'],
      filesystemIdentity: directoryIdentity,
      symlinkCount: 0,
      symlinks: [],
      isSource: true,
      isOrphan: false,
      ...(cliTracked
        ? { source: repositoryId('vercel-labs/agent-skills') }
        : {}),
    }
  }

  it('deletes both source-tracked and plain skills through a single delete call', async () => {
    // Arrange
    const { screen, store } = await renderMainContent()
    const { enterBulkSelectMode, setBulkConfirm } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')

    const result: BulkDeleteResult = {
      items: [
        {
          skillName: 'brainstorming' as SkillName,
          outcome: 'deleted',
          tombstoneId: tombstoneId('1729180800000-brainstorming-a1b2c3d4'),
          symlinksRemoved: 0,
          cascadeAgents: [],
        },
        {
          skillName: 'local-skill' as SkillName,
          outcome: 'deleted',
          tombstoneId: tombstoneId('1729180800000-local-skill-e5f6a7b8'),
          symlinksRemoved: 0,
          cascadeAgents: [],
        },
      ],
    }
    mockSkillsDeleteSkills.mockResolvedValue(result)

    const selectedSkills = [
      makeSkill('brainstorming' as SkillName, true),
      makeSkill('local-skill' as SkillName, false),
    ]
    store.dispatch(fetchSkills.fulfilled(selectedSkills, 'req-id'))
    store.dispatch(enterBulkSelectMode())
    store.dispatch(
      setBulkConfirm({
        kind: 'delete',
        skillNames: ['brainstorming' as SkillName, 'local-skill' as SkillName],
        agentId: null,
        agentName: null,
        sourceSummary: null,
        ...partitionGlobalDeleteTargets(selectedSkills, [
          'brainstorming' as SkillName,
          'local-skill' as SkillName,
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

  it('passes reviewed source path when metadata name differs from folder basename', async () => {
    const { screen, store } = await renderMainContent()
    const { setBulkConfirm } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const metadataName = 'metadata-title' as SkillName
    const folderName = 'folder-basename' as SkillName
    mockSkillsDeleteSkills.mockResolvedValue({
      items: [
        {
          skillName: metadataName,
          outcome: 'deleted',
          tombstoneId: tombstoneId('1729180800000-metadata-title-a1b2c3d4'),
          symlinksRemoved: 1,
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

  it('uses toolbar-captured delete targets when live rows drift before confirm', async () => {
    mockSelectionToolbarState.enabled = true
    const { screen, store } = await renderMainContent()
    const { enterBulkSelectMode } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills, toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const skillName = 'snapshot-delete' as SkillName
    const originalSkill = makeSkill(
      skillName,
      false,
      'reviewed-folder' as SkillName,
    )
    const replacementSkill: Skill = {
      ...originalSkill,
      path: '/home/user/.agents/skills/replacement-folder' as never,
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
          symlinksRemoved: 0,
          cascadeAgents: [],
        },
      ],
    } satisfies BulkDeleteResult)

    // Arrange: open the real bulk-confirm path, then replace the live row with
    // the same display name but a different reviewed filesystem identity.
    store.dispatch(fetchSkills.fulfilled([originalSkill], 'req-original'))
    store.dispatch(enterBulkSelectMode())
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

  it('uses toolbar-captured unlink targets when live rows drift before confirm', async () => {
    mockSelectionToolbarState.enabled = true
    const { screen, store } = await renderMainContent()
    const { fetchAgents } =
      await import('@/renderer/src/redux/slices/agentsSlice')
    const { enterBulkSelectMode, selectAgent } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills, toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const skillName = 'snapshot-unlink' as SkillName
    const originalSkill: Skill = {
      name: skillName,
      description: '',
      path: '/home/user/.agents/skills/snapshot-unlink' as never,
      filesystemIdentity: directoryIdentity,
      symlinkCount: 1,
      symlinks: [
        {
          agentId: 'cursor' as AgentId,
          agentName: 'Cursor' as never,
          linkPath: '/home/user/.cursor/skills/reviewed-link' as never,
          targetPath: '/home/user/.agents/skills/reviewed-target' as never,
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
          linkPath: '/home/user/.cursor/skills/replacement-link' as never,
          targetPath: '/home/user/.agents/skills/replacement-target' as never,
        } as SymlinkInfo,
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
            id: 'cursor' as AgentId,
            name: 'Cursor' as never,
            path: '/home/user/.cursor/skills' as never,
            exists: true,
            skillCount: 1,
            localSkillCount: 0,
          },
        ],
        'req-agent',
      ),
    )
    store.dispatch(selectAgent('cursor' as AgentId))
    store.dispatch(fetchSkills.fulfilled([originalSkill], 'req-original'))
    store.dispatch(enterBulkSelectMode())
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

  it('routes global orphan deletes through reviewed orphan cleanup identity', async () => {
    const { screen, store } = await renderMainContent()
    const { setBulkConfirm } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const orphanSkillName = 'abandoned' as SkillName
    const orphanSkill: Skill = {
      name: orphanSkillName,
      description: '',
      path: '/Users/me/.agents/skills/abandoned' as never,
      symlinkCount: 0,
      symlinks: [
        {
          agentId: 'devin' as AgentId,
          agentName: 'Devin' as never,
          linkPath: '/Users/me/.config/devin/skills/abandoned' as never,
          targetPath: '/Users/me/.agents/skills/abandoned' as never,
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
          symlinksRemoved: 1,
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

  it('keeps failed source rows selected after mixed source and orphan delete', async () => {
    const { screen, store } = await renderMainContent()
    const { enterBulkSelectMode, setBulkConfirm } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills, toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const sourceSkillName = 'source-task' as SkillName
    const orphanSkillName = 'abandoned' as SkillName
    const sourceSkill: Skill = {
      name: sourceSkillName,
      description: '',
      path: '/Users/me/.agents/skills/source-task' as never,
      filesystemIdentity: directoryIdentity,
      symlinkCount: 0,
      symlinks: [],
      isSource: true,
      isOrphan: false,
    }
    const orphanSkill: Skill = {
      name: orphanSkillName,
      description: '',
      path: '/Users/me/.agents/skills/abandoned' as never,
      symlinkCount: 0,
      symlinks: [
        {
          agentId: 'devin' as AgentId,
          agentName: 'Devin' as never,
          linkPath: '/Users/me/.config/devin/skills/abandoned' as never,
          targetPath: '/Users/me/.agents/skills/abandoned' as never,
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
          symlinksRemoved: 1,
          cascadeAgents: ['devin'],
        },
      ],
    })

    // Arrange: mixed batch has one retryable source failure and one orphan
    // cleanup success; the source failure must stay selected for retry.
    store.dispatch(fetchSkills.fulfilled([sourceSkill, orphanSkill], 'req-id'))
    store.dispatch(enterBulkSelectMode())
    store.dispatch(toggleSelection(sourceSkillName))
    store.dispatch(toggleSelection(orphanSkillName))
    store.dispatch(
      setBulkConfirm({
        kind: 'delete',
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
    expect(store.getState().ui.bulkSelectMode).toBe(true)
  })

  it('keeps source ESTALE selected instead of treating it as orphan rescan', async () => {
    const { screen, store } = await renderMainContent()
    const { enterBulkSelectMode, setBulkConfirm } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills, toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const sourceSkillName = 'source-stale-task' as SkillName
    const orphanSkillName = 'abandoned' as SkillName
    const sourceSkill: Skill = {
      name: sourceSkillName,
      description: '',
      path: '/Users/me/.agents/skills/source-stale-task' as never,
      filesystemIdentity: directoryIdentity,
      symlinkCount: 0,
      symlinks: [],
      isSource: true,
      isOrphan: false,
    }
    const orphanSkill: Skill = {
      name: orphanSkillName,
      description: '',
      path: '/Users/me/.agents/skills/abandoned' as never,
      symlinkCount: 0,
      symlinks: [
        {
          agentId: 'devin' as AgentId,
          agentName: 'Devin' as never,
          linkPath: '/Users/me/.config/devin/skills/abandoned' as never,
          targetPath: '/Users/me/.agents/skills/abandoned' as never,
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
          symlinksRemoved: 1,
          cascadeAgents: ['devin'],
        },
      ],
    })

    // Arrange: source ESTALE is retry-visible; only orphan ESTALE/preflight
    // rows should become rescan-required and be removed from retry selection.
    store.dispatch(fetchSkills.fulfilled([sourceSkill, orphanSkill], 'req-id'))
    store.dispatch(enterBulkSelectMode())
    store.dispatch(toggleSelection(sourceSkillName))
    store.dispatch(toggleSelection(orphanSkillName))
    store.dispatch(
      setBulkConfirm({
        kind: 'delete',
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
    expect(store.getState().ui.bulkSelectMode).toBe(true)
  })

  it('excludes stale orphan preflight errors from retry selection and names rescan in the summary', async () => {
    const { screen, store } = await renderMainContent()
    const { enterBulkSelectMode, setBulkConfirm } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills, toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const sourceSkillName = 'source-task' as SkillName
    const orphanSkillName = 'stale-abandoned' as SkillName
    const sourceSkill: Skill = {
      name: sourceSkillName,
      description: '',
      path: '/Users/me/.agents/skills/source-task' as never,
      filesystemIdentity: directoryIdentity,
      symlinkCount: 0,
      symlinks: [],
      isSource: true,
      isOrphan: false,
    }
    const staleOrphanSkill: Skill = {
      name: orphanSkillName,
      description: '',
      path: '/Users/me/.agents/skills/stale-abandoned' as never,
      symlinkCount: 0,
      symlinks: [
        {
          agentId: 'devin' as AgentId,
          agentName: 'Devin' as never,
          linkPath: '/Users/me/.config/devin/skills/stale-abandoned' as never,
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
          symlinksRemoved: 0,
          cascadeAgents: [],
        },
      ],
    } satisfies BulkDeleteResult)

    // Arrange: the source row succeeds, but the orphan row is stale before IPC.
    store.dispatch(
      fetchSkills.fulfilled([sourceSkill, staleOrphanSkill], 'req-id'),
    )
    store.dispatch(enterBulkSelectMode())
    store.dispatch(toggleSelection(sourceSkillName))
    store.dispatch(toggleSelection(orphanSkillName))
    store.dispatch(
      setBulkConfirm({
        kind: 'delete',
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
    expect(store.getState().ui.bulkSelectMode).toBe(false)
    expect(store.getState().ui.undoToast?.summary).toBe(
      'Deleted 1 of 2 skills. 1 orphan skill needs a rescan before cleanup.',
    )
  })

  it('restores unresolved mixed delete selection when source delete rejects', async () => {
    const { screen, store } = await renderMainContent()
    const { enterBulkSelectMode, setBulkConfirm } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills, toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const sourceSkillName = 'source-task' as SkillName
    const orphanSkillName = 'abandoned' as SkillName
    const sourceSkill: Skill = {
      name: sourceSkillName,
      description: '',
      path: '/Users/me/.agents/skills/source-task' as never,
      filesystemIdentity: directoryIdentity,
      symlinkCount: 0,
      symlinks: [],
      isSource: true,
      isOrphan: false,
    }
    const orphanSkill: Skill = {
      name: orphanSkillName,
      description: '',
      path: '/Users/me/.agents/skills/abandoned' as never,
      symlinkCount: 0,
      symlinks: [
        {
          agentId: 'devin' as AgentId,
          agentName: 'Devin' as never,
          linkPath: '/Users/me/.config/devin/skills/abandoned' as never,
          targetPath: '/Users/me/.agents/skills/abandoned' as never,
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
    store.dispatch(enterBulkSelectMode())
    store.dispatch(toggleSelection(sourceSkillName))
    store.dispatch(toggleSelection(orphanSkillName))
    store.dispatch(
      setBulkConfirm({
        kind: 'delete',
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
    expect(store.getState().ui.bulkSelectMode).toBe(true)
    expect(mockRefreshAllData).toHaveBeenCalledTimes(1)
  })

  it('restores orphan-only selection and refreshes when reviewed orphan cleanup rejects', async () => {
    const { screen, store } = await renderMainContent()
    const { enterBulkSelectMode, setBulkConfirm } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills, toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const orphanSkillName = 'abandoned' as SkillName
    const orphanSkill: Skill = {
      name: orphanSkillName,
      description: '',
      path: '/Users/me/.agents/skills/abandoned' as never,
      symlinkCount: 0,
      symlinks: [
        {
          agentId: 'devin' as AgentId,
          agentName: 'Devin' as never,
          linkPath: '/Users/me/.config/devin/skills/abandoned' as never,
          targetPath: '/Users/me/.agents/skills/abandoned' as never,
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
    store.dispatch(enterBulkSelectMode())
    store.dispatch(toggleSelection(orphanSkillName))
    store.dispatch(
      setBulkConfirm({
        kind: 'delete',
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
    expect(store.getState().ui.bulkSelectMode).toBe(true)
    expect(mockRefreshAllData).toHaveBeenCalledTimes(1)
  })

  it('does not count stale orphan rows as cleanup-ready in delete confirmation', async () => {
    const { screen, store } = await renderMainContent()
    const { setBulkConfirm } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const orphanSkillName = 'stale-abandoned' as SkillName
    const staleOrphanSkill: Skill = {
      name: orphanSkillName,
      description: '',
      path: '/Users/me/.agents/skills/stale-abandoned' as never,
      symlinkCount: 0,
      symlinks: [
        {
          agentId: 'devin' as AgentId,
          agentName: 'Devin' as never,
          linkPath: '/Users/me/.config/devin/skills/stale-abandoned' as never,
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

  it('labels stale source rows as delete rescans, not orphan cleanup rescans', async () => {
    const { screen, store } = await renderMainContent()
    const { setBulkConfirm } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const sourceSkillName = 'source-missing-identity' as SkillName
    const staleSourceSkill: Skill = {
      name: sourceSkillName,
      description: '',
      path: '/Users/me/.agents/skills/source-missing-identity' as never,
      symlinkCount: 0,
      symlinks: [],
      isSource: true,
      isOrphan: false,
    }

    // Arrange
    store.dispatch(fetchSkills.fulfilled([staleSourceSkill], 'req-id'))
    store.dispatch(
      setBulkConfirm({
        kind: 'delete',
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

  it('offers an Orphan filter marked with a destructive dot when an agent is selected', async () => {
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
            path: '/Users/me/.cursor/skills' as never,
            exists: true,
            skillCount: 0,
            localSkillCount: 0,
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

  it('offers a G-Stack filter marked with a sky dot when an agent is selected', async () => {
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
            path: '/Users/me/.cursor/skills' as never,
            exists: true,
            skillCount: 0,
            localSkillCount: 0,
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

  it('offers a Unique filter marked with a violet dot and a discoverability hint when an agent is selected', async () => {
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
            path: '/Users/me/.cursor/skills' as never,
            exists: true,
            skillCount: 0,
            localSkillCount: 0,
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

  it('narrows the visible list to only single-agent skills when the Unique filter is chosen', async () => {
    // Arrange
    const { screen, store } = await renderMainContent()
    const { fetchAgents } =
      await import('@/renderer/src/redux/slices/agentsSlice')
    const { selectAgent } = await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')

    // A skill available to exactly one agent (a lone valid slot in cursor).
    const uniqueSkill: Skill = {
      name: 'cursor-unique' as SkillName,
      description: '',
      path: '/skills/cursor-unique' as never,
      symlinkCount: 1,
      symlinks: [
        {
          agentId: 'cursor' as never,
          agentName: 'Cursor' as never,
          linkPath: '/cursor/skills/cursor-unique' as never,
          targetPath: '/skills/cursor-unique' as never,
          status: 'valid',
          isLocal: false,
        },
      ],
      isSource: true,
      isOrphan: false,
    }
    // A skill shared by two agents — visible in the cursor view, but NOT unique.
    const sharedSkill: Skill = {
      name: 'shared-two' as SkillName,
      description: '',
      path: '/skills/shared-two' as never,
      symlinkCount: 2,
      symlinks: [
        {
          agentId: 'cursor' as never,
          agentName: 'Cursor' as never,
          linkPath: '/cursor/skills/shared-two' as never,
          targetPath: '/skills/shared-two' as never,
          status: 'valid',
          isLocal: false,
        },
        {
          agentId: 'codex' as never,
          agentName: 'Codex' as never,
          linkPath: '/codex/skills/shared-two' as never,
          targetPath: '/skills/shared-two' as never,
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
            path: '/Users/me/.cursor/skills' as never,
            exists: true,
            skillCount: 0,
            localSkillCount: 0,
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

  it('narrows the visible list to only orphan skills when the Orphan filter is chosen', async () => {
    // Arrange
    const { screen, store } = await renderMainContent()
    const { fetchAgents } =
      await import('@/renderer/src/redux/slices/agentsSlice')
    const { selectAgent } = await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')

    const orphanSkill: Skill = {
      name: 'orphan-one' as SkillName,
      description: '',
      path: '/skills/orphan-one' as never,
      symlinkCount: 1,
      symlinks: [
        {
          agentId: 'cursor' as never,
          agentName: 'Cursor' as never,
          linkPath: '/cursor/skills/orphan-one' as never,
          targetPath: '/skills/orphan-one' as never,
          status: 'broken',
          isLocal: false,
        },
      ],
      isSource: false,
      isOrphan: true,
    }
    const linkedSkill: Skill = {
      name: 'linked-one' as SkillName,
      description: '',
      path: '/skills/linked-one' as never,
      filesystemIdentity: directoryIdentity,
      symlinkCount: 1,
      symlinks: [
        {
          agentId: 'cursor' as never,
          agentName: 'Cursor' as never,
          linkPath: '/cursor/skills/linked-one' as never,
          targetPath: '/skills/linked-one' as never,
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
            path: '/Users/me/.cursor/skills' as never,
            exists: true,
            skillCount: 0,
            localSkillCount: 0,
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

  it('keeps the dropdown open and reveals Clear excludes when a type is excluded', async () => {
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
            path: '/Users/me/.cursor/skills' as never,
            exists: true,
            skillCount: 0,
            localSkillCount: 0,
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
  it('filters by a repository when its source-count option is picked', async () => {
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

  it('shows a Source pill naming the repo and hides it again when the pill is cleared', async () => {
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
    await expect.element(pill).toHaveTextContent(/from/)
    await expect.element(pill).toHaveTextContent('vercel-labs/skills')

    // Act — clear the filter via the pill's Clear button
    // Clear button inside the pill resets the slice field.
    await pill.getByRole('button', { name: /Clear/i }).click()

    // Assert — filter is empty and the pill is gone
    await expect.poll(() => store.getState().ui.selectedSources).toEqual([])
    expect(screen.getByTestId('source-filter-pill').query()).toBeNull()
  })

  it('shows both the Agent and Source pills when an agent and a source are filtered together', async () => {
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
            path: '/Users/me/.claude/skills' as never,
            exists: true,
            skillCount: 0,
            localSkillCount: 0,
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
      .toHaveTextContent('Claude Code')
    await expect
      .element(screen.getByTestId('source-filter-pill'))
      .toHaveTextContent('vercel-labs/skills')
  })

  it('keeps the Agent pill and agent filter when only the Source pill is cleared', async () => {
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
            path: '/Users/me/.claude/skills' as never,
            exists: true,
            skillCount: 0,
            localSkillCount: 0,
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
      .toHaveTextContent('Claude Code')
  })
})

describe('MainContent hidden-locals caveat', () => {
  // The repo include-filter hides source-less local skills. This inline caveat
  // tells the user how many were dropped so an empty-looking list is explained.

  it('shows "N local skills hidden" when the repo filter suppresses source-less locals', async () => {
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

  it('omits the caveat when no repo filter is active', async () => {
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
  it('reverses the alphabetical sort order when the user clicks the sort toggle', async () => {
    // Arrange
    const { screen, store } = await renderMainContent()
    expect(store.getState().ui.sortOrder).toBe('asc')

    // Act
    await screen
      .getByRole('button', { name: /Sorted A to Z, click to reverse/i })
      .click()

    // Assert
    expect(store.getState().ui.sortOrder).toBe('desc')
  })

  it('switches to the Marketplace tab and clears any open skill preview', async () => {
    // Arrange
    const { screen, store } = await renderMainContent()
    const { setPreviewSkill } =
      await import('@/renderer/src/redux/slices/marketplaceSlice')
    store.dispatch(
      setPreviewSkill({
        rank: 1 as never,
        name: 'task' as SkillName,
        repo: repositoryId('vercel-labs/skills'),
        url: 'https://skills.sh/task' as never,
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
  it('clears the agent filter when the user clears the agent pill', async () => {
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
            path: '/Users/me/.cursor/skills' as never,
            exists: true,
            skillCount: 0,
            localSkillCount: 0,
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

  it('clears every source when the collapsed multi-repo pill is cleared', async () => {
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
      .toHaveTextContent('4 repos')

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
  it('clears the include filter when the user picks "Show all repos"', async () => {
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

  it('ticks every facet repo when the user picks "Select all repos"', async () => {
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
            path: '/Users/me/.cursor/skills' as never,
            exists: true,
            skillCount: 0,
            localSkillCount: 0,
          },
        ],
        'req-id',
      ),
    )
    store.dispatch(selectAgent('cursor'))
    return { screen, store }
  }

  it('excludes Symlinked skills when its exclude checkbox is ticked', async () => {
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

  it('excludes G-Stack skills when its exclude checkbox is ticked', async () => {
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

  it('excludes Orphan skills when its exclude checkbox is ticked', async () => {
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

  it('clears all excludes when the user picks "Clear excludes"', async () => {
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
  it('opens the bulk copy-to-agents modal from the global selection toolbar', async () => {
    // Arrange — exercise the real toolbar's Copy action wired to MainContent.
    mockSelectionToolbarState.enabled = true
    const { screen, store } = await renderMainContent()
    const { enterBulkSelectMode } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills, toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    store.dispatch(
      fetchSkills.fulfilled([makeSourceSkill('alpha', 'org/repo')], 'req-id'),
    )
    store.dispatch(enterBulkSelectMode())
    store.dispatch(toggleSelection('alpha' as SkillName))

    // Act
    await screen.getByRole('button', { name: 'Open bulk copy' }).click()

    // Assert
    expect(store.getState().skills.bulkCopyModalOpen).toBe(true)
  })
})

describe('MainContent delete progress wiring', () => {
  it('mirrors main-process delete progress into Redux', async () => {
    // Arrange — capture the progress callback MainContent subscribes on mount.
    const { store } = await renderMainContent()
    const progressCallback = mockOnDeleteProgress.mock.calls.at(-1)?.[0]
    expect(typeof progressCallback).toBe('function')

    // Act
    progressCallback?.({ current: 3, total: 12 })

    // Assert
    expect(store.getState().skills.bulkProgress).toEqual({
      current: 3,
      total: 12,
    })
  })
})

describe('MainContent stale-source delete summary', () => {
  it('names the rescan-needed source row in the undo summary after a partial delete', async () => {
    // Arrange — one deletable source row plus one stale (identity-less) source
    // row, so the delete succeeds for one and the summary appends rescan guidance.
    const { screen, store } = await renderMainContent()
    const { setBulkConfirm } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const deletableName = 'fresh-source' as SkillName
    const staleName = 'stale-source' as SkillName
    const deletableSkill: Skill = {
      name: deletableName,
      description: '',
      path: '/Users/me/.agents/skills/fresh-source' as never,
      filesystemIdentity: directoryIdentity,
      symlinkCount: 0,
      symlinks: [],
      isSource: true,
      isOrphan: false,
    }
    const staleSkill: Skill = {
      name: staleName,
      description: '',
      path: '/Users/me/.agents/skills/stale-source' as never,
      symlinkCount: 0,
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
          symlinksRemoved: 0,
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
      name: `undo-skill-${index}` as SkillName,
      description: '',
      path: `/Users/me/.agents/skills/undo-skill-${index}` as never,
      filesystemIdentity: directoryIdentity,
      symlinkCount: 0,
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
        symlinksRemoved: 0,
        cascadeAgents: [],
      })),
    } satisfies BulkDeleteResult)
    store.dispatch(fetchSkills.fulfilled(skills, 'req-id'))
    store.dispatch(
      setBulkConfirm({
        kind: 'delete',
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

  it('toasts a full-success message and clears the undo toast when every row restores', async () => {
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

  it('toasts a partial-restore message when some rows fail to restore', async () => {
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

  it('toasts a restore-failed message when the undo dispatch rejects', async () => {
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

describe('MainContent toolbar primary action guards', () => {
  it('does nothing when the toolbar primary fires with no rows selected', async () => {
    // Arrange — bulk-select mode is on but nothing is selected, so the toolbar
    // primary must early-return without opening any confirmation dialog.
    mockSelectionToolbarState.enabled = true
    const { screen, store } = await renderMainContent()
    const { enterBulkSelectMode } =
      await import('@/renderer/src/redux/slices/uiSlice')
    store.dispatch(enterBulkSelectMode())

    // Act
    await screen.getByRole('button', { name: 'Open bulk confirm' }).click()

    // Assert
    expect(store.getState().ui.bulkConfirm).toBeNull()
  })

  it('does nothing when only protected rows are selected in agent view', async () => {
    // Arrange — the row is visible and selected, but protection excludes it from
    // agent-view bulk unlink candidates before the confirm dialog can open.
    mockSelectionToolbarState.enabled = true
    const { screen, store } = await renderMainContent()
    const { fetchAgents } =
      await import('@/renderer/src/redux/slices/agentsSlice')
    const { enterBulkSelectMode, selectAgent } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills, toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const { addProtection } =
      await import('@/renderer/src/redux/slices/protectSlice')
    const skillName = 'protected-link' as SkillName
    const protectedSkill: Skill = {
      name: skillName,
      description: '',
      path: '/home/user/.agents/skills/protected-link' as never,
      filesystemIdentity: directoryIdentity,
      symlinkCount: 1,
      symlinks: [
        {
          agentId: 'cursor' as AgentId,
          agentName: 'Cursor' as never,
          linkPath: '/home/user/.cursor/skills/protected-link' as never,
          targetPath: '/home/user/.agents/skills/protected-link' as never,
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
            id: 'cursor' as AgentId,
            name: 'Cursor' as never,
            path: '/home/user/.cursor/skills' as never,
            exists: true,
            skillCount: 1,
            localSkillCount: 0,
          },
        ],
        'req-agent',
      ),
    )
    store.dispatch(selectAgent('cursor' as AgentId))
    store.dispatch(fetchSkills.fulfilled([protectedSkill], 'req-protected'))
    store.dispatch(enterBulkSelectMode())
    store.dispatch(toggleSelection(skillName))
    store.dispatch(addProtection(skillName))

    // Act
    await screen.getByRole('button', { name: 'Open bulk confirm' }).click()

    // Assert
    expect(store.getState().ui.bulkConfirm).toBeNull()
  })

  it('blocks unlink and prompts a rescan when the selected agent slot went stale', async () => {
    // Arrange — a cursor row is selectable (status valid) yet its slot lost the
    // reviewed targetPath, so buildAgentUnlinkTargets reports it stale.
    mockSelectionToolbarState.enabled = true
    const { screen, store } = await renderMainContent()
    const { fetchAgents } =
      await import('@/renderer/src/redux/slices/agentsSlice')
    const { enterBulkSelectMode, selectAgent } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills, toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const skillName = 'stale-unlink' as SkillName
    const staleSkill: Skill = {
      name: skillName,
      description: '',
      path: '/home/user/.agents/skills/stale-unlink' as never,
      filesystemIdentity: directoryIdentity,
      symlinkCount: 1,
      symlinks: [
        {
          agentId: 'cursor' as AgentId,
          agentName: 'Cursor' as never,
          linkPath: '/home/user/.cursor/skills/stale-link' as never,
          // Missing targetPath → buildAgentUnlinkTargets pushes it to staleNames.
          targetPath: undefined as never,
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
            id: 'cursor' as AgentId,
            name: 'Cursor' as never,
            path: '/home/user/.cursor/skills' as never,
            exists: true,
            skillCount: 1,
            localSkillCount: 0,
          },
        ],
        'req-agent',
      ),
    )
    store.dispatch(selectAgent('cursor' as AgentId))
    store.dispatch(fetchSkills.fulfilled([staleSkill], 'req-stale'))
    store.dispatch(enterBulkSelectMode())
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
    mockSelectionToolbarState.enabled = true
    const { screen, store } = await renderMainContent()
    const { fetchAgents } =
      await import('@/renderer/src/redux/slices/agentsSlice')
    const { enterBulkSelectMode, selectAgent } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills, toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const skillName = 'linked-skill' as SkillName
    const linkedSkill: Skill = {
      name: skillName,
      description: '',
      path: '/home/user/.agents/skills/linked-skill' as never,
      filesystemIdentity: directoryIdentity,
      symlinkCount: 1,
      symlinks: [
        {
          agentId: 'cursor' as AgentId,
          agentName: 'Cursor' as never,
          linkPath: '/home/user/.cursor/skills/linked-link' as never,
          targetPath: '/home/user/.agents/skills/linked-target' as never,
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
            id: 'cursor' as AgentId,
            name: 'Cursor' as never,
            path: '/home/user/.cursor/skills' as never,
            exists: true,
            skillCount: 1,
            localSkillCount: 0,
          },
        ],
        'req-agent',
      ),
    )
    store.dispatch(selectAgent('cursor' as AgentId))
    store.dispatch(fetchSkills.fulfilled([linkedSkill], 'req-linked'))
    store.dispatch(enterBulkSelectMode())
    store.dispatch(toggleSelection(skillName))
    await screen.getByRole('button', { name: 'Open bulk confirm' }).click()
    return { screen, store, skillName }
  }

  it('toasts a partial success summary when some rows unlink and some error', async () => {
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

  it('toasts a failure summary when every slot errors on unlink', async () => {
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

  it('toasts a failure when the unlink thunk rejects at the IPC boundary', async () => {
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

describe('MainContent bulk delete failure toasts', () => {
  it('marks orphan rows as errored when cleanup rejects after a source delete succeeds', async () => {
    // Arrange — a source row deletes successfully, then orphan cleanup rejects;
    // because prior successes exist, the orphan rows are appended as errors
    // rather than restoring the whole selection.
    const { screen, store } = await renderMainContent()
    const { setBulkConfirm } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const sourceSkillName = 'kept-source' as SkillName
    const orphanSkillName = 'dropped-orphan' as SkillName
    const sourceSkill: Skill = {
      name: sourceSkillName,
      description: '',
      path: '/Users/me/.agents/skills/kept-source' as never,
      filesystemIdentity: directoryIdentity,
      symlinkCount: 0,
      symlinks: [],
      isSource: true,
      isOrphan: false,
    }
    const orphanSkill: Skill = {
      name: orphanSkillName,
      description: '',
      path: '/Users/me/.agents/skills/dropped-orphan' as never,
      symlinkCount: 0,
      symlinks: [
        {
          agentId: 'devin' as AgentId,
          agentName: 'Devin' as never,
          linkPath: '/Users/me/.config/devin/skills/dropped-orphan' as never,
          targetPath: '/Users/me/.agents/skills/dropped-orphan' as never,
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
          symlinksRemoved: 0,
          cascadeAgents: [],
        },
      ],
    } satisfies BulkDeleteResult)
    mockClearOrphanSymlinks.mockRejectedValue(new Error('Trash unavailable'))
    store.dispatch(fetchSkills.fulfilled([sourceSkill, orphanSkill], 'req-id'))
    store.dispatch(
      setBulkConfirm({
        kind: 'delete',
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

  it('does nothing further when the delete IPC reports no items at all', async () => {
    // Arrange — a single source target whose delete fulfils with an empty item
    // list, so there is nothing to summarize or undo.
    const { screen, store } = await renderMainContent()
    const { setBulkConfirm } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const sourceSkillName = 'empty-result' as SkillName
    const sourceSkill: Skill = {
      name: sourceSkillName,
      description: '',
      path: '/Users/me/.agents/skills/empty-result' as never,
      filesystemIdentity: directoryIdentity,
      symlinkCount: 0,
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

  it('toasts a delete failure when every row errors and no tombstone is produced', async () => {
    // Arrange — the delete fulfils, but every item errored, so there is no
    // tombstone and no success: the no-undo error branch must fire.
    const { screen, store } = await renderMainContent()
    const { setBulkConfirm } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const sourceSkillName = 'all-error' as SkillName
    const sourceSkill: Skill = {
      name: sourceSkillName,
      description: '',
      path: '/Users/me/.agents/skills/all-error' as never,
      filesystemIdentity: directoryIdentity,
      symlinkCount: 0,
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
  it('clears the persisted undo toast when the notification is dismissed', async () => {
    // Arrange — run a successful delete so an undo toast is registered, then
    // pull the onDismiss option off the toast() call to simulate a dismiss.
    const { screen, store } = await renderMainContent()
    const { setBulkConfirm } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const sourceSkillName = 'dismiss-me' as SkillName
    const sourceSkill: Skill = {
      name: sourceSkillName,
      description: '',
      path: '/Users/me/.agents/skills/dismiss-me' as never,
      filesystemIdentity: directoryIdentity,
      symlinkCount: 0,
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
          symlinksRemoved: 0,
          cascadeAgents: [],
        },
      ],
    } satisfies BulkDeleteResult)
    store.dispatch(fetchSkills.fulfilled([sourceSkill], 'req-id'))
    store.dispatch(
      setBulkConfirm({
        kind: 'delete',
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

  it('keeps a newer undo toast when an older notification is dismissed late', async () => {
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
    const sourceSkillName = 'stale-dismiss-me' as SkillName
    const sourceSkill: Skill = {
      name: sourceSkillName,
      description: '',
      path: '/Users/me/.agents/skills/stale-dismiss-me' as never,
      filesystemIdentity: directoryIdentity,
      symlinkCount: 0,
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
          symlinksRemoved: 0,
          cascadeAgents: [],
        },
      ],
    } satisfies BulkDeleteResult)
    store.dispatch(fetchSkills.fulfilled([sourceSkill], 'req-id'))
    store.dispatch(
      setBulkConfirm({
        kind: 'delete',
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
      skillNames: ['newer-delete'] as SkillName[],
      tombstoneIds: [tombstoneId('1729180800000-newer-delete-a1b2c3d4')],
      expiresAt: '2026-04-17T12:00:15.000Z',
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
  it('closes the confirmation dialog without acting when Cancel is clicked', async () => {
    // Arrange — open a delete confirmation, then cancel it.
    const { screen, store } = await renderMainContent()
    const { setBulkConfirm } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const sourceSkillName = 'cancel-me' as SkillName
    const sourceSkill: Skill = {
      name: sourceSkillName,
      description: '',
      path: '/Users/me/.agents/skills/cancel-me' as never,
      filesystemIdentity: directoryIdentity,
      symlinkCount: 0,
      symlinks: [],
      isSource: true,
      isOrphan: false,
    }
    store.dispatch(fetchSkills.fulfilled([sourceSkill], 'req-id'))
    store.dispatch(
      setBulkConfirm({
        kind: 'delete',
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
