import { configureStore } from '@reduxjs/toolkit'
import { describe, expect, it } from 'vitest'

import type {
  DashboardPage,
  DashboardPageId,
  WidgetInstanceId,
} from '@/renderer/src/components/dashboard/types'

// Dynamic import keeps the slice out of the module graph until each test
// needs it — matches the pattern established by `bookmarkSlice.test.ts` and
// gives every test a pristine reducer/initial state.
async function createTestStore() {
  const { default: dashboardReducer } = await import('./dashboardSlice')
  return configureStore({ reducer: { dashboard: dashboardReducer } })
}

/**
 * Builds a store whose dashboard slice starts from a caller-supplied state —
 * used to reproduce arrangements (e.g. a stale `currentPageId`) that the public
 * actions deliberately never produce on their own.
 * @param dashboard - Full dashboard slice state to preload.
 * @returns A configured store seeded with that dashboard state.
 * @example
 * const store = await createTestStoreWithDashboard({ pages: [page], currentPageId: 'p_stale' as DashboardPageId, isEditMode: false, welcomeDismissed: false, initialized: true })
 */
async function createTestStoreWithDashboard(dashboard: {
  pages: DashboardPage[]
  currentPageId: DashboardPageId | null
  isEditMode: boolean
  welcomeDismissed: boolean
  initialized: boolean
}) {
  const { default: dashboardReducer } = await import('./dashboardSlice')
  return configureStore({
    reducer: { dashboard: dashboardReducer },
    preloadedState: { dashboard },
  })
}

describe('dashboardSlice', () => {
  describe('initial state', () => {
    it('starts with no pages, not in edit mode, and before first-run seeding', async () => {
      // Arrange
      const store = await createTestStore()

      // Act
      const state = store.getState().dashboard

      // Assert
      expect(state.pages).toEqual([])
      expect(state.currentPageId).toBeNull()
      expect(state.isEditMode).toBe(false)
      expect(state.welcomeDismissed).toBe(false)
      expect(state.initialized).toBe(false)
    })
  })

  describe('seedDefaultsIfEmpty', () => {
    it('lays out the four default pages and selects the first on first run', async () => {
      // Arrange
      const { seedDefaultsIfEmpty } = await import('./dashboardSlice')
      const store = await createTestStore()

      // Act
      store.dispatch(seedDefaultsIfEmpty())

      // Assert
      const state = store.getState().dashboard
      expect(state.pages.map((page) => page.name)).toEqual([
        'Overview',
        'Discovery',
        'Actions',
        'Personal',
      ])
      expect(state.currentPageId).toBe(state.pages[0].id)
      expect(state.initialized).toBe(true)
    })

    it('leaves an already-seeded dashboard untouched on a second seed', async () => {
      // Arrange
      const { seedDefaultsIfEmpty } = await import('./dashboardSlice')
      const store = await createTestStore()
      store.dispatch(seedDefaultsIfEmpty())
      const firstPages = store.getState().dashboard.pages

      // Act
      store.dispatch(seedDefaultsIfEmpty())
      const secondPages = store.getState().dashboard.pages

      // Assert
      // Same reference → reducer didn't rebuild the pages.
      expect(secondPages).toBe(firstPages)
    })
  })

  describe('setCurrentPage', () => {
    it('navigates to the selected page', async () => {
      // Arrange
      const { seedDefaultsIfEmpty, setCurrentPage } =
        await import('./dashboardSlice')
      const store = await createTestStore()
      store.dispatch(seedDefaultsIfEmpty())
      const discoveryPage = store.getState().dashboard.pages[1]

      // Act
      store.dispatch(setCurrentPage(discoveryPage.id))

      // Assert
      expect(store.getState().dashboard.currentPageId).toBe(discoveryPage.id)
    })

    it('stays on the current page when asked to navigate to a stale page id', async () => {
      // Arrange
      const { seedDefaultsIfEmpty, setCurrentPage } =
        await import('./dashboardSlice')
      const store = await createTestStore()
      store.dispatch(seedDefaultsIfEmpty())
      const initialPageId = store.getState().dashboard.currentPageId

      // Act
      store.dispatch(setCurrentPage('p_not_a_real_id' as DashboardPageId))

      // Assert
      expect(store.getState().dashboard.currentPageId).toBe(initialPageId)
    })
  })

  describe('toggleEditMode', () => {
    it('enters and leaves edit mode on alternating toggles', async () => {
      // Arrange
      const { toggleEditMode } = await import('./dashboardSlice')
      const store = await createTestStore()

      // Assert
      expect(store.getState().dashboard.isEditMode).toBe(false)

      // Act
      store.dispatch(toggleEditMode())

      // Assert
      expect(store.getState().dashboard.isEditMode).toBe(true)

      // Act
      store.dispatch(toggleEditMode())

      // Assert
      expect(store.getState().dashboard.isEditMode).toBe(false)
    })
  })

  describe('addWidget', () => {
    it('drops the new widget onto the current page when it still has room', async () => {
      // Arrange
      const { addWidget, seedDefaultsIfEmpty, setCurrentPage } =
        await import('./dashboardSlice')
      const store = await createTestStore()
      store.dispatch(seedDefaultsIfEmpty())
      // Actions page seeds with 1 widget → room for more.
      const actionsPage = store.getState().dashboard.pages[2]
      store.dispatch(setCurrentPage(actionsPage.id))

      // Act
      store.dispatch(addWidget({ type: 'stats' }))

      // Assert
      const currentPage = store.getState().dashboard.pages[2]
      expect(currentPage.widgets.length).toBe(2)
      const appendedWidget = currentPage.widgets[currentPage.widgets.length - 1]
      expect(appendedWidget.type).toBe('stats')
    })

    it('spills the new widget onto a fresh page and opens it when the current page is full', async () => {
      // Arrange
      const { addWidget, seedDefaultsIfEmpty, setCurrentPage } =
        await import('./dashboardSlice')
      const store = await createTestStore()
      store.dispatch(seedDefaultsIfEmpty())
      // Overview seeds with 4 widgets — hits MAX_WIDGETS_PER_PAGE.
      const overviewPage = store.getState().dashboard.pages[0]
      store.dispatch(setCurrentPage(overviewPage.id))

      // Act
      store.dispatch(addWidget({ type: 'stats' }))

      // Assert
      const state = store.getState().dashboard
      // 4 seeded pages + 1 auto-created overflow page.
      expect(state.pages.length).toBe(5)
      // Auto-created page becomes the current page.
      expect(state.currentPageId).toBe(state.pages[state.pages.length - 1].id)
    })

    it('drops the new widget on the first page when the active page id is stale', async () => {
      // Arrange
      // A persisted/rehydrated arrangement can point currentPageId at a page
      // that no longer exists; addWidget must fall back to the first page
      // rather than spilling onto a brand-new overflow page.
      const { addWidget } = await import('./dashboardSlice')
      const firstPage: DashboardPage = {
        id: 'p_first' as DashboardPageId,
        name: 'First',
        widgets: [],
      }
      const store = await createTestStoreWithDashboard({
        pages: [firstPage],
        currentPageId: 'p_gone' as DashboardPageId,
        isEditMode: false,
        welcomeDismissed: false,
        initialized: true,
      })

      // Act
      store.dispatch(addWidget({ type: 'stats' }))

      // Assert
      const state = store.getState().dashboard
      // No overflow page was created — the widget landed on the existing page.
      expect(state.pages.length).toBe(1)
      expect(state.pages[0].id).toBe('p_first')
      expect(state.pages[0].widgets.length).toBe(1)
      expect(state.pages[0].widgets[0].type).toBe('stats')
    })
  })

  describe('updateLayout', () => {
    it('repositions widgets to match a layout dragged in react-grid-layout', async () => {
      // Arrange
      const { seedDefaultsIfEmpty, updateLayout } =
        await import('./dashboardSlice')
      const store = await createTestStore()
      store.dispatch(seedDefaultsIfEmpty())
      const overviewPage = store.getState().dashboard.pages[0]
      const draggedWidget = overviewPage.widgets[0]

      // Act
      // RGL emits the moved widget plus an unrelated id that has no widget here.
      store.dispatch(
        updateLayout({
          pageId: overviewPage.id,
          layout: [
            { i: draggedWidget.id, x: 3, y: 5, w: 4, h: 2 },
            { i: 'ghost_layout_id', x: 0, y: 0, w: 1, h: 1 },
          ],
        }),
      )

      // Assert
      const movedWidget = store
        .getState()
        .dashboard.pages[0].widgets.find((w) => w.id === draggedWidget.id)
      expect(movedWidget).toMatchObject({ x: 3, y: 5, w: 4, h: 2 })
    })

    it('leaves widgets untouched when the layout omits them', async () => {
      // Arrange
      const { seedDefaultsIfEmpty, updateLayout } =
        await import('./dashboardSlice')
      const store = await createTestStore()
      store.dispatch(seedDefaultsIfEmpty())
      const overviewPage = store.getState().dashboard.pages[0]
      const untouchedWidget = overviewPage.widgets[1]

      // Act
      // Layout only references the first widget — the second must keep its spot.
      store.dispatch(
        updateLayout({
          pageId: overviewPage.id,
          layout: [{ i: overviewPage.widgets[0].id, x: 9, y: 9, w: 1, h: 1 }],
        }),
      )

      // Assert
      const stillThere = store
        .getState()
        .dashboard.pages[0].widgets.find((w) => w.id === untouchedWidget.id)
      expect(stillThere).toMatchObject({
        x: untouchedWidget.x,
        y: untouchedWidget.y,
        w: untouchedWidget.w,
        h: untouchedWidget.h,
      })
    })

    it('ignores a layout update aimed at a page that no longer exists', async () => {
      // Arrange
      const { seedDefaultsIfEmpty, updateLayout } =
        await import('./dashboardSlice')
      const store = await createTestStore()
      store.dispatch(seedDefaultsIfEmpty())
      const overviewBefore = store.getState().dashboard.pages[0]

      // Act
      store.dispatch(
        updateLayout({
          pageId: 'p_deleted_page' as DashboardPageId,
          layout: [{ i: overviewBefore.widgets[0].id, x: 2, y: 2, w: 2, h: 2 }],
        }),
      )

      // Assert
      // Same reference → reducer bailed before mutating any page.
      expect(store.getState().dashboard.pages[0]).toBe(overviewBefore)
    })
  })

  describe('removeWidget', () => {
    it('takes the removed widget off its page while leaving the page in place', async () => {
      // Arrange
      const { removeWidget, seedDefaultsIfEmpty } =
        await import('./dashboardSlice')
      const store = await createTestStore()
      store.dispatch(seedDefaultsIfEmpty())
      const overviewPage = store.getState().dashboard.pages[0]
      const targetWidgetId = overviewPage.widgets[0].id

      // Act
      store.dispatch(removeWidget(targetWidgetId))

      // Assert
      const overviewAfter = store.getState().dashboard.pages[0]
      expect(overviewAfter.widgets.some((w) => w.id === targetWidgetId)).toBe(
        false,
      )
    })

    it('removes the now-empty page when its last widget is deleted and other pages remain', async () => {
      // Arrange
      const { removeWidget, seedDefaultsIfEmpty } =
        await import('./dashboardSlice')
      const store = await createTestStore()
      store.dispatch(seedDefaultsIfEmpty())
      // Actions page seeds with a single widget.
      const actionsPage = store.getState().dashboard.pages[2]
      const onlyWidgetId = actionsPage.widgets[0].id

      // Act
      store.dispatch(removeWidget(onlyWidgetId))

      // Assert
      // 4 seeded pages, the emptied Actions page is dropped → 3 remain.
      expect(store.getState().dashboard.pages.length).toBe(3)
    })

    it('ignores removeWidget when the widget id is not found on any page', async () => {
      // Arrange
      const { removeWidget, seedDefaultsIfEmpty } =
        await import('./dashboardSlice')
      const store = await createTestStore()
      store.dispatch(seedDefaultsIfEmpty())
      const pagesBefore = store.getState().dashboard.pages

      // Act
      store.dispatch(removeWidget('w_not_a_real_widget' as WidgetInstanceId))

      // Assert
      // Same reference → reducer bailed before touching any page.
      expect(store.getState().dashboard.pages).toBe(pagesBefore)
    })
  })

  describe('page management', () => {
    it('adds an empty page and navigates straight to it', async () => {
      // Arrange
      const { addPage, seedDefaultsIfEmpty } = await import('./dashboardSlice')
      const store = await createTestStore()
      store.dispatch(seedDefaultsIfEmpty())

      // Act
      store.dispatch(addPage())

      // Assert
      const state = store.getState().dashboard
      // 4 seeded pages + 1 newly added page.
      expect(state.pages.length).toBe(5)
      const lastPage = state.pages[state.pages.length - 1]
      expect(lastPage.widgets).toEqual([])
      expect(state.currentPageId).toBe(lastPage.id)
    })

    it('renames a page to the new title', async () => {
      // Arrange
      const { renamePage, seedDefaultsIfEmpty } =
        await import('./dashboardSlice')
      const store = await createTestStore()
      store.dispatch(seedDefaultsIfEmpty())
      const discoveryPage = store.getState().dashboard.pages[1]

      // Act
      store.dispatch(
        renamePage({ pageId: discoveryPage.id, name: 'Exploration' }),
      )

      // Assert
      expect(store.getState().dashboard.pages[1].name).toBe('Exploration')
    })

    it('deletes a page when it is not the last one left', async () => {
      // Arrange
      const { removePage, seedDefaultsIfEmpty } =
        await import('./dashboardSlice')
      const store = await createTestStore()
      store.dispatch(seedDefaultsIfEmpty())
      const discoveryPage = store.getState().dashboard.pages[1]

      // Act
      store.dispatch(removePage(discoveryPage.id))

      // Assert
      const pages = store.getState().dashboard.pages
      expect(pages.some((p) => p.id === discoveryPage.id)).toBe(false)
    })

    it('jumps to the previous page after deleting the page being viewed', async () => {
      // Arrange
      const { removePage, seedDefaultsIfEmpty, setCurrentPage } =
        await import('./dashboardSlice')
      const store = await createTestStore()
      store.dispatch(seedDefaultsIfEmpty())
      const pages = store.getState().dashboard.pages
      const actionsPage = pages[2]
      const discoveryPage = pages[1]
      // View the page we are about to delete so currentPageId === target.
      store.dispatch(setCurrentPage(actionsPage.id))

      // Act
      store.dispatch(removePage(actionsPage.id))

      // Assert
      // Deleting the active page lands the view on its predecessor.
      expect(store.getState().dashboard.currentPageId).toBe(discoveryPage.id)
    })

    it('keeps the last remaining page when asked to delete it', async () => {
      // Arrange
      const { addPage, removePage } = await import('./dashboardSlice')
      const store = await createTestStore()
      // Create a single page manually (skipping seed) to isolate the guard.
      store.dispatch(addPage({ name: 'Solo' }))
      const solePage = store.getState().dashboard.pages[0]

      // Act
      store.dispatch(removePage(solePage.id))

      // Assert
      expect(store.getState().dashboard.pages).toHaveLength(1)
    })

    it('ignores renamePage when the page id does not exist', async () => {
      // Arrange
      const { renamePage, seedDefaultsIfEmpty } =
        await import('./dashboardSlice')
      const store = await createTestStore()
      store.dispatch(seedDefaultsIfEmpty())

      // Act
      store.dispatch(
        renamePage({
          pageId: 'p_not_a_real_id' as DashboardPageId,
          name: 'Renamed',
        }),
      )

      // Assert
      // No page adopted the new name — the seeded titles stay intact.
      expect(store.getState().dashboard.pages.map((page) => page.name)).toEqual(
        ['Overview', 'Discovery', 'Actions', 'Personal'],
      )
    })

    it('ignores removePage when the page id does not exist', async () => {
      // Arrange
      const { removePage, seedDefaultsIfEmpty } =
        await import('./dashboardSlice')
      const store = await createTestStore()
      store.dispatch(seedDefaultsIfEmpty())

      // Act
      store.dispatch(removePage('p_not_a_real_id' as DashboardPageId))

      // Assert
      // All four seeded pages remain — nothing matched, nothing removed.
      expect(store.getState().dashboard.pages.length).toBe(4)
    })
  })

  describe('dismissWelcome', () => {
    it('keeps the welcome message dismissed even after a reset to defaults', async () => {
      // Arrange
      const { dismissWelcome, resetToDefaults } =
        await import('./dashboardSlice')
      const store = await createTestStore()

      // Act
      store.dispatch(dismissWelcome())

      // Assert
      expect(store.getState().dashboard.welcomeDismissed).toBe(true)

      // Act
      // Reset wipes arrangements but must preserve dismissal state.
      store.dispatch(resetToDefaults())

      // Assert
      expect(store.getState().dashboard.welcomeDismissed).toBe(true)
    })
  })

  describe('resetToDefaults', () => {
    it('restores the default page layout and leaves edit mode', async () => {
      // Arrange
      const { resetToDefaults, seedDefaultsIfEmpty, toggleEditMode, addPage } =
        await import('./dashboardSlice')
      const store = await createTestStore()
      store.dispatch(seedDefaultsIfEmpty())
      store.dispatch(toggleEditMode())
      store.dispatch(addPage({ name: 'Custom' }))
      expect(store.getState().dashboard.pages.length).toBe(5)
      expect(store.getState().dashboard.isEditMode).toBe(true)

      // Act
      store.dispatch(resetToDefaults())

      // Assert
      const state = store.getState().dashboard
      expect(state.pages.length).toBe(4)
      expect(state.isEditMode).toBe(false)
      expect(state.currentPageId).toBe(state.pages[0].id)
    })
  })

  describe('selectors', () => {
    it('exposes the full list of pages to the canvas', async () => {
      // Arrange
      const { seedDefaultsIfEmpty, selectDashboardPages } =
        await import('./dashboardSlice')
      const store = await createTestStore()
      store.dispatch(seedDefaultsIfEmpty())

      // Act
      const pages = selectDashboardPages(store.getState())

      // Assert
      expect(pages.map((page) => page.name)).toEqual([
        'Overview',
        'Discovery',
        'Actions',
        'Personal',
      ])
    })

    it('reports which page tab is currently active', async () => {
      // Arrange
      const { seedDefaultsIfEmpty, setCurrentPage, selectCurrentPageId } =
        await import('./dashboardSlice')
      const store = await createTestStore()
      store.dispatch(seedDefaultsIfEmpty())
      const discoveryPage = store.getState().dashboard.pages[1]
      store.dispatch(setCurrentPage(discoveryPage.id))

      // Act
      const currentPageId = selectCurrentPageId(store.getState())

      // Assert
      expect(currentPageId).toBe(discoveryPage.id)
    })

    it('resolves the active page object from the selected id', async () => {
      // Arrange
      const { seedDefaultsIfEmpty, setCurrentPage, selectCurrentPage } =
        await import('./dashboardSlice')
      const store = await createTestStore()
      store.dispatch(seedDefaultsIfEmpty())
      const actionsPage = store.getState().dashboard.pages[2]
      store.dispatch(setCurrentPage(actionsPage.id))

      // Act
      const currentPage = selectCurrentPage(store.getState())

      // Assert
      expect(currentPage?.id).toBe(actionsPage.id)
    })

    it('falls back to the first page when no page has been selected yet', async () => {
      // Arrange
      const { seedDefaultsIfEmpty, selectCurrentPage } =
        await import('./dashboardSlice')
      const store = await createTestStore()
      store.dispatch(seedDefaultsIfEmpty())
      // Force the "nothing selected" state the seed normally avoids.
      const seededPages = store.getState().dashboard.pages
      const stateWithoutSelection = {
        dashboard: { ...store.getState().dashboard, currentPageId: null },
      }

      // Act
      const currentPage = selectCurrentPage(stateWithoutSelection)

      // Assert
      expect(currentPage?.id).toBe(seededPages[0].id)
    })

    it('reports no active page when the selected id is gone and no pages remain', async () => {
      // Arrange
      const { selectCurrentPage } = await import('./dashboardSlice')
      // Stale selection pointing at a non-existent page with an empty page list
      // (e.g. after every page was deleted) — there is nothing to resolve to.
      const stateWithNoPages = {
        dashboard: {
          pages: [],
          currentPageId: 'p_gone' as DashboardPageId,
          isEditMode: false,
          welcomeDismissed: false,
          initialized: true,
        },
      }

      // Act
      const currentPage = selectCurrentPage(stateWithNoPages)

      // Assert
      expect(currentPage).toBeNull()
    })

    it('reports no active page on a blank dashboard before first-run seeding', async () => {
      // Arrange
      const { selectCurrentPage } = await import('./dashboardSlice')
      const store = await createTestStore()

      // Act
      // Pristine store: no pages and nothing selected yet — selector must not
      // invent a page when pages[0] is also absent.
      const currentPage = selectCurrentPage(store.getState())

      // Assert
      expect(currentPage).toBeNull()
    })

    it('reflects whether the canvas is in edit mode', async () => {
      // Arrange
      const { toggleEditMode, selectIsEditMode } =
        await import('./dashboardSlice')
      const store = await createTestStore()

      // Assert
      expect(selectIsEditMode(store.getState())).toBe(false)

      // Act
      store.dispatch(toggleEditMode())

      // Assert
      expect(selectIsEditMode(store.getState())).toBe(true)
    })

    it('reflects whether the welcome widget has been dismissed', async () => {
      // Arrange
      const { dismissWelcome, selectWelcomeDismissed } =
        await import('./dashboardSlice')
      const store = await createTestStore()

      // Assert
      expect(selectWelcomeDismissed(store.getState())).toBe(false)

      // Act
      store.dispatch(dismissWelcome())

      // Assert
      expect(selectWelcomeDismissed(store.getState())).toBe(true)
    })

    it('signals once first-run defaults have been seeded', async () => {
      // Arrange
      const { seedDefaultsIfEmpty, selectIsInitialized } =
        await import('./dashboardSlice')
      const store = await createTestStore()

      // Assert
      expect(selectIsInitialized(store.getState())).toBe(false)

      // Act
      store.dispatch(seedDefaultsIfEmpty())

      // Assert
      expect(selectIsInitialized(store.getState())).toBe(true)
    })
  })
})
