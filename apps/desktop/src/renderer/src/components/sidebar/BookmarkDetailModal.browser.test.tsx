import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'

import { TooltipProvider } from '@/renderer/src/components/ui/tooltip'
import type { BookmarkForDetail } from '@/renderer/src/redux/slices/uiSlice'
import {
  repositoryId,
  toHttpUrl,
  toIsoTimestamp,
  toSkillName,
} from '@/shared/types'

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
    name: toSkillName('task'),
    repo: repositoryId('vercel-labs/skills'),
    url: toHttpUrl('https://skills.sh/task'),
    bookmarkedAt: toIsoTimestamp('2026-04-01T08:00:00.000Z'),
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
      onProgress: vi.fn(() => (): void => {}),
    },
    skills: {
      getAll: vi.fn().mockResolvedValue([]),
      onDeleteProgress: vi.fn(() => (): void => {}),
    },
    agents: { getAll: vi.fn().mockResolvedValue([]) },
    marketplace: { leaderboard: vi.fn().mockResolvedValue([]) },
    // Clicking the repo link routes through shell.openExternal.
    shell: { openExternal: vi.fn().mockResolvedValue(undefined) },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Build the reducer store shared by BookmarkDetailModal and the InstallModal it
 * hands off to. Includes the bookmarks slice so the Remove action has a real
 * source of truth to mutate.
 * @returns Redux store with ui, marketplace, agents, skills, and bookmarks slices.
 */
async function createStore() {
  const [
    { default: uiReducer },
    { default: marketplaceReducer },
    { default: agentsReducer },
    { default: skillsReducer },
    { default: bookmarksReducer },
  ] = await Promise.all([
    import('@/renderer/src/redux/slices/uiSlice'),
    import('@/renderer/src/redux/slices/marketplaceSlice'),
    import('@/renderer/src/redux/slices/agentsSlice'),
    import('@/renderer/src/redux/slices/skillsSlice'),
    import('@/renderer/src/redux/slices/bookmarkSlice'),
  ])

  const store = configureStore({
    reducer: {
      ui: uiReducer,
      marketplace: marketplaceReducer,
      agents: agentsReducer,
      skills: skillsReducer,
      bookmarks: bookmarksReducer,
    },
  })
  const { addBookmark } =
    await import('@/renderer/src/redux/slices/bookmarkSlice')
  store.dispatch(addBookmark(makeBookmark()))
  return store
}

describe('BookmarkDetailModal install', () => {
  test('closes the detail modal and opens the shared Install Skill modal seeded with the bookmark', async () => {
    // Arrange
    const store = await createStore()
    const { BookmarkDetailModal } = await import('./BookmarkDetailModal')
    const { InstallModal } =
      await import('@/renderer/src/components/marketplace/InstallModal')
    const { setSelectedBookmarkForDetail } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const screen = await render(
      <Provider store={store}>
        <TooltipProvider>
          <BookmarkDetailModal />
        </TooltipProvider>
        <InstallModal />
      </Provider>,
    )
    store.dispatch(setSelectedBookmarkForDetail(makeBookmark().name))
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

describe('BookmarkDetailModal remove', () => {
  test('deletes the bookmark from the list and dismisses the modal when Remove Bookmark is clicked', async () => {
    // Arrange
    const store = await createStore()
    const { BookmarkDetailModal } = await import('./BookmarkDetailModal')
    const { setSelectedBookmarkForDetail } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { addBookmark } =
      await import('@/renderer/src/redux/slices/bookmarkSlice')
    store.dispatch(
      addBookmark({
        name: toSkillName('task'),
        repo: repositoryId('vercel-labs/skills'),
        url: toHttpUrl('https://skills.sh/task'),
      }),
    )
    const screen = await render(
      <Provider store={store}>
        <TooltipProvider>
          <BookmarkDetailModal />
        </TooltipProvider>
      </Provider>,
    )
    store.dispatch(setSelectedBookmarkForDetail(makeBookmark().name))
    await expect
      .element(screen.getByRole('button', { name: 'Remove Bookmark' }))
      .toBeInTheDocument()

    // Act
    await screen.getByRole('button', { name: 'Remove Bookmark' }).click()

    // Assert
    expect(store.getState().bookmarks.items).toEqual([])
    await expect
      .poll(() => store.getState().ui.selectedBookmarkForDetail)
      .toBeNull()
    await expect
      .element(screen.getByRole('button', { name: 'Remove Bookmark' }))
      .not.toBeInTheDocument()
  })
})

describe('BookmarkDetailModal dismiss', () => {
  test('clears the selected bookmark when the modal is closed via the Close button', async () => {
    // Arrange
    const store = await createStore()
    const { BookmarkDetailModal } = await import('./BookmarkDetailModal')
    const { setSelectedBookmarkForDetail } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const screen = await render(
      <Provider store={store}>
        <TooltipProvider>
          <BookmarkDetailModal />
        </TooltipProvider>
      </Provider>,
    )
    store.dispatch(setSelectedBookmarkForDetail(makeBookmark().name))
    await expect
      .element(screen.getByRole('button', { name: 'Close' }))
      .toBeInTheDocument()

    // Act
    await screen.getByRole('button', { name: 'Close' }).click()

    // Assert
    await expect
      .poll(() => store.getState().ui.selectedBookmarkForDetail)
      .toBeNull()
  })
})

describe('BookmarkDetailModal categories', () => {
  test('shows Blue for a retired swatch and preserves its stored key until Blue is explicitly selected', async () => {
    // Arrange
    const store = await createStore()
    const { BookmarkDetailModal } = await import('./BookmarkDetailModal')
    const { saveBookmarkCategory, assignBookmarkCategory } =
      await import('../../redux/slices/bookmarkSlice')
    const { setSelectedBookmarkForDetail } =
      await import('../../redux/slices/uiSlice')
    store.dispatch(
      saveBookmarkCategory({
        category: { id: 'security', name: 'Security', color: 'retired-violet' },
      }),
    )
    store.dispatch(
      assignBookmarkCategory({
        name: toSkillName('task'),
        categoryId: 'security',
      }),
    )
    store.dispatch(setSelectedBookmarkForDetail(toSkillName('task')))
    const screen = await render(
      <Provider store={store}>
        <TooltipProvider>
          <BookmarkDetailModal />
        </TooltipProvider>
      </Provider>,
    )
    const blue = screen.getByRole('radio', { name: 'Blue', exact: true })
    const apply = screen.getByRole('button', { name: 'Apply', exact: true })

    // Act — edit just the category name while the saved color is unavailable.
    await screen.getByRole('button', { name: 'Security', exact: true }).click()
    await screen.getByRole('menuitem', { name: 'Edit Security' }).click()
    await expect.element(blue).toBeChecked()
    await screen.getByRole('textbox', { name: 'Name' }).fill('Security checks')
    await apply.click()

    // Assert — a name edit preserves the key, and an explicit click on the fallback commits Blue.
    expect(
      store
        .getState()
        .bookmarks.categories.find((item) => item.id === 'security'),
    ).toEqual({
      id: 'security',
      name: 'Security checks',
      color: 'retired-violet',
    })
    await screen
      .getByRole('button', { name: 'Security checks', exact: true })
      .click()
    await screen.getByRole('menuitem', { name: 'Edit Security checks' }).click()
    await blue.click()
    await apply.click()
    expect(
      store
        .getState()
        .bookmarks.categories.find((item) => item.id === 'security')?.color,
    ).toBe('blue')
  })

  // Value: protects=live details keep the original link after repeated Apply, rename and clearing;
  // fails_when=an open detail snapshots the category or a rapid submit creates two categories; why_new=Installed tests do not render the detail; seam=none.
  test('applies a new category once and shows its renamed and cleared state in the same open detail', async () => {
    // Arrange
    const store = await createStore()
    const { BookmarkDetailModal } = await import('./BookmarkDetailModal')
    const { setSelectedBookmarkForDetail, clearSelectedBookmarkForDetail } =
      await import('../../redux/slices/uiSlice')
    const { BookmarkCategoryPicker } =
      await import('../bookmarks/BookmarkCategoryPicker')
    store.dispatch(setSelectedBookmarkForDetail(toSkillName('task')))
    const screen = await render(
      <Provider store={store}>
        <TooltipProvider>
          <BookmarkCategoryPicker
            skillName={toSkillName('task')}
            open={false}
            onOpenChange={() => {}}
          />
          <BookmarkDetailModal />
        </TooltipProvider>
      </Provider>,
    )
    const link = screen.getByRole('link', { name: 'vercel-labs/skills' })

    // Act — deliver two submissions in one event turn, before losing the original Apply target.
    await screen
      .getByRole('button', { name: 'Set category', exact: true })
      .click()
    await screen.getByRole('menuitem', { name: 'New category' }).click()
    // Both pickers target the same bookmark. Only the detail and its own editor may be mounted.
    expect(
      document.querySelectorAll('[role="dialog"][data-state="open"]'),
    ).toHaveLength(2)
    await screen
      .getByRole('textbox', { name: 'Name' })
      .fill('Dependency review')
    const apply = screen
      .getByRole('button', { name: 'Apply', exact: true })
      .element() as HTMLButtonElement
    apply.click()
    apply.click()
    const created = screen.getByRole('button', {
      name: 'Dependency review',
      exact: true,
    })
    await expect.element(created).toBeVisible()
    expect(
      store
        .getState()
        .bookmarks.categories.filter((c) => c.name === 'Dependency review'),
    ).toHaveLength(1)
    const id = store.getState().bookmarks.items[0].categoryId
    await created.click()
    await screen
      .getByRole('menuitem', { name: 'Edit Dependency review' })
      .click()
    await screen.getByRole('textbox', { name: 'Name' }).fill('Supply chain')
    await screen.getByRole('radio', { name: 'Teal', exact: true }).click()
    await screen.getByRole('button', { name: 'Apply', exact: true }).click()

    // Assert — the detail updates in place, and clearing only removes its assignment.
    const renamed = screen.getByRole('button', {
      name: 'Supply chain',
      exact: true,
    })
    await expect.element(renamed).toBeVisible()
    expect(
      store.getState().bookmarks.categories.find((c) => c.id === id),
    ).toMatchObject({ name: 'Supply chain', color: 'teal' })
    expect(store.getState().bookmarks.items[0].categoryId).toBe(id)
    await renamed.click()
    await screen
      .getByRole('menuitem', { name: 'Uncategorized', exact: true })
      .click()
    await expect
      .element(
        screen.getByRole('button', { name: 'Set category', exact: true }),
      )
      .toBeVisible()
    await expect.element(link).toHaveAttribute('href', 'https://skills.sh/task')
    expect(store.getState().bookmarks.items).toHaveLength(1)
    expect(store.getState().bookmarks.items[0].categoryId).toBeUndefined()

    // Closing the detail also releases its editor, even while the Installed picker survives.
    await screen
      .getByRole('button', { name: 'Set category', exact: true })
      .click()
    await screen.getByRole('menuitem', { name: 'New category' }).click()
    await expect
      .element(screen.getByRole('dialog', { name: 'New category' }))
      .toBeVisible()
    store.dispatch(clearSelectedBookmarkForDetail())
    await expect
      .poll(() => store.getState().ui.bookmarkCategoryEditor)
      .toBeNull()
  })
})

describe('BookmarkDetailModal source link', () => {
  test('opens the bookmark source repository externally when the repo link is clicked', async () => {
    // Arrange
    const store = await createStore()
    const { BookmarkDetailModal } = await import('./BookmarkDetailModal')
    const { setSelectedBookmarkForDetail } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const screen = await render(
      <Provider store={store}>
        <TooltipProvider>
          <BookmarkDetailModal />
        </TooltipProvider>
      </Provider>,
    )
    store.dispatch(setSelectedBookmarkForDetail(makeBookmark().name))
    await expect
      .element(screen.getByRole('link', { name: 'vercel-labs/skills' }))
      .toBeInTheDocument()

    // Act — opening announces the title, then Tab and Enter open the exact saved URL.
    await expect
      .element(screen.getByRole('heading', { name: 'task' }))
      .toHaveFocus()
    await userEvent.keyboard('{Tab}')
    await expect
      .element(screen.getByRole('link', { name: 'vercel-labs/skills' }))
      .toHaveFocus()
    await userEvent.keyboard('{Enter}')

    // Assert
    expect(window.electron.shell.openExternal).toHaveBeenCalledWith(
      'https://skills.sh/task',
    )
  })

  test('keeps the detail modal open when opening the source repository fails', async () => {
    // Arrange
    const store = await createStore()
    const { BookmarkDetailModal } = await import('./BookmarkDetailModal')
    const { setSelectedBookmarkForDetail } =
      await import('@/renderer/src/redux/slices/uiSlice')
    // Retarget the shell mock so the external-open promise rejects, exercising
    // the repo button's .catch swallow path (a left-open rejection would fail
    // the run as an unhandled rejection).
    const diagnostic = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(window.electron.shell.openExternal)
      .mockRejectedValueOnce(
        new TypeError('https://private.example.test/secret-skill'),
      )
      .mockResolvedValueOnce(undefined)
    const screen = await render(
      <Provider store={store}>
        <TooltipProvider>
          <BookmarkDetailModal />
        </TooltipProvider>
      </Provider>,
    )
    store.dispatch(setSelectedBookmarkForDetail(makeBookmark().name))
    await expect
      .element(screen.getByRole('link', { name: 'vercel-labs/skills' }))
      .toBeInTheDocument()

    // Act
    await screen.getByRole('link', { name: 'vercel-labs/skills' }).click()

    // Assert
    await expect
      .element(screen.getByRole('link', { name: 'vercel-labs/skills' }))
      .toBeInTheDocument()
    expect(window.electron.shell.openExternal).toHaveBeenCalledWith(
      'https://skills.sh/task',
    )
    await expect
      .element(screen.getByRole('alert'))
      .toHaveTextContent(
        'Couldn’t open the source. If it isn’t open in your browser, try the link again.',
      )
    expect(diagnostic).toHaveBeenCalledExactlyOnceWith(
      '[bookmarks] source handoff failed',
      {
        operation: 'open-bookmark-source',
        stage: 'openExternal',
        kind: 'TypeError',
      },
    )
    await screen.getByRole('link', { name: 'vercel-labs/skills' }).click()
    await expect.element(screen.getByRole('alert')).not.toBeInTheDocument()
    diagnostic.mockRestore()
  })
})
