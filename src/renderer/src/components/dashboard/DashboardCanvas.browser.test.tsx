import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import '@/renderer/src/styles/globals.css'

import type { DashboardPage, WidgetInstance, WidgetType } from './types'
import { newDashboardPageId, newWidgetInstanceId } from './utils/ids'

/**
 * Build one page holding the given widgets. Ids come from the real factories so
 * the fixtures match production-shaped state.
 * @param name - Tab name for the page.
 * @param widgets - Placed widget instances on the page.
 * @returns A DashboardPage usable as preloaded dashboard state.
 * @example
 * makePage('Overview', [makeWidget('welcome', { y: 0 })]).widgets.length // => 1
 */
function makePage(name: string, widgets: WidgetInstance[]): DashboardPage {
  return {
    id: newDashboardPageId(),
    name,
    widgets,
  }
}

/**
 * Build a placed widget instance. The `type` accepts any string so tests can
 * simulate persisted state that references a removed/unknown widget type — the
 * exact case DashboardGrid's defensive `getWidgetDefinition` guard handles.
 * @param type - Widget type (a known WidgetType, or an unknown string).
 * @param placement - x/y/w/h overrides; defaults to a full-width origin slot.
 * @returns A WidgetInstance for preloaded dashboard state.
 * @example
 * makeWidget('welcome', { y: 5 }).y // => 5
 */
function makeWidget(
  type: WidgetType,
  placement: Partial<Pick<WidgetInstance, 'x' | 'y' | 'w' | 'h'>> = {},
): WidgetInstance {
  return {
    id: newWidgetInstanceId(),
    type,
    x: placement.x ?? 0,
    y: placement.y ?? 0,
    w: placement.w ?? 6,
    h: placement.h ?? 3,
  }
}

/**
 * Render DashboardCanvas inside a sized container with real dashboard + ui
 * reducers. `ui` is needed because the Welcome widget body dispatches
 * `setActiveTab`. Preloaded state lets tests pin a specific page/widget set and
 * edit mode without driving the seeding effect.
 * @param options.pages - Preloaded pages; when omitted the seeding effect runs.
 * @param options.currentPageId - Active page id (defaults to first page's id).
 * @param options.isEditMode - Start the canvas in edit mode.
 * @param options.initialized - Mark dashboard already seeded (skip seeding).
 * @returns Browser screen + the Redux store for state assertions.
 */
async function renderCanvas(
  options: {
    pages?: DashboardPage[]
    currentPageId?: DashboardPage['id'] | null
    isEditMode?: boolean
    initialized?: boolean
  } = {},
) {
  const [
    { default: dashboardReducer },
    { default: uiReducer },
    { default: widgetPickerReducer },
    { default: skillsReducer },
    { default: agentsReducer },
    { DashboardCanvas },
  ] = await Promise.all([
    import('@/renderer/src/redux/slices/dashboardSlice'),
    import('@/renderer/src/redux/slices/uiSlice'),
    import('@/renderer/src/redux/slices/widgetPickerSlice'),
    import('@/renderer/src/redux/slices/skillsSlice'),
    import('@/renderer/src/redux/slices/agentsSlice'),
    import('./DashboardCanvas'),
  ])

  const store = configureStore({
    reducer: {
      dashboard: dashboardReducer,
      ui: uiReducer,
      widgetPicker: widgetPickerReducer,
      skills: skillsReducer,
      agents: agentsReducer,
    },
    preloadedState: options.pages
      ? {
          dashboard: {
            pages: options.pages,
            currentPageId:
              options.currentPageId === undefined
                ? (options.pages[0]?.id ?? null)
                : options.currentPageId,
            isEditMode: options.isEditMode ?? false,
            welcomeDismissed: false,
            initialized: options.initialized ?? true,
          },
        }
      : undefined,
  })

  const screen = await render(
    <Provider store={store}>
      {/* Sized wrapper so react-grid-layout's container measures a real width. */}
      <div style={{ width: '900px', height: '600px', display: 'flex' }}>
        <DashboardCanvas />
      </div>
    </Provider>,
  )
  return { screen, store }
}

describe('DashboardCanvas', () => {
  it('seeds the four default dashboard pages on first mount', async () => {
    // Arrange + Act: mount with no preloaded pages so the seeding effect runs.
    const { store } = await renderCanvas()

    // Assert: the default preset populated and marked the store initialized.
    await expect.poll(() => store.getState().dashboard.initialized).toBe(true)
    expect(store.getState().dashboard.pages.map((page) => page.name)).toEqual([
      'Overview',
      'Discovery',
      'Actions',
      'Personal',
    ])
  })

  it('switches the active page when its ⌘-number shortcut is pressed', async () => {
    // Arrange: two pages, starting on the first.
    const overview = makePage('Overview', [makeWidget('welcome')])
    const discovery = makePage('Discovery', [makeWidget('welcome')])
    const { store } = await renderCanvas({
      pages: [overview, discovery],
      currentPageId: overview.id,
    })

    // Act: ⌘2 (Cmd+2) selects the second page via the canvas keyboard hook.
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: '2', metaKey: true, bubbles: true }),
    )

    // Assert: the second page is now current — the shortcut listener is live
    // for as long as the canvas is mounted.
    await expect
      .poll(() => store.getState().dashboard.currentPageId)
      .toBe(discovery.id)
  })

  it('renders the current page widget inside the grid', async () => {
    // Arrange: a page whose only widget is the Welcome card.
    const page = makePage('Overview', [makeWidget('welcome')])

    // Act
    const { screen } = await renderCanvas({ pages: [page] })

    // Assert: the Welcome widget body renders inside the grid shell.
    await expect
      .element(screen.getByText('Welcome to Skills Desktop'))
      .toBeVisible()
  })

  it('persists the compacted layout to the store when the grid mounts', async () => {
    // Arrange: a single widget placed at y=5 with no widget above it. React
    // Grid Layout's vertical compactor pulls it up to y=0 on mount, which fires
    // onLayoutChange and must be written back to the store.
    const page = makePage('Overview', [
      makeWidget('welcome', { x: 0, y: 5, w: 6, h: 3 }),
    ])

    // Act
    const { store } = await renderCanvas({ pages: [page] })

    // Assert: the persisted widget settled at the compacted top row.
    await expect
      .poll(() => store.getState().dashboard.pages[0]?.widgets[0]?.y)
      .toBe(0)
  })

  it('skips rendering widgets whose type is no longer in the registry', async () => {
    // Arrange: persisted state references a removed widget type alongside a
    // valid one. The unknown type has no registry definition.
    const removedType = 'legacy-removed-widget' as WidgetType
    const page = makePage('Overview', [
      makeWidget(removedType),
      makeWidget('welcome', { y: 3 }),
    ])

    // Act
    const { screen } = await renderCanvas({ pages: [page] })

    // Assert: the known widget still renders; the unknown one is silently
    // dropped (no crash, no stray frame).
    await expect
      .element(screen.getByText('Welcome to Skills Desktop'))
      .toBeVisible()
    expect(screen.getByText('legacy-removed-widget').query()).toBeNull()
  })

  it('shows the drag handle for widgets while the canvas is in edit mode', async () => {
    // Arrange: edit mode on so DashboardGrid receives isEditMode=true, which
    // flows into the drag/resize config and the widget shell's edit chrome.
    const page = makePage('Overview', [makeWidget('welcome')])

    // Act
    const { screen } = await renderCanvas({
      pages: [page],
      isEditMode: true,
    })

    // Assert: the per-widget remove affordance only exists in edit mode.
    await expect
      .element(screen.getByRole('button', { name: 'Remove Welcome widget' }))
      .toBeVisible()
  })

  it('renders nothing in the grid area when there is no current page', async () => {
    // Arrange: an empty dashboard (no pages) so selectCurrentPage returns null.
    // Act
    const { screen, store } = await renderCanvas({
      pages: [],
      currentPageId: null,
    })

    // Assert: no widget bodies render, and the empty state holds.
    expect(store.getState().dashboard.pages).toEqual([])
    expect(screen.getByText('Welcome to Skills Desktop').query()).toBeNull()
  })
})
