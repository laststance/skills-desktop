import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import '@/renderer/src/styles/globals.css'

import type { DashboardPage, WidgetDefinition, WidgetInstance } from './types'
import { newDashboardPageId, newWidgetInstanceId } from './utils/ids'

/**
 * Build a placed widget instance with a stable id so it can be both seeded into
 * a page and handed to the WidgetShell under test (removeWidget matches by id).
 * @param id - The widget instance id shared between page state and the shell.
 * @returns A WidgetInstance for preloaded dashboard state.
 */
function makeWidget(id: WidgetInstance['id']): WidgetInstance {
  return { id, type: 'welcome', x: 0, y: 0, w: 6, h: 3 }
}

/**
 * A throwaway widget definition so the shell renders without coupling to a real
 * widget body — the shell only frames whatever Component/icon it is given.
 */
const fakeDefinition: WidgetDefinition = {
  type: 'welcome',
  label: 'Fake Widget',
  description: 'A test-only widget used to exercise the shell frame.',
  icon: ({ className }: { className?: string }) => (
    <span data-testid="fake-icon" className={className} />
  ),
  defaultSize: { w: 6, h: 3 },
  minSize: { w: 2, h: 2 },
  Component: ({ instance }: { instance: WidgetInstance }) => (
    <div data-testid="fake-body">{instance.type}</div>
  ),
}

/**
 * Render a single WidgetShell inside a dashboard-only store. The shell reads
 * `selectIsEditMode` and dispatches `removeWidget`, so only the dashboard slice
 * is needed. The widget is seeded onto a page so removeWidget can find it.
 * @param options.isEditMode - Start the store in edit mode (shows edit chrome).
 * @param options.extraWidgetIds - Additional widgets on the same page so the
 *   page survives the last-widget removal splice and removal is observable.
 * @returns Browser screen, the Redux store, and the shell's widget instance.
 */
async function renderShell(
  options: {
    isEditMode?: boolean
    extraWidgetIds?: WidgetInstance['id'][]
  } = {},
) {
  const [{ default: dashboardReducer }, { WidgetShell }] = await Promise.all([
    import('@/renderer/src/redux/slices/dashboardSlice'),
    import('./WidgetShell'),
  ])

  const shellWidget = makeWidget(newWidgetInstanceId())
  const extraWidgets = (options.extraWidgetIds ?? []).map(makeWidget)
  const page: DashboardPage = {
    id: newDashboardPageId(),
    name: 'Test Page',
    widgets: [shellWidget, ...extraWidgets],
  }

  const store = configureStore({
    reducer: { dashboard: dashboardReducer },
    preloadedState: {
      dashboard: {
        pages: [page],
        currentPageId: page.id,
        isEditMode: options.isEditMode ?? false,
        welcomeDismissed: false,
        initialized: true,
      },
    },
  })

  const screen = await render(
    <Provider store={store}>
      <WidgetShell instance={shellWidget} definition={fakeDefinition} />
    </Provider>,
  )
  return { screen, store, shellWidget }
}

describe('WidgetShell', () => {
  it('removes the widget from its page when its remove button is clicked', async () => {
    // Arrange: edit mode on so the remove button renders, plus a sibling widget
    // so the page is not deleted when this one is removed.
    const siblingId = newWidgetInstanceId()
    const { screen, store, shellWidget } = await renderShell({
      isEditMode: true,
      extraWidgetIds: [siblingId],
    })

    // Act: click the per-widget remove affordance.
    await screen
      .getByRole('button', { name: 'Remove Fake Widget widget' })
      .click()

    // Assert: only the clicked widget is gone; the sibling and page remain.
    await expect
      .poll(() =>
        store.getState().dashboard.pages[0]?.widgets.map((widget) => widget.id),
      )
      .toEqual([siblingId])
    expect(
      store
        .getState()
        .dashboard.pages[0]?.widgets.some(
          (widget) => widget.id === shellWidget.id,
        ),
    ).toBe(false)
  })

  it('does not start a widget drag when its remove button is pressed', async () => {
    // Arrange: a parent mousedown spy stands in for react-grid-layout's drag
    // start, which the shell must suppress on the remove button.
    const parentMouseDownSpy = vi.fn()
    const [{ default: dashboardReducer }, { WidgetShell }] = await Promise.all([
      import('@/renderer/src/redux/slices/dashboardSlice'),
      import('./WidgetShell'),
    ])

    const shellWidget = makeWidget(newWidgetInstanceId())
    const page: DashboardPage = {
      id: newDashboardPageId(),
      name: 'Test Page',
      widgets: [shellWidget, makeWidget(newWidgetInstanceId())],
    }
    const store = configureStore({
      reducer: { dashboard: dashboardReducer },
      preloadedState: {
        dashboard: {
          pages: [page],
          currentPageId: page.id,
          isEditMode: true,
          welcomeDismissed: false,
          initialized: true,
        },
      },
    })

    const screen = await render(
      <Provider store={store}>
        {/* Parent listener mimics RGL's drag-start handler on the grid item. */}
        <div onMouseDown={parentMouseDownSpy}>
          <WidgetShell instance={shellWidget} definition={fakeDefinition} />
        </div>
      </Provider>,
    )

    // Act: press (mousedown) the remove button.
    const removeButton = screen
      .getByRole('button', { name: 'Remove Fake Widget widget' })
      .element()
    removeButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))

    // Assert: the button's stopPropagation prevented the parent drag handler
    // from ever seeing the press.
    expect(parentMouseDownSpy).not.toHaveBeenCalled()
  })
})
