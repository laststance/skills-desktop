import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import { TooltipProvider } from '@/renderer/src/components/ui/tooltip'
import { repositoryId } from '@/shared/types'

beforeEach(() => {
  // BookmarksSection mounts BookmarkItem + BookmarkDetailModal, which can reach
  // for the IPC bridge; stub it so incidental window.electron access never throws
  // in the Chromium lane.
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
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Build the reducer store wiring every slice BookmarksSection and its children
 * read from: bookmarks (the list source), skills (install-status derivation),
 * marketplace + agents (BookmarkItem install handoff), ui (detail modal).
 * @returns Redux store seeded by the caller via dispatched bookmark actions.
 */
async function createStore() {
  const [
    { default: bookmarkReducer },
    { default: skillsReducer },
    { default: marketplaceReducer },
    { default: agentsReducer },
    { default: uiReducer },
  ] = await Promise.all([
    import('@/renderer/src/redux/slices/bookmarkSlice'),
    import('@/renderer/src/redux/slices/skillsSlice'),
    import('@/renderer/src/redux/slices/marketplaceSlice'),
    import('@/renderer/src/redux/slices/agentsSlice'),
    import('@/renderer/src/redux/slices/uiSlice'),
  ])

  return configureStore({
    reducer: {
      bookmarks: bookmarkReducer,
      skills: skillsReducer,
      marketplace: marketplaceReducer,
      agents: agentsReducer,
      ui: uiReducer,
    },
  })
}

describe('BookmarksSection', () => {
  it('lists each bookmarked skill under a count that matches how many are bookmarked', async () => {
    // Arrange
    const store = await createStore()
    const { BookmarksSection } = await import('./BookmarksSection')
    const { addBookmark } =
      await import('@/renderer/src/redux/slices/bookmarkSlice')
    store.dispatch(
      addBookmark({
        name: 'task',
        repo: repositoryId('vercel-labs/skills'),
        url: 'https://skills.sh/task',
      }),
    )
    store.dispatch(
      addBookmark({
        name: 'lint',
        repo: repositoryId('vercel-labs/skills'),
        url: 'https://skills.sh/lint',
      }),
    )

    // Act
    const screen = await render(
      <Provider store={store}>
        <TooltipProvider>
          <BookmarksSection />
        </TooltipProvider>
      </Provider>,
    )

    // Assert
    await expect.element(screen.getByText('(2)')).toBeInTheDocument()
    await expect.element(screen.getByText('task')).toBeInTheDocument()
    await expect.element(screen.getByText('lint')).toBeInTheDocument()
  })
})
