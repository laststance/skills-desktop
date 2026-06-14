import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import '@/renderer/src/styles/globals.css'
import type {
  DashboardPage,
  DashboardPageId,
  WidgetInstance,
  WidgetInstanceId,
} from '@/renderer/src/components/dashboard/types'

/**
 * Build a dashboard page that holds a single welcome widget so the real
 * `removeWidget` reducer has a placement to delete when Dismiss fires.
 * @param widgetId - Instance id wired to the rendered WelcomeWidget.
 * @returns A one-page, one-widget dashboard fixture.
 */
function makeWelcomePage(widgetId: WidgetInstanceId): DashboardPage {
  return {
    id: 'p_welcome' as DashboardPageId,
    name: 'Overview',
    widgets: [
      {
        id: widgetId,
        type: 'welcome',
        x: 0,
        y: 0,
        w: 6,
        h: 2,
      },
    ],
  }
}

/**
 * Build the welcome WidgetInstance for the rendered widget. A factory call
 * (vs an inline object literal) gives the `instance` prop a call-expression
 * initializer that the `prefer-usememo` lint rule accepts.
 * @param widgetId - Instance id matching the seeded dashboard placement.
 * @returns A welcome-type WidgetInstance at the default 6x2 grid placement.
 * @example
 * makeWelcomeInstance('w_welcome' as WidgetInstanceId)
 */
function makeWelcomeInstance(widgetId: WidgetInstanceId): WidgetInstance {
  return {
    id: widgetId,
    type: 'welcome',
    x: 0,
    y: 0,
    w: 6,
    h: 2,
  }
}

/**
 * Render the real WelcomeWidget against live dashboard + ui reducers.
 * Seeds the store so the welcome widget actually sits on a page (lets the
 * Dismiss flow be observed end-to-end through `removeWidget`).
 * @param welcomeDismissed - Initial persisted dismissal flag; true renders the
 *   compact hint branch, false renders the full hero pitch.
 */
async function renderWelcomeWidget(welcomeDismissed: boolean) {
  const [
    { default: dashboardReducer, dismissWelcome },
    { default: uiReducer },
    { WelcomeWidget },
  ] = await Promise.all([
    import('@/renderer/src/redux/slices/dashboardSlice'),
    import('@/renderer/src/redux/slices/uiSlice'),
    import('./WelcomeWidget'),
  ])

  const widgetId = 'w_welcome' as WidgetInstanceId
  const instance = makeWelcomeInstance(widgetId)

  const store = configureStore({
    reducer: {
      dashboard: dashboardReducer,
      ui: uiReducer,
    },
    preloadedState: {
      dashboard: {
        pages: [makeWelcomePage(widgetId)],
        currentPageId: 'p_welcome' as DashboardPageId,
        isEditMode: false,
        welcomeDismissed: false,
        initialized: true,
      },
    },
  })

  // Drive the dismissed flag through the real reducer so no internal shape is
  // hand-faked beyond the seeded page above.
  if (welcomeDismissed) {
    store.dispatch(dismissWelcome())
  }

  const screen = await render(
    <Provider store={store}>
      <div style={{ width: 360, height: 160 }}>
        <WelcomeWidget instance={instance} />
      </div>
    </Provider>,
  )

  return { screen, store, widgetId }
}

describe('WelcomeWidget', () => {
  it('removes the welcome card and remembers the dismissal when the user dismisses the hero pitch', async () => {
    // Arrange: full pitch is showing and the widget is placed on a page.
    const { screen, store } = await renderWelcomeWidget(false)
    await expect
      .element(screen.getByText('Welcome to Skills Desktop'))
      .toBeVisible()
    // Act
    await screen.getByRole('button', { name: /Dismiss welcome/i }).click()

    // Assert: the widget is gone from its page and the dismissal persists.
    expect(store.getState().dashboard.pages[0].widgets).toEqual([])
    expect(store.getState().dashboard.welcomeDismissed).toBe(true)
  })

  it('jumps to the Marketplace tab when the user clicks Open Marketplace', async () => {
    // Arrange: full pitch with the CTA, starting on the installed tab.
    const { screen, store } = await renderWelcomeWidget(false)
    expect(store.getState().ui.activeTab).toBe('installed')
    // Act
    await screen.getByRole('button', { name: /Open Marketplace/i }).click()

    // Assert
    expect(store.getState().ui.activeTab).toBe('marketplace')
  })

  it('shows a compact dismissed hint instead of the full pitch for returning users', async () => {
    // Arrange + Act: render with the persisted dismissal flag already set.
    const { screen } = await renderWelcomeWidget(true)

    // Assert: the muted hint replaces the hero copy and CTA.
    await expect
      .element(
        screen.getByText(/Welcome card dismissed — remove in edit mode/i),
      )
      .toBeVisible()
    expect(screen.getByText('Welcome to Skills Desktop').query()).toBeNull()
    expect(
      screen.getByRole('button', { name: /Open Marketplace/i }).query(),
    ).toBeNull()
  })
})
