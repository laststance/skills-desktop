import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import type {
  BulkDeleteResult,
  Skill,
  SkillName,
} from '../../../../shared/types'
import { repositoryId, tombstoneId } from '../../../../shared/types'
import { TooltipProvider } from '../ui/tooltip'

const mockGetAll = vi.fn()
const mockShellOpenExternal = vi.fn()
const mockOnDeleteProgress = vi.fn(() => () => {})
const mockSkillsDeleteSkills = vi.fn()

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
  SelectionToolbar: () => null,
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
  refreshAllData: vi.fn(),
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
  // Install the `electron` IPC bridge — browser mode replaces the preload
  // context, so tests that exercise `window.electron.*` must plant a fake
  // before MainContent's mount effect fires.
  vi.stubGlobal('electron', {
    skills: {
      getAll: mockGetAll,
      onDeleteProgress: mockOnDeleteProgress,
      deleteSkills: mockSkillsDeleteSkills,
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
  const { default: uiReducer } = await import('../../redux/slices/uiSlice')
  const { default: skillsReducer } =
    await import('../../redux/slices/skillsSlice')
  const { default: agentsReducer } =
    await import('../../redux/slices/agentsSlice')
  const { default: bookmarksReducer } =
    await import('../../redux/slices/bookmarkSlice')
  const { default: marketplaceReducer } =
    await import('../../redux/slices/marketplaceSlice')
  return configureStore({
    reducer: {
      ui: uiReducer,
      skills: skillsReducer,
      agents: agentsReducer,
      bookmarks: bookmarksReducer,
      marketplace: marketplaceReducer,
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

describe('MainContent bulk-select toggle button', () => {
  it('shows "Select" and aria-pressed=false by default', async () => {
    const { screen } = await renderMainContent()

    const toggle = screen.getByRole('button', {
      name: /Enter bulk select mode/i,
    })
    await expect.element(toggle).toHaveTextContent(/Select/)
    await expect.element(toggle).toHaveAttribute('aria-pressed', 'false')
  })

  it('clicking "Select" enters bulk select mode', async () => {
    const { screen, store } = await renderMainContent()

    await screen
      .getByRole('button', { name: /Enter bulk select mode/i })
      .click()

    expect(store.getState().ui.bulkSelectMode).toBe(true)
  })

  it('after entering mode the label flips to "Cancel" and aria-pressed=true', async () => {
    const { screen, store } = await renderMainContent()
    const { enterBulkSelectMode } = await import('../../redux/slices/uiSlice')

    store.dispatch(enterBulkSelectMode())

    const toggle = screen.getByRole('button', {
      name: /Exit bulk select mode/i,
    })
    await expect.element(toggle).toHaveTextContent(/Cancel/)
    await expect.element(toggle).toHaveAttribute('aria-pressed', 'true')
  })

  it('clicking "Cancel" exits mode AND clears accumulated selection', async () => {
    const { screen, store } = await renderMainContent()
    const { enterBulkSelectMode } = await import('../../redux/slices/uiSlice')
    const { toggleSelection } = await import('../../redux/slices/skillsSlice')

    store.dispatch(enterBulkSelectMode())
    store.dispatch(toggleSelection('task' as SkillName))
    store.dispatch(toggleSelection('tdd' as SkillName))
    expect(store.getState().skills.selectedSkillNames.length).toBe(2)

    await screen.getByRole('button', { name: /Exit bulk select mode/i }).click()

    expect(store.getState().ui.bulkSelectMode).toBe(false)
    expect(store.getState().skills.selectedSkillNames).toEqual([])
  })
})

describe('MainContent keyboard shortcuts (Cmd+A)', () => {
  it('Cmd+A is a no-op when bulkSelectMode=false (guards against hidden selection)', async () => {
    const { store } = await renderMainContent()

    dispatchKey({ key: 'a', metaKey: true })

    expect(store.getState().skills.selectedSkillNames).toEqual([])
  })

  it('Ctrl+A is also a no-op when bulkSelectMode=false', async () => {
    const { store } = await renderMainContent()

    dispatchKey({ key: 'a', ctrlKey: true })

    expect(store.getState().skills.selectedSkillNames).toEqual([])
  })

  it('Cmd+A dispatches selectAll over visible names when bulkSelectMode=true', async () => {
    const { screen, store } = await renderMainContent()
    const { enterBulkSelectMode } = await import('../../redux/slices/uiSlice')
    const { fetchSkills } = await import('../../redux/slices/skillsSlice')
    const skillFixtures = [
      {
        name: 'task' as SkillName,
        description: '',
        path: '/skills/task' as never,
        symlinkCount: 0,
        symlinks: [],
        isSource: true,
      },
      {
        name: 'tdd' as SkillName,
        description: '',
        path: '/skills/tdd' as never,
        symlinkCount: 0,
        symlinks: [],
        isSource: true,
      },
    ]

    // Seeding via the thunk's fulfilled action avoids mocking the IPC call
    // and exercises the real reducer path that fills `items` in production.
    store.dispatch(fetchSkills.fulfilled(skillFixtures, 'req-id'))
    store.dispatch(enterBulkSelectMode())

    await waitForBulkSelectReady(screen)

    dispatchKey({ key: 'a', metaKey: true })

    const selectedNames = store.getState().skills.selectedSkillNames
    expect(selectedNames).toContain('task')
    expect(selectedNames).toContain('tdd')
    expect(selectedNames.length).toBe(2)
  })

  it('Cmd+A is ignored when focus is inside an editable target', async () => {
    const { screen, store } = await renderMainContent()
    const { enterBulkSelectMode } = await import('../../redux/slices/uiSlice')

    store.dispatch(enterBulkSelectMode())
    // Wait for the bulk-mode render to commit so `bulkSelectModeRef.current`
    // is true when keydown fires. Without this wait the guard can pass via
    // the bulkSelectMode early-return instead of the editable-target branch.
    await waitForBulkSelectReady(screen)

    const textInput = document.createElement('input')
    document.body.appendChild(textInput)
    try {
      textInput.focus()
      textInput.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'a',
          metaKey: true,
          bubbles: true,
        }),
      )

      expect(store.getState().skills.selectedSkillNames).toEqual([])
    } finally {
      // Removal in `finally` so a failing assertion doesn't leak a focused
      // <input> into the reused Chromium page and corrupt `document.activeElement`
      // for the next test (which would then be filtered by isEditableTarget).
      document.body.removeChild(textInput)
    }
  })
})

describe('MainContent keyboard shortcuts (Esc 2-step)', () => {
  it('first Esc with non-empty selection clears selection only (mode stays on)', async () => {
    const { screen, store } = await renderMainContent()
    const { enterBulkSelectMode } = await import('../../redux/slices/uiSlice')
    const { toggleSelection } = await import('../../redux/slices/skillsSlice')

    store.dispatch(enterBulkSelectMode())
    store.dispatch(toggleSelection('task' as SkillName))
    expect(store.getState().skills.selectedSkillNames.length).toBe(1)

    await waitForBulkSelectReady(screen)
    dispatchKey({ key: 'Escape' })

    expect(store.getState().skills.selectedSkillNames).toEqual([])
    expect(store.getState().ui.bulkSelectMode).toBe(true)
  })

  it('second Esc with empty selection exits bulk select mode', async () => {
    const { screen, store } = await renderMainContent()
    const { enterBulkSelectMode } = await import('../../redux/slices/uiSlice')

    store.dispatch(enterBulkSelectMode())

    await waitForBulkSelectReady(screen)
    dispatchKey({ key: 'Escape' })

    expect(store.getState().ui.bulkSelectMode).toBe(false)
  })

  it('Esc is a no-op when bulkSelectMode=false', async () => {
    const { store } = await renderMainContent()

    dispatchKey({ key: 'Escape' })

    expect(store.getState().ui.bulkSelectMode).toBe(false)
    expect(store.getState().skills.selectedSkillNames).toEqual([])
  })

  it('Esc is ignored when focus is inside an editable target', async () => {
    const { screen, store } = await renderMainContent()
    const { enterBulkSelectMode } = await import('../../redux/slices/uiSlice')
    const { toggleSelection } = await import('../../redux/slices/skillsSlice')

    store.dispatch(enterBulkSelectMode())
    store.dispatch(toggleSelection('task' as SkillName))
    // Same race as the Cmd+A editable-target test: wait for bulk-mode commit
    // so the Escape guard is exercised via the editable-target branch.
    await waitForBulkSelectReady(screen)

    const textInput = document.createElement('input')
    document.body.appendChild(textInput)
    try {
      textInput.focus()
      textInput.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      )

      expect(store.getState().skills.selectedSkillNames).toEqual(['task'])
      expect(store.getState().ui.bulkSelectMode).toBe(true)
    } finally {
      document.body.removeChild(textInput)
    }
  })
})

describe('MainContent handleConfirmBulk — uniform delete pipeline', () => {
  // After the CLI removal path was retired (npx skills spawn was unreliable
  // for ~/.agents/skills targets), every global-view bulk delete — including
  // skills tracked in `~/.agents/.skill-lock.json` via a `source` field —
  // must flow through the same `skills:deleteSkills` IPC. Lock-file entries
  // becoming stale is the accepted trade-off; spawn failures are not.

  /**
   * Build a Skill fixture with either a `source` (CLI-tracked in the lock
   * file) or no source (plain). The pipeline now treats both identically.
   */
  function makeSkill(name: SkillName, cliTracked: boolean): Skill {
    return {
      name,
      description: '',
      path: `/home/user/.agents/skills/${name}` as Skill['path'],
      symlinkCount: 0,
      symlinks: [],
      isSource: true,
      ...(cliTracked
        ? { source: repositoryId('vercel-labs/agent-skills') }
        : {}),
    }
  }

  it('routes both source-tracked and plain skills through deleteSkills in one call', async () => {
    const { screen, store } = await renderMainContent()
    const { enterBulkSelectMode, setBulkConfirm } =
      await import('../../redux/slices/uiSlice')
    const { fetchSkills } = await import('../../redux/slices/skillsSlice')

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

    store.dispatch(
      fetchSkills.fulfilled(
        [
          makeSkill('brainstorming' as SkillName, true),
          makeSkill('local-skill' as SkillName, false),
        ],
        'req-id',
      ),
    )
    store.dispatch(enterBulkSelectMode())
    store.dispatch(
      setBulkConfirm({
        kind: 'delete',
        skillNames: ['brainstorming' as SkillName, 'local-skill' as SkillName],
        agentId: null,
        agentName: null,
      }),
    )

    await screen.getByRole('button', { name: /^Delete$/ }).click()

    // Single IPC call carrying BOTH names — partition is gone, no second
    // pipeline. The payload shape is `{ items: [{ skillName }] }`; assert it
    // verbatim so a future thunk tweak surfaces here.
    await expect.poll(() => mockSkillsDeleteSkills.mock.calls.length).toBe(1)
    expect(mockSkillsDeleteSkills.mock.calls[0][0]).toEqual({
      items: [{ skillName: 'brainstorming' }, { skillName: 'local-skill' }],
    })
    // Flush the microtask queue and re-assert: `expect.poll` is satisfied at the
    // first hit, so a regression that triggers a *second* IPC call on a later
    // microtask would otherwise slip through.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mockSkillsDeleteSkills).toHaveBeenCalledTimes(1)
  })
})
