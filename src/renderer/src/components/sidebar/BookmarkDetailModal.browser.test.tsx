import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import type { BookmarkForDetail } from '@/renderer/src/redux/slices/uiSlice'
import { repositoryId } from '@/shared/types'

/**
 * Build a not-yet-installed bookmark fixture so the detail modal shows its
 * Install button (its repo is non-empty, so the install path is reachable).
 * @param overrides - Fields that differ from the default fixture.
 * @returns Complete BookmarkForDetail accepted by uiSlice.
 * @example makeBookmark({ name: 'lint' })
 */
function makeBookmark(
  overrides: Partial<BookmarkForDetail> = {},
): BookmarkForDetail {
  return {
    name: 'task',
    repo: repositoryId('vercel-labs/skills'),
    url: 'https://skills.sh/task',
    bookmarkedAt: '2026-04-01T08:00:00.000Z',
    isInstalled: false,
    ...overrides,
  }
}

beforeEach(() => {
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
 * Build the reducer store shared by BookmarkDetailModal and the InstallModal it
 * hands off to.
 * @returns Redux store with ui, marketplace, agents, and skills slices.
 */
async function createStore() {
  const [
    { default: uiReducer },
    { default: marketplaceReducer },
    { default: agentsReducer },
    { default: skillsReducer },
  ] = await Promise.all([
    import('@/renderer/src/redux/slices/uiSlice'),
    import('@/renderer/src/redux/slices/marketplaceSlice'),
    import('@/renderer/src/redux/slices/agentsSlice'),
    import('@/renderer/src/redux/slices/skillsSlice'),
  ])

  return configureStore({
    reducer: {
      ui: uiReducer,
      marketplace: marketplaceReducer,
      agents: agentsReducer,
      skills: skillsReducer,
    },
  })
}

describe('BookmarkDetailModal install', () => {
  it('closes the detail modal and opens the shared Install Skill modal seeded with the bookmark', async () => {
    // Arrange
    const store = await createStore()
    const { BookmarkDetailModal } = await import('./BookmarkDetailModal')
    const { InstallModal } =
      await import('@/renderer/src/components/marketplace/InstallModal')
    const { setSelectedBookmarkForDetail } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const screen = await render(
      <Provider store={store}>
        <BookmarkDetailModal />
        <InstallModal />
      </Provider>,
    )
    store.dispatch(setSelectedBookmarkForDetail(makeBookmark()))
    await expect
      .element(screen.getByRole('button', { name: 'Remove Bookmark' }))
      .toBeInTheDocument()

    // Act
    await screen.getByRole('button', { name: 'Install' }).click()

    // Assert
    await expect
      .element(screen.getByRole('dialog', { name: 'Install Skill' }))
      .toBeInTheDocument()
    await expect
      .poll(() => store.getState().ui.selectedBookmarkForDetail)
      .toBeNull()
    expect(store.getState().marketplace.selectedSkill).toEqual({
      name: 'task',
      repo: 'vercel-labs/skills',
    })
  })
})
