import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'

import type {
  DashboardPage,
  DashboardPageId,
  WidgetInstance,
  WidgetInstanceId,
  WidgetType,
} from '../../components/dashboard/types'
import { findEmptySpot } from '../../components/dashboard/utils/findEmptySpot'
import {
  newDashboardPageId,
  newWidgetInstanceId,
} from '../../components/dashboard/utils/ids'
import { buildDefaultDashboardPages } from '../../components/dashboard/utils/widgetPresets'
import { WIDGET_REGISTRY } from '../../components/dashboard/widgets/registry'
import type { RootState } from '../store'

// ============================================================================
// State shape
// ----------------------------------------------------------------------------
// `pages` is the canonical user arrangement. `currentPageId` selects which
// page the canvas shows. `isEditMode` switches the UI from "view" (widgets
// display content only) to "edit" (headers get remove handles, grid becomes
// draggable/resizable, WidgetPicker can open).
//
// `welcomeDismissed` is read by the Welcome widget to decide whether to
// self-render — existing users don't need the intro on every launch. It
// lives here (and persists) rather than on the widget itself so dismissal
// survives removing + re-adding the widget.
// ============================================================================

export interface DashboardState {
  pages: DashboardPage[]
  currentPageId: DashboardPageId | null
  isEditMode: boolean
  welcomeDismissed: boolean
  /** True once defaults have been populated. Prevents re-seeding on every load. */
  initialized: boolean
}

const initialState: DashboardState = {
  pages: [],
  currentPageId: null,
  isEditMode: false,
  welcomeDismissed: false,
  initialized: false,
}

/**
 * Lookup helper — finds the page a widget lives on by instance id.
 * @returns The page index, or -1 if not found.
 */
function findPageIndexByWidgetId(
  pages: readonly DashboardPage[],
  widgetId: WidgetInstanceId,
): number {
  return pages.findIndex((page) =>
    page.widgets.some((widget) => widget.id === widgetId),
  )
}

const dashboardSlice = createSlice({
  name: 'dashboard',
  initialState,
  reducers: {
    /**
     * Populate the default 4-page dashboard on first launch.
     * No-op if already initialized — subsequent calls are safe.
     */
    seedDefaultsIfEmpty: (state) => {
      if (state.initialized) return
      const pages = buildDefaultDashboardPages()
      state.pages = pages
      state.currentPageId = pages[0]?.id ?? null
      state.initialized = true
    },

    /**
     * Switch the active page (tab).
     * Ignored if the id isn't found — avoids landing on a stale page after
     * deletion.
     */
    setCurrentPage: (state, action: PayloadAction<DashboardPageId>) => {
      const exists = state.pages.some((page) => page.id === action.payload)
      if (exists) state.currentPageId = action.payload
    },

    /** Toggle between view and edit mode. */
    toggleEditMode: (state) => {
      state.isEditMode = !state.isEditMode
    },

    setEditMode: (state, action: PayloadAction<boolean>) => {
      state.isEditMode = action.payload
    },

    /**
     * Persist the latest layout from react-grid-layout after a drag or resize.
     * Payload carries only the fields RGL knows about; we preserve the widget
     * type (it's not in the layout) by matching on id.
     */
    updateLayout: (
      state,
      action: PayloadAction<{
        pageId: DashboardPageId
        layout: readonly {
          i: string
          x: number
          y: number
          w: number
          h: number
        }[]
      }>,
    ) => {
      const page = state.pages.find((p) => p.id === action.payload.pageId)
      if (!page) return
      const byId = new Map(action.payload.layout.map((item) => [item.i, item]))
      page.widgets = page.widgets.map((widget) => {
        const layoutItem = byId.get(widget.id)
        if (!layoutItem) return widget
        return {
          ...widget,
          x: layoutItem.x,
          y: layoutItem.y,
          w: layoutItem.w,
          h: layoutItem.h,
        }
      })
    },

    /**
     * Add a widget to the current page. If it doesn't fit (page full or
     * grid can't accommodate the size), a new page is created and the
     * widget lands at (0, 0) there.
     */
    addWidget: (state, action: PayloadAction<{ type: WidgetType }>) => {
      const def = WIDGET_REGISTRY[action.payload.type]
      if (!def) return

      const currentPage =
        state.pages.find((page) => page.id === state.currentPageId) ??
        state.pages[0]

      const spot = currentPage
        ? findEmptySpot(currentPage.widgets, def.defaultSize)
        : null

      const newWidget: WidgetInstance = {
        id: newWidgetInstanceId(),
        type: action.payload.type,
        x: spot?.x ?? 0,
        y: spot?.y ?? 0,
        w: def.defaultSize.w,
        h: def.defaultSize.h,
      }

      if (currentPage && spot) {
        currentPage.widgets.push(newWidget)
        return
      }

      // Overflow: create a new page and drop the widget at the origin.
      const overflowPage: DashboardPage = {
        id: newDashboardPageId(),
        name: `Page ${state.pages.length + 1}`,
        widgets: [newWidget],
      }
      state.pages.push(overflowPage)
      state.currentPageId = overflowPage.id
    },

    /**
     * Remove a widget by id. If removing it leaves the page empty and there
     * are other pages, the empty page is also removed and the view jumps to
     * the previous page. If it's the last page, the page stays (empty) so
     * the user can re-add something.
     */
    removeWidget: (state, action: PayloadAction<WidgetInstanceId>) => {
      const pageIndex = findPageIndexByWidgetId(state.pages, action.payload)
      if (pageIndex < 0) return

      const page = state.pages[pageIndex]
      page.widgets = page.widgets.filter(
        (widget) => widget.id !== action.payload,
      )

      if (page.widgets.length === 0 && state.pages.length > 1) {
        state.pages.splice(pageIndex, 1)
        const nextPage =
          state.pages[Math.max(0, pageIndex - 1)] ?? state.pages[0]
        state.currentPageId = nextPage?.id ?? null
      }
    },

    /**
     * Create a new empty page and switch to it. User-driven — auto-overflow
     * uses `addWidget`'s fallback path instead.
     */
    addPage: (state, action: PayloadAction<{ name?: string } | undefined>) => {
      const newPage: DashboardPage = {
        id: newDashboardPageId(),
        name: action.payload?.name ?? `Page ${state.pages.length + 1}`,
        widgets: [],
      }
      state.pages.push(newPage)
      state.currentPageId = newPage.id
    },

    /**
     * Rename a page. No-op if the id isn't found.
     */
    renamePage: (
      state,
      action: PayloadAction<{ pageId: DashboardPageId; name: string }>,
    ) => {
      const page = state.pages.find((p) => p.id === action.payload.pageId)
      if (page) page.name = action.payload.name
    },

    /**
     * Remove a page entirely (all widgets on it are lost). The last remaining
     * page is protected — dashboards always have at least one.
     */
    removePage: (state, action: PayloadAction<DashboardPageId>) => {
      if (state.pages.length <= 1) return
      const pageIndex = state.pages.findIndex(
        (page) => page.id === action.payload,
      )
      if (pageIndex < 0) return
      state.pages.splice(pageIndex, 1)
      if (state.currentPageId === action.payload) {
        const nextPage =
          state.pages[Math.max(0, pageIndex - 1)] ?? state.pages[0]
        state.currentPageId = nextPage?.id ?? null
      }
    },

    /** Hide the Welcome widget permanently (user clicked Dismiss). */
    dismissWelcome: (state) => {
      state.welcomeDismissed = true
    },

    /** Reset every arrangement back to the default preset. */
    resetToDefaults: (state) => {
      const pages = buildDefaultDashboardPages()
      state.pages = pages
      state.currentPageId = pages[0]?.id ?? null
      state.isEditMode = false
      state.initialized = true
      // welcomeDismissed intentionally preserved — reset layout, not preferences.
    },
  },
})

export const {
  seedDefaultsIfEmpty,
  setCurrentPage,
  toggleEditMode,
  setEditMode,
  updateLayout,
  addWidget,
  removeWidget,
  addPage,
  renamePage,
  removePage,
  dismissWelcome,
  resetToDefaults,
} = dashboardSlice.actions

export default dashboardSlice.reducer

// ============================================================================
// Selectors
// ----------------------------------------------------------------------------
// `Pick<RootState, 'dashboard'>` allows unit-testing selectors against a
// minimal store (matching the pattern in bookmarkSlice).
// ============================================================================

type DashboardSelectorState = Pick<RootState, 'dashboard'>

export const selectDashboardPages = (
  state: DashboardSelectorState,
): DashboardPage[] => state.dashboard.pages

export const selectCurrentPageId = (
  state: DashboardSelectorState,
): DashboardPageId | null => state.dashboard.currentPageId

export const selectCurrentPage = (
  state: DashboardSelectorState,
): DashboardPage | null => {
  const { pages, currentPageId } = state.dashboard
  if (!currentPageId) return pages[0] ?? null
  return pages.find((page) => page.id === currentPageId) ?? pages[0] ?? null
}

export const selectIsEditMode = (state: DashboardSelectorState): boolean =>
  state.dashboard.isEditMode

export const selectWelcomeDismissed = (
  state: DashboardSelectorState,
): boolean => state.dashboard.welcomeDismissed

export const selectIsInitialized = (state: DashboardSelectorState): boolean =>
  state.dashboard.initialized
