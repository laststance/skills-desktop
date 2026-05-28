import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import { TooltipProvider } from '@/renderer/src/components/ui/tooltip'
import type {
  AgentId,
  BulkDeleteResult,
  Skill,
  SkillName,
  SymlinkInfo,
} from '@/shared/types'
import { repositoryId, tombstoneId } from '@/shared/types'

const mockGetAll = vi.fn()
const mockShellOpenExternal = vi.fn()
const mockOnDeleteProgress = vi.fn(() => () => {})
const mockSkillsDeleteSkills = vi.fn()
const mockClearOrphanSymlinks = vi.fn()
const mockRefreshAllData = vi.hoisted(() => vi.fn())

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
  mockRefreshAllData.mockReset()
  // Install the `electron` IPC bridge — browser mode replaces the preload
  // context, so tests that exercise `window.electron.*` must plant a fake
  // before MainContent's mount effect fires.
  vi.stubGlobal('electron', {
    skills: {
      getAll: mockGetAll,
      onDeleteProgress: mockOnDeleteProgress,
      deleteSkills: mockSkillsDeleteSkills,
      clearOrphanSymlinks: mockClearOrphanSymlinks,
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
    const { enterBulkSelectMode } =
      await import('@/renderer/src/redux/slices/uiSlice')

    store.dispatch(enterBulkSelectMode())

    const toggle = screen.getByRole('button', {
      name: /Exit bulk select mode/i,
    })
    await expect.element(toggle).toHaveTextContent(/Cancel/)
    await expect.element(toggle).toHaveAttribute('aria-pressed', 'true')
  })

  it('clicking "Cancel" exits mode AND clears accumulated selection', async () => {
    const { screen, store } = await renderMainContent()
    const { enterBulkSelectMode } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')

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
    const { enterBulkSelectMode } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const skillFixtures = [
      {
        name: 'task' as SkillName,
        description: '',
        path: '/skills/task' as never,
        symlinkCount: 0,
        symlinks: [],
        isSource: true,
        isOrphan: false,
      },
      {
        name: 'tdd' as SkillName,
        description: '',
        path: '/skills/tdd' as never,
        symlinkCount: 0,
        symlinks: [],
        isSource: true,
        isOrphan: false,
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
    const { enterBulkSelectMode } =
      await import('@/renderer/src/redux/slices/uiSlice')

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
    const { enterBulkSelectMode } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')

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
    const { enterBulkSelectMode } =
      await import('@/renderer/src/redux/slices/uiSlice')

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
      isOrphan: false,
      ...(cliTracked
        ? { source: repositoryId('vercel-labs/agent-skills') }
        : {}),
    }
  }

  it('routes both source-tracked and plain skills through deleteSkills in one call', async () => {
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
        sourceSummary: null,
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
    expect(
      screen
        .getByText(/removes reviewed dangling symlinks for 1 orphan skill/)
        .query(),
    ).toBeNull()
  })
})

describe('MainContent SkillTypeFilter dropdown options', () => {
  // Pins agent-only type filters: the dropdown is gated by `selectedAgentId`
  // (source view never offers it), and each option writes the Redux state that
  // selectors use to narrow the visible list.

  it('renders the Orphan radio item with a destructive dot when an agent is selected', async () => {
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

    // Open the dropdown from the agent-only skill type trigger.
    await screen
      .getByRole('button', { name: /Skill type filter: All/i })
      .click()

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

  it('renders the G-Stack radio item with a sky dot when an agent is selected', async () => {
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

    // Open the dropdown — G-Stack sits beside Symlinked/Local as a type filter.
    await screen
      .getByRole('button', { name: /Skill type filter: All/i })
      .click()

    const gstackItem = screen.getByRole('menuitemradio', { name: /G-Stack/i })
    await expect.element(gstackItem).toBeInTheDocument()
    const dot = gstackItem.element().querySelector('.bg-gstack')
    expect(
      dot,
      'G-Stack menu item should contain a span with bg-gstack',
    ).not.toBeNull()
  })

  it('selecting Orphan narrows visible list to skills with isOrphan=true', async () => {
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

    await screen
      .getByRole('button', { name: /Skill type filter: All/i })
      .click()
    await screen.getByRole('menuitemradio', { name: /Orphan/i }).click()

    // Slice state — single source of truth that the selector reads from.
    expect(store.getState().ui.skillTypeFilter).toBe('orphan')

    // Selector view — the filtered list now contains only the orphan.
    const { selectFilteredSkills } =
      await import('@/renderer/src/redux/selectors')
    const filtered = selectFilteredSkills(store.getState() as never)
    expect(filtered.map((skill) => skill.name)).toEqual(['orphan-one'])
  })

  it('toggling an exclude checkbox updates state while keeping the dropdown open', async () => {
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

    await screen
      .getByRole('button', { name: /Skill type filter: All/i })
      .click()
    await screen.getByRole('menuitemcheckbox', { name: /Local/i }).click()

    expect(store.getState().ui.excludedSkillTypeFilters).toEqual(['local'])
    await expect
      .element(screen.getByRole('menuitem', { name: /Clear excludes/i }))
      .toBeInTheDocument()
  })
})

describe('MainContent repo facet dropdown', () => {
  it('selects a repository from source-count options', async () => {
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

    await screen
      .getByRole('button', { name: /Filter by source repository/i })
      .click()
    await screen
      .getByRole('menuitemcheckbox', {
        name: /pbakaus\/impeccable, 1 skill/i,
      })
      .click()

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

  it('renders the Source pill with repo name and clears state on click', async () => {
    const { screen, store } = await renderMainContent()
    const { setSelectedSources } =
      await import('@/renderer/src/redux/slices/uiSlice')

    // No source filter active: pill must not render.
    expect(screen.getByTestId('source-filter-pill').query()).toBeNull()

    store.dispatch(setSelectedSources([repositoryId('vercel-labs/skills')]))

    const pill = screen.getByTestId('source-filter-pill')
    await expect.element(pill).toBeInTheDocument()
    await expect.element(pill).toHaveTextContent(/from/)
    await expect.element(pill).toHaveTextContent('vercel-labs/skills')

    // Clear button inside the pill resets the slice field.
    await pill.getByRole('button', { name: /Clear/i }).click()

    await expect.poll(() => store.getState().ui.selectedSources).toEqual([])
    expect(screen.getByTestId('source-filter-pill').query()).toBeNull()
  })

  it('Agent + Source pills both render when both filters are active', async () => {
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
    store.dispatch(selectAgent('claude-code'))
    store.dispatch(setSelectedSources([repositoryId('vercel-labs/skills')]))

    await expect
      .element(screen.getByTestId('agent-filter-pill'))
      .toHaveTextContent('Claude Code')
    await expect
      .element(screen.getByTestId('source-filter-pill'))
      .toHaveTextContent('vercel-labs/skills')
  })

  it('clearing the Source pill leaves the Agent pill intact (orthogonal)', async () => {
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

    // Clear ONLY the source pill.
    await screen
      .getByTestId('source-filter-pill')
      .getByRole('button', { name: /Clear/i })
      .click()

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
