import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import type {
  BulkDeleteResult,
  CliRemoveSkillsResult,
  Skill,
  SkillName,
} from '../../../../shared/types'
import { repositoryId, tombstoneId } from '../../../../shared/types'
import { TooltipProvider } from '../ui/tooltip'

const mockGetAll = vi.fn()
const mockShellOpenExternal = vi.fn()
const mockOnDeleteProgress = vi.fn(() => () => {})
const mockSkillsCliRemoveBatch = vi.fn()
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
  mockSkillsCliRemoveBatch.mockReset()
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
    skillsCli: {
      removeBatch: mockSkillsCliRemoveBatch,
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
      },
      {
        name: 'tdd' as SkillName,
        description: '',
        path: '/skills/tdd' as never,
        symlinkCount: 0,
        symlinks: [],
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

describe('MainContent handleConfirmBulk — mixed-partition dispatch', () => {
  // Global-view bulk delete partitions the batch into CLI-managed (source set,
  // tracked in ~/.agents/.skill-lock.json) vs. plain skills. The CLI bucket
  // MUST fire first: the awaited spawn has to settle before the reversible
  // trash op runs, otherwise the UndoToast's tombstone ids can reference a
  // skill the CLI already removed — the restore would then try to resurrect
  // a ghost. This test pins down that invariant.

  /**
   * Build a Skill fixture with either a `source` (CLI-managed) or no source
   * (plain). Keeps the test's seeding block readable.
   */
  function makeSkill(name: SkillName, cli: boolean): Skill {
    return {
      name,
      description: '',
      path: `/home/user/.agents/skills/${name}` as Skill['path'],
      symlinkCount: 0,
      symlinks: [],
      ...(cli ? { source: repositoryId('vercel-labs/agent-skills') } : {}),
    }
  }

  it('dispatches cliRemoveSelectedSkills BEFORE deleteSelectedSkills for a mixed batch', async () => {
    const { screen, store } = await renderMainContent()
    const { enterBulkSelectMode } = await import('../../redux/slices/uiSlice')
    const { setBulkConfirm } = await import('../../redux/slices/uiSlice')
    const { fetchSkills } = await import('../../redux/slices/skillsSlice')

    // Stub IPC results. The partition has brainstorming (CLI) + local-skill
    // (plain), so removeBatch returns one item and deleteSkills returns one.
    const cliResult: CliRemoveSkillsResult = {
      items: [{ skillName: 'brainstorming' as SkillName, outcome: 'removed' }],
    }
    const plainResult: BulkDeleteResult = {
      items: [
        {
          skillName: 'local-skill' as SkillName,
          outcome: 'deleted',
          tombstoneId: tombstoneId('1729180800000-local-skill-a1b2c3d4'),
          symlinksRemoved: 0,
          cascadeAgents: [],
        },
      ],
    }
    mockSkillsCliRemoveBatch.mockResolvedValue(cliResult)
    mockSkillsDeleteSkills.mockResolvedValue(plainResult)

    // Seed items via the real thunk's fulfilled action — same pattern as the
    // Cmd+A test — so the partition step sees a live item list.
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

    // The inline BulkConfirmDialog renders a "Delete" button (destructive
    // variant) when kind === 'delete'. Clicking it invokes handleConfirmBulk.
    await screen.getByRole('button', { name: /^Delete$/ }).click()

    await expect.poll(() => mockSkillsCliRemoveBatch.mock.calls.length).toBe(1)
    await expect.poll(() => mockSkillsDeleteSkills.mock.calls.length).toBe(1)

    // Ordering is load-bearing: invocation-order comparison uses vitest's
    // call timestamps (available via `mock.invocationCallOrder` — monotonic
    // across all mocks in the run).
    const cliCall = mockSkillsCliRemoveBatch.mock.invocationCallOrder[0]
    const plainCall = mockSkillsDeleteSkills.mock.invocationCallOrder[0]
    expect(cliCall).toBeLessThan(plainCall)

    // Payload shape: CLI got the CLI-managed name only, plain got the plain
    // name only — the partition correctly separated the two buckets.
    expect(mockSkillsCliRemoveBatch.mock.calls[0][0]).toEqual({
      items: [{ skillName: 'brainstorming' }],
    })
    // The deleteSkills IPC takes `{ items: [{ skillName }] }` (same shape as
    // removeBatch), NOT a flat string array. Assert the exact payload so a
    // future thunk tweak that drops the wrapper surfaces here.
    expect(mockSkillsDeleteSkills.mock.calls[0][0]).toEqual({
      items: [{ skillName: 'local-skill' }],
    })
  })

  it('skips deleteSkills entirely when every selected skill is CLI-managed', async () => {
    const { screen, store } = await renderMainContent()
    const { enterBulkSelectMode, setBulkConfirm } =
      await import('../../redux/slices/uiSlice')
    const { fetchSkills } = await import('../../redux/slices/skillsSlice')

    const cliResult: CliRemoveSkillsResult = {
      items: [
        { skillName: 'brainstorming' as SkillName, outcome: 'removed' },
        { skillName: 'theme-generator' as SkillName, outcome: 'removed' },
      ],
    }
    mockSkillsCliRemoveBatch.mockResolvedValue(cliResult)

    store.dispatch(
      fetchSkills.fulfilled(
        [
          makeSkill('brainstorming' as SkillName, true),
          makeSkill('theme-generator' as SkillName, true),
        ],
        'req-id',
      ),
    )
    store.dispatch(enterBulkSelectMode())
    store.dispatch(
      setBulkConfirm({
        kind: 'delete',
        skillNames: [
          'brainstorming' as SkillName,
          'theme-generator' as SkillName,
        ],
        agentId: null,
        agentName: null,
      }),
    )

    await screen.getByRole('button', { name: /^Delete$/ }).click()

    await expect.poll(() => mockSkillsCliRemoveBatch.mock.calls.length).toBe(1)
    // Crucial: deleteSkills IPC never fires for an all-CLI batch. Calling it
    // with an empty array would spin the trash service for no reason AND
    // leave an empty UndoToast tombstone list on screen.
    expect(mockSkillsDeleteSkills).not.toHaveBeenCalled()
  })

  it('skips cliRemoveBatch entirely when every selected skill is plain', async () => {
    const { screen, store } = await renderMainContent()
    const { enterBulkSelectMode, setBulkConfirm } =
      await import('../../redux/slices/uiSlice')
    const { fetchSkills } = await import('../../redux/slices/skillsSlice')

    const plainResult: BulkDeleteResult = {
      items: [
        {
          skillName: 'local-skill' as SkillName,
          outcome: 'deleted',
          tombstoneId: tombstoneId('1729180800000-local-skill-a1b2c3d4'),
          symlinksRemoved: 0,
          cascadeAgents: [],
        },
      ],
    }
    mockSkillsDeleteSkills.mockResolvedValue(plainResult)

    store.dispatch(
      fetchSkills.fulfilled(
        [makeSkill('local-skill' as SkillName, false)],
        'req-id',
      ),
    )
    store.dispatch(enterBulkSelectMode())
    store.dispatch(
      setBulkConfirm({
        kind: 'delete',
        skillNames: ['local-skill' as SkillName],
        agentId: null,
        agentName: null,
      }),
    )

    await screen.getByRole('button', { name: /^Delete$/ }).click()

    await expect.poll(() => mockSkillsDeleteSkills.mock.calls.length).toBe(1)
    // Symmetric to the all-CLI case: a plain-only batch must not spawn a CLI
    // subprocess. (Cold-start npx latency is ~1s; firing it for nothing
    // would be a gratuitous UX hit.) Poll the negative assertion too — a
    // bare `.not.toHaveBeenCalled()` would pass spuriously on the first tick
    // before the (forbidden) CLI spawn would have settled on the slow path.
    await expect.poll(() => mockSkillsCliRemoveBatch.mock.calls.length).toBe(0)
  })
})
