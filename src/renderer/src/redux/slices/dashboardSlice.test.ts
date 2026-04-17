import { configureStore } from '@reduxjs/toolkit'
import { describe, expect, it } from 'vitest'

import type { DashboardPageId } from '../../components/dashboard/types'

// Dynamic import keeps the slice out of the module graph until each test
// needs it — matches the pattern established by `bookmarkSlice.test.ts` and
// gives every test a pristine reducer/initial state.
async function createTestStore() {
  const { default: dashboardReducer } = await import('./dashboardSlice')
  return configureStore({ reducer: { dashboard: dashboardReducer } })
}

describe('dashboardSlice', () => {
  describe('initial state', () => {
    it('starts empty and uninitialized', async () => {
      const store = await createTestStore()
      const state = store.getState().dashboard
      expect(state.pages).toEqual([])
      expect(state.currentPageId).toBeNull()
      expect(state.isEditMode).toBe(false)
      expect(state.welcomeDismissed).toBe(false)
      expect(state.initialized).toBe(false)
    })
  })

  describe('seedDefaultsIfEmpty', () => {
    it('populates the four default pages on first call', async () => {
      const { seedDefaultsIfEmpty } = await import('./dashboardSlice')
      const store = await createTestStore()

      store.dispatch(seedDefaultsIfEmpty())

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

    it('is a no-op once initialized', async () => {
      const { seedDefaultsIfEmpty } = await import('./dashboardSlice')
      const store = await createTestStore()

      store.dispatch(seedDefaultsIfEmpty())
      const firstPages = store.getState().dashboard.pages
      store.dispatch(seedDefaultsIfEmpty())
      const secondPages = store.getState().dashboard.pages

      // Same reference → reducer didn't rebuild the pages.
      expect(secondPages).toBe(firstPages)
    })
  })

  describe('setCurrentPage', () => {
    it('switches to an existing page', async () => {
      const { seedDefaultsIfEmpty, setCurrentPage } =
        await import('./dashboardSlice')
      const store = await createTestStore()

      store.dispatch(seedDefaultsIfEmpty())
      const discoveryPage = store.getState().dashboard.pages[1]
      store.dispatch(setCurrentPage(discoveryPage.id))

      expect(store.getState().dashboard.currentPageId).toBe(discoveryPage.id)
    })

    it('ignores unknown page ids (guards against stale references)', async () => {
      const { seedDefaultsIfEmpty, setCurrentPage } =
        await import('./dashboardSlice')
      const store = await createTestStore()

      store.dispatch(seedDefaultsIfEmpty())
      const initialPageId = store.getState().dashboard.currentPageId
      store.dispatch(setCurrentPage('p_not_a_real_id' as DashboardPageId))

      expect(store.getState().dashboard.currentPageId).toBe(initialPageId)
    })
  })

  describe('toggleEditMode', () => {
    it('flips isEditMode on every call', async () => {
      const { toggleEditMode } = await import('./dashboardSlice')
      const store = await createTestStore()

      expect(store.getState().dashboard.isEditMode).toBe(false)
      store.dispatch(toggleEditMode())
      expect(store.getState().dashboard.isEditMode).toBe(true)
      store.dispatch(toggleEditMode())
      expect(store.getState().dashboard.isEditMode).toBe(false)
    })
  })

  describe('addWidget', () => {
    it('appends a widget with registry default size when the page has room', async () => {
      const { addWidget, seedDefaultsIfEmpty, setCurrentPage } =
        await import('./dashboardSlice')
      const store = await createTestStore()

      store.dispatch(seedDefaultsIfEmpty())
      // Actions page has 1 widget → room for more.
      const actionsPage = store.getState().dashboard.pages[2]
      store.dispatch(setCurrentPage(actionsPage.id))
      const countBefore = actionsPage.widgets.length

      store.dispatch(addWidget({ type: 'stats' }))

      const currentPage = store.getState().dashboard.pages[2]
      expect(currentPage.widgets.length).toBe(countBefore + 1)
      const appendedWidget = currentPage.widgets[currentPage.widgets.length - 1]
      expect(appendedWidget.type).toBe('stats')
    })

    it('creates a new overflow page when the current page is full', async () => {
      const { addWidget, seedDefaultsIfEmpty, setCurrentPage } =
        await import('./dashboardSlice')
      const store = await createTestStore()

      store.dispatch(seedDefaultsIfEmpty())
      // Overview has 4 widgets — hits MAX_WIDGETS_PER_PAGE.
      const overviewPage = store.getState().dashboard.pages[0]
      store.dispatch(setCurrentPage(overviewPage.id))
      const pagesBefore = store.getState().dashboard.pages.length

      store.dispatch(addWidget({ type: 'stats' }))

      const state = store.getState().dashboard
      expect(state.pages.length).toBe(pagesBefore + 1)
      // Auto-created page becomes the current page.
      expect(state.currentPageId).toBe(state.pages[state.pages.length - 1].id)
    })
  })

  describe('removeWidget', () => {
    it('removes the widget from its containing page', async () => {
      const { removeWidget, seedDefaultsIfEmpty } =
        await import('./dashboardSlice')
      const store = await createTestStore()

      store.dispatch(seedDefaultsIfEmpty())
      const overviewPage = store.getState().dashboard.pages[0]
      const targetWidgetId = overviewPage.widgets[0].id
      store.dispatch(removeWidget(targetWidgetId))

      const overviewAfter = store.getState().dashboard.pages[0]
      expect(overviewAfter.widgets.some((w) => w.id === targetWidgetId)).toBe(
        false,
      )
    })

    it('deletes the page when the last widget on it is removed and other pages exist', async () => {
      const { removeWidget, seedDefaultsIfEmpty } =
        await import('./dashboardSlice')
      const store = await createTestStore()

      store.dispatch(seedDefaultsIfEmpty())
      // Actions page has a single widget.
      const actionsPage = store.getState().dashboard.pages[2]
      const onlyWidgetId = actionsPage.widgets[0].id
      const pagesBefore = store.getState().dashboard.pages.length

      store.dispatch(removeWidget(onlyWidgetId))

      expect(store.getState().dashboard.pages.length).toBe(pagesBefore - 1)
    })
  })

  describe('page management', () => {
    it('addPage appends a new empty page and switches to it', async () => {
      const { addPage, seedDefaultsIfEmpty } = await import('./dashboardSlice')
      const store = await createTestStore()

      store.dispatch(seedDefaultsIfEmpty())
      const pagesBefore = store.getState().dashboard.pages.length

      store.dispatch(addPage())

      const state = store.getState().dashboard
      expect(state.pages.length).toBe(pagesBefore + 1)
      const lastPage = state.pages[state.pages.length - 1]
      expect(lastPage.widgets).toEqual([])
      expect(state.currentPageId).toBe(lastPage.id)
    })

    it('renamePage updates the name of an existing page', async () => {
      const { renamePage, seedDefaultsIfEmpty } =
        await import('./dashboardSlice')
      const store = await createTestStore()

      store.dispatch(seedDefaultsIfEmpty())
      const discoveryPage = store.getState().dashboard.pages[1]
      store.dispatch(
        renamePage({ pageId: discoveryPage.id, name: 'Exploration' }),
      )

      expect(store.getState().dashboard.pages[1].name).toBe('Exploration')
    })

    it('removePage drops a non-last page', async () => {
      const { removePage, seedDefaultsIfEmpty } =
        await import('./dashboardSlice')
      const store = await createTestStore()

      store.dispatch(seedDefaultsIfEmpty())
      const discoveryPage = store.getState().dashboard.pages[1]
      store.dispatch(removePage(discoveryPage.id))

      const pages = store.getState().dashboard.pages
      expect(pages.some((p) => p.id === discoveryPage.id)).toBe(false)
    })

    it('removePage refuses to delete the last remaining page', async () => {
      const { addPage, removePage } = await import('./dashboardSlice')
      const store = await createTestStore()

      // Create a single page manually (skipping seed) to isolate the guard.
      store.dispatch(addPage({ name: 'Solo' }))
      const solePage = store.getState().dashboard.pages[0]
      store.dispatch(removePage(solePage.id))

      expect(store.getState().dashboard.pages).toHaveLength(1)
    })
  })

  describe('dismissWelcome', () => {
    it('sets welcomeDismissed to true and survives resetToDefaults', async () => {
      const { dismissWelcome, resetToDefaults } =
        await import('./dashboardSlice')
      const store = await createTestStore()

      store.dispatch(dismissWelcome())
      expect(store.getState().dashboard.welcomeDismissed).toBe(true)

      // Reset wipes arrangements but must preserve dismissal preference.
      store.dispatch(resetToDefaults())
      expect(store.getState().dashboard.welcomeDismissed).toBe(true)
    })
  })

  describe('resetToDefaults', () => {
    it('rebuilds the default preset and exits edit mode', async () => {
      const { resetToDefaults, seedDefaultsIfEmpty, toggleEditMode, addPage } =
        await import('./dashboardSlice')
      const store = await createTestStore()

      store.dispatch(seedDefaultsIfEmpty())
      store.dispatch(toggleEditMode())
      store.dispatch(addPage({ name: 'Custom' }))
      expect(store.getState().dashboard.pages.length).toBe(5)
      expect(store.getState().dashboard.isEditMode).toBe(true)

      store.dispatch(resetToDefaults())

      const state = store.getState().dashboard
      expect(state.pages.length).toBe(4)
      expect(state.isEditMode).toBe(false)
      expect(state.currentPageId).toBe(state.pages[0].id)
    })
  })
})
