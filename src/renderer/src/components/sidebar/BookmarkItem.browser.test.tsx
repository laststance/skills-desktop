import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'

import { TooltipProvider } from '@/renderer/src/components/ui/tooltip'
import type { BookmarkForDetail } from '@/renderer/src/redux/slices/uiSlice'
import { repositoryId } from '@/shared/types'

/**
 * Build a not-yet-installed sidebar bookmark fixture (so the Install affordance
 * renders rather than the "Installed" check).
 * @param overrides - Fields that differ from the default fixture.
 * @returns Complete BookmarkForDetail accepted by BookmarkItem.
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
  // InstallModal reads only Redux state on mount, but stub the IPC bridge so any
  // incidental window.electron access never throws in the Chromium lane.
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
 * Build the reducer store shared by BookmarkItem and the hoisted InstallModal.
 * Includes bookmarks + ui slices so the remove/open-detail dispatches are observable.
 * @returns Redux store with marketplace, agents, skills, bookmarks, and ui slices.
 */
async function createStore() {
  const [
    { default: marketplaceReducer },
    { default: agentsReducer },
    { default: skillsReducer },
    { default: bookmarkReducer },
    { default: uiReducer },
  ] = await Promise.all([
    import('@/renderer/src/redux/slices/marketplaceSlice'),
    import('@/renderer/src/redux/slices/agentsSlice'),
    import('@/renderer/src/redux/slices/skillsSlice'),
    import('@/renderer/src/redux/slices/bookmarkSlice'),
    import('@/renderer/src/redux/slices/uiSlice'),
  ])

  return configureStore({
    reducer: {
      marketplace: marketplaceReducer,
      agents: agentsReducer,
      skills: skillsReducer,
      bookmarks: bookmarkReducer,
      ui: uiReducer,
    },
  })
}

describe('BookmarkItem install', () => {
  it('opens the shared Install Skill modal seeded with the bookmark', async () => {
    // Arrange
    const store = await createStore()
    const { BookmarkItem } = await import('./BookmarkItem')
    const { InstallModal } =
      await import('@/renderer/src/components/marketplace/InstallModal')
    const bookmark = makeBookmark()
    const screen = await render(
      <Provider store={store}>
        <TooltipProvider>
          <BookmarkItem bookmark={bookmark} />
          <InstallModal />
        </TooltipProvider>
      </Provider>,
    )

    // Act
    await screen.getByRole('button', { name: 'Install task' }).click()

    // Assert
    await expect
      .element(screen.getByRole('dialog', { name: 'Install Skill' }))
      .toBeInTheDocument()
    expect(store.getState().marketplace.selectedSkill).toEqual({
      name: 'task',
      repo: 'vercel-labs/skills',
    })
  })

  it('does not open the install modal for a bookmark with no source repo', async () => {
    // Arrange
    const store = await createStore()
    const { BookmarkItem } = await import('./BookmarkItem')
    const { InstallModal } =
      await import('@/renderer/src/components/marketplace/InstallModal')
    // A repo-less bookmark still shows the Install affordance, but the empty-repo
    // guard must make the click a no-op (there is nothing to install from).
    const localBookmark = makeBookmark({ repo: '' })
    const screen = await render(
      <Provider store={store}>
        <TooltipProvider>
          <BookmarkItem bookmark={localBookmark} />
          <InstallModal />
        </TooltipProvider>
      </Provider>,
    )

    // Act
    await screen.getByRole('button', { name: 'Install task' }).click()

    // Assert
    expect(store.getState().marketplace.selectedSkill).toBeNull()
    expect(
      screen.getByRole('dialog', { name: 'Install Skill' }).query(),
    ).toBeNull()
  })
})

describe('BookmarkItem detail view', () => {
  it('opens the skill detail view when the row is clicked', async () => {
    // Arrange
    const store = await createStore()
    const { BookmarkItem } = await import('./BookmarkItem')
    const bookmark = makeBookmark()
    const screen = await render(
      <Provider store={store}>
        <TooltipProvider>
          <BookmarkItem bookmark={bookmark} />
        </TooltipProvider>
      </Provider>,
    )

    // Act
    await screen.getByRole('button', { name: 'View details for task' }).click()

    // Assert
    expect(store.getState().ui.selectedBookmarkForDetail).toEqual(bookmark)
  })

  it('opens the skill detail view when Enter is pressed on the focused row', async () => {
    // Arrange
    const store = await createStore()
    const { BookmarkItem } = await import('./BookmarkItem')
    const bookmark = makeBookmark()
    const screen = await render(
      <Provider store={store}>
        <TooltipProvider>
          <BookmarkItem bookmark={bookmark} />
        </TooltipProvider>
      </Provider>,
    )
    // Focus the row directly (not via click) so the keypress is the only trigger
    // that could open the detail view — clicking would itself open it and mask the result.
    const row = screen.getByRole('button', { name: 'View details for task' })
    row.element().focus()

    // Act
    await userEvent.keyboard('{Enter}')

    // Assert
    expect(store.getState().ui.selectedBookmarkForDetail).toEqual(bookmark)
  })
})

describe('BookmarkItem remove', () => {
  it('removing a bookmark drops it from the list without opening its detail view', async () => {
    // Arrange
    const store = await createStore()
    const { addBookmark } =
      await import('@/renderer/src/redux/slices/bookmarkSlice')
    const { BookmarkItem } = await import('./BookmarkItem')
    const bookmark = makeBookmark()
    // Seed the store so the remove reducer has a matching entry to filter out.
    store.dispatch(
      addBookmark({
        name: bookmark.name,
        repo: bookmark.repo,
        url: bookmark.url,
      }),
    )
    const screen = await render(
      <Provider store={store}>
        <TooltipProvider>
          <BookmarkItem bookmark={bookmark} />
        </TooltipProvider>
      </Provider>,
    )

    // Act
    await screen
      .getByRole('button', { name: 'Remove task from bookmarks' })
      .click()

    // Assert
    expect(store.getState().bookmarks.items).toEqual([])
    // stopPropagation must keep the row's own click (open detail) from firing.
    expect(store.getState().ui.selectedBookmarkForDetail).toBeNull()
  })
})
