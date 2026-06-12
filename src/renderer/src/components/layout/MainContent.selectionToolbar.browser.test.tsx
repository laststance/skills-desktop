import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import { TooltipProvider } from '@/renderer/src/components/ui/tooltip'
import { DEFAULT_SETTINGS } from '@/shared/settings'
import type { Agent, Skill, SkillName, SymlinkInfo } from '@/shared/types'

const mockUnlinkManyFromAgent = vi.fn()
const mockOnDeleteProgress = vi.fn(() => () => {})
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
  path: '/Users/test/.cursor/skills',
  exists: true,
  skillCount: 3,
  localSkillCount: 0,
}

/**
 * Build a source skill with one Cursor slot for toolbar integration tests.
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
    path: `/Users/test/.agents/skills/${slotName}`,
    symlinkCount: status === 'missing' ? 0 : 1,
    symlinks: [
      {
        agentId: 'cursor',
        agentName: 'Cursor',
        status,
        linkPath: `/Users/test/.cursor/skills/${slotName}`,
        targetPath: `/Users/test/.agents/skills/${slotName}`,
        isLocal: false,
      },
    ],
    isSource: true,
    isOrphan: false,
  }
}

/**
 * Render MainContent with the real SelectionToolbar and lightweight child mocks.
 * @returns Browser screen and Redux store used by the mounted MainContent.
 * @example const { screen, store } = await renderMainContentWithToolbar()
 */
async function renderMainContentWithToolbar() {
  const [
    { default: uiReducer },
    { default: skillsReducer },
    { default: agentsReducer },
    { default: bookmarksReducer },
    { default: marketplaceReducer },
    { default: settingsReducer },
    { MainContent },
  ] = await Promise.all([
    import('@/renderer/src/redux/slices/uiSlice'),
    import('@/renderer/src/redux/slices/skillsSlice'),
    import('@/renderer/src/redux/slices/agentsSlice'),
    import('@/renderer/src/redux/slices/bookmarkSlice'),
    import('@/renderer/src/redux/slices/marketplaceSlice'),
    import('@/renderer/src/redux/slices/settingsSlice'),
    import('./MainContent'),
  ])
  const store = configureStore({
    reducer: {
      ui: uiReducer,
      skills: skillsReducer,
      agents: agentsReducer,
      bookmarks: bookmarksReducer,
      marketplace: marketplaceReducer,
      settings: settingsReducer,
    },
    preloadedState: {
      settings: { ...DEFAULT_SETTINGS },
    },
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

describe('MainContent SelectionToolbar integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOnDeleteProgress.mockImplementation(() => () => {})
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
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('Select all visible excludes broken and inaccessible agent rows from bulk unlink payload', async () => {
    const { screen, store } = await renderMainContentWithToolbar()
    const { fetchAgents } =
      await import('@/renderer/src/redux/slices/agentsSlice')
    const { enterBulkSelectMode, selectAgent } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { fetchSkills, toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const metadataName = 'valid-toolbar-task' as SkillName
    const slotName = 'valid-toolbar-folder' as SkillName

    // Arrange
    store.dispatch(fetchAgents.fulfilled([CURSOR_AGENT], 'agents-req'))
    store.dispatch(
      fetchSkills.fulfilled(
        [
          makeCursorSkill(metadataName, 'valid', slotName),
          makeCursorSkill('broken-toolbar-task' as SkillName, 'broken'),
          makeCursorSkill(
            'inaccessible-toolbar-task' as SkillName,
            'inaccessible',
          ),
        ],
        'skills-req',
      ),
    )
    store.dispatch(selectAgent('cursor'))
    store.dispatch(enterBulkSelectMode())
    store.dispatch(toggleSelection(metadataName))
    store.dispatch(toggleSelection('broken-toolbar-task' as SkillName))

    // Act
    await expect
      .element(screen.getByRole('group', { name: 'Bulk selection actions' }))
      .toBeVisible()
    await expect.element(screen.getByText('+1 not eligible')).toBeVisible()
    expect(screen.getByText(/hidden by filter/).query()).toBeNull()
    await screen.getByRole('button', { name: 'Select all visible' }).click()

    // Assert
    expect(store.getState().skills.selectedSkillNames).toEqual([metadataName])

    await screen
      .getByRole('button', { name: 'Unlink selected skill from Cursor' })
      .click()
    await screen.getByRole('button', { name: 'Unlink' }).click()

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
})
