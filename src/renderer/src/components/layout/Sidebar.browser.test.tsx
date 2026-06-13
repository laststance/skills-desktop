import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import { TooltipProvider } from '@/renderer/src/components/ui/tooltip'
import { DEFAULT_SETTINGS } from '@/shared/settings'
import { repositoryId } from '@/shared/types'

beforeEach(() => {
  // SidebarHeader reads the build-time `__APP_VERSION__` define; browser mode has
  // no electron-vite `define`, so install a version before the header mounts.
  vi.stubGlobal('__APP_VERSION__', '0.21.1')
  // Sidebar renders SourceCard, AgentsSection, SidebarFooter, AgentDeleteDialog,
  // and (when bookmarks exist) BookmarksSection — several of which reach the IPC
  // bridge. Browser mode strips the preload context, so plant a fake before mount.
  vi.stubGlobal('electron', {
    skillsCli: {
      search: vi.fn(),
      install: vi.fn(),
      cancel: vi.fn(),
      onProgress: vi.fn(() => () => {}),
    },
    skills: {
      getAll: vi.fn().mockResolvedValue([]),
      onDeleteProgress: vi.fn(() => () => {}),
    },
    agents: { getAll: vi.fn().mockResolvedValue([]) },
    marketplace: { leaderboard: vi.fn().mockResolvedValue([]) },
    settings: { open: vi.fn() },
    shell: { openExternal: vi.fn() },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Build the combined store with every slice Sidebar and its real children read:
 * bookmarks (the conditional source), ui/agents/skills/marketplace (children),
 * settings (hidden-agent filtering) preloaded to DEFAULT_SETTINGS.
 * @returns Redux store seeded by the caller via dispatched actions.
 */
async function createStore() {
  const [
    { default: uiReducer },
    { default: skillsReducer },
    { default: agentsReducer },
    { default: bookmarksReducer },
    { default: marketplaceReducer },
    { default: settingsReducer },
    { default: themeReducer },
  ] = await Promise.all([
    import('@/renderer/src/redux/slices/uiSlice'),
    import('@/renderer/src/redux/slices/skillsSlice'),
    import('@/renderer/src/redux/slices/agentsSlice'),
    import('@/renderer/src/redux/slices/bookmarkSlice'),
    import('@/renderer/src/redux/slices/marketplaceSlice'),
    import('@/renderer/src/redux/slices/settingsSlice'),
    import('@/renderer/src/redux/slices/themeSlice'),
  ])

  return configureStore({
    reducer: {
      ui: uiReducer,
      skills: skillsReducer,
      agents: agentsReducer,
      bookmarks: bookmarksReducer,
      marketplace: marketplaceReducer,
      settings: settingsReducer,
      theme: themeReducer,
    },
    preloadedState: {
      settings: { ...DEFAULT_SETTINGS },
    },
  })
}

/**
 * Render Sidebar inside its required provider stack (Redux + Tooltip).
 * @returns { screen, store } — screen exposes vitest-browser-react locators.
 */
async function renderSidebar() {
  const store = await createStore()
  const { Sidebar } = await import('./Sidebar')
  const screen = await render(
    <Provider store={store}>
      <TooltipProvider>
        <Sidebar />
      </TooltipProvider>
    </Provider>,
  )
  return { screen, store }
}

describe('Sidebar', () => {
  it('exposes the agent sidebar as a labelled landmark region', async () => {
    // Arrange
    const { screen } = await renderSidebar()

    // Act
    const sidebar = screen.getByRole('complementary', { name: 'Agent sidebar' })

    // Assert
    await expect.element(sidebar).toBeInTheDocument()
  })

  it('hides the bookmarks list while nothing is bookmarked', async () => {
    // Arrange
    const { screen } = await renderSidebar()

    // Assert
    // Empty bookmarks → the conditional BookmarksSection stays out of the tree.
    expect(screen.getByText('Bookmarks').query()).toBeNull()
  })

  it('reveals a bookmarked skill in the sidebar once it is bookmarked', async () => {
    // Arrange
    const { screen, store } = await renderSidebar()
    const { addBookmark } =
      await import('@/renderer/src/redux/slices/bookmarkSlice')

    // Act
    store.dispatch(
      addBookmark({
        name: 'task',
        repo: repositoryId('vercel-labs/skills'),
        url: 'https://skills.sh/task',
      }),
    )

    // Assert
    await expect.element(screen.getByText('task')).toBeInTheDocument()
  })
})
