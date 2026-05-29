import { configureStore } from '@reduxjs/toolkit'
import { describe, expect, it } from 'vitest'

import type { DashboardPageId } from '@/renderer/src/components/dashboard/types'

// Dynamic import keeps the slice out of the module graph until each test
// needs it — matches the pattern established by `bookmarkSlice.test.ts` and
// gives every test a pristine reducer/initial state.
async function createTestStore() {
  const { default: dashboardReducer } = await import('./dashboardSlice')
  return configureStore({ reducer: { dashboard: dashboardReducer } })
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
})
