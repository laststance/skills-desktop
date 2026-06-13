import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import '@/renderer/src/styles/globals.css'

import type { DashboardPage } from './types'
import { newDashboardPageId } from './utils/ids'

/**
 * Render DashboardEditToolbar with the real dashboard/ui/widgetPicker/skills/
 * agents reducers. The toolbar always mounts <WidgetPicker>, which reads the
 * dashboard/skills/agents/widgetPicker slices for its live preview — so all
 * five reducers are wired even when a test only drives a toolbar button.
 * Preloaded dashboard state pins the page set and edit mode without running the
 * seeding effect.
 * @param options.pages - Preloaded pages (defaults to a single named page).
 * @param options.isEditMode - Start the toolbar in edit mode.
 * @returns Browser screen + the Redux store for state assertions.
 * @example
 * const { screen, store } = await renderToolbar({ isEditMode: true })
 */
async function renderToolbar(
  options: {
    pages?: DashboardPage[]
    isEditMode?: boolean
  } = {},
) {
  const [
    { default: dashboardReducer },
    { default: uiReducer },
    { default: widgetPickerReducer },
    { default: skillsReducer },
    { default: agentsReducer },
    { DashboardEditToolbar },
  ] = await Promise.all([
    import('@/renderer/src/redux/slices/dashboardSlice'),
    import('@/renderer/src/redux/slices/uiSlice'),
    import('@/renderer/src/redux/slices/widgetPickerSlice'),
    import('@/renderer/src/redux/slices/skillsSlice'),
    import('@/renderer/src/redux/slices/agentsSlice'),
    import('./DashboardEditToolbar'),
  ])

  const pages = options.pages ?? [
    { id: newDashboardPageId(), name: 'My Layout', widgets: [] },
  ]

  const store = configureStore({
    reducer: {
      dashboard: dashboardReducer,
      ui: uiReducer,
      widgetPicker: widgetPickerReducer,
      skills: skillsReducer,
      agents: agentsReducer,
    },
    preloadedState: {
      dashboard: {
        pages,
        currentPageId: pages[0]?.id ?? null,
        isEditMode: options.isEditMode ?? false,
        welcomeDismissed: false,
        initialized: true,
      },
    },
  })

  const screen = await render(
    <Provider store={store}>
      <DashboardEditToolbar />
    </Provider>,
  )
  return { screen, store }
}

describe('DashboardEditToolbar', () => {
  // window.confirm is stubbed per-test (Reset uses it); restore so the native
  // dialog never leaks into a later test and blocks the browser lane.
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reveals the Widget, Page and Reset customization controls once in edit mode', async () => {
    // Arrange + Act: mount already in edit mode.
    const { screen } = await renderToolbar({ isEditMode: true })

    // Assert: the three edit-only affordances render alongside the Done toggle.
    await expect
      .element(screen.getByRole('button', { name: /widget/i }))
      .toBeVisible()
    await expect
      .element(screen.getByRole('button', { name: /page/i }))
      .toBeVisible()
    await expect
      .element(screen.getByRole('button', { name: /reset/i }))
      .toBeVisible()
    await expect
      .element(screen.getByRole('button', { name: /done/i }))
      .toBeVisible()
  })

  it('keeps the customization controls hidden until edit mode is entered', async () => {
    // Arrange + Act: mount in view mode (default).
    const { screen } = await renderToolbar()

    // Assert: only the Edit toggle is present; no destructive controls leak in.
    await expect
      .element(screen.getByRole('button', { name: /edit/i }))
      .toBeVisible()
    expect(screen.getByRole('button', { name: /widget/i }).query()).toBeNull()
    expect(screen.getByRole('button', { name: /^page$/i }).query()).toBeNull()
    expect(screen.getByRole('button', { name: /reset/i }).query()).toBeNull()
  })

  it('opens the Add Widget picker when the Widget button is clicked', async () => {
    // Arrange
    const { screen } = await renderToolbar({ isEditMode: true })

    // Act: click the "+ Widget" affordance.
    await screen.getByRole('button', { name: /widget/i }).click()

    // Assert: the WidgetPicker dialog is now open.
    await expect.element(screen.getByRole('dialog')).toBeVisible()
  })

  it('appends a new blank page when the Page button is clicked', async () => {
    // Arrange: a single starting page.
    const { screen, store } = await renderToolbar({
      pages: [{ id: newDashboardPageId(), name: 'Overview', widgets: [] }],
      isEditMode: true,
    })

    // Act: click the "+ Page" affordance.
    await screen.getByRole('button', { name: /page/i }).click()

    // Assert: the dashboard now holds two pages.
    expect(store.getState().dashboard.pages).toHaveLength(2)
  })

  it('restores the default layout preset when Reset is confirmed', async () => {
    // Arrange: a custom single-page layout, with confirm stubbed to accept.
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { screen, store } = await renderToolbar({
      pages: [
        { id: newDashboardPageId(), name: 'My Custom Page', widgets: [] },
      ],
      isEditMode: true,
    })

    // Act: click Reset and confirm the destructive prompt.
    await screen.getByRole('button', { name: /reset/i }).click()

    // Assert: the four default preset pages replace the custom arrangement.
    expect(store.getState().dashboard.pages.map((page) => page.name)).toEqual([
      'Overview',
      'Discovery',
      'Actions',
      'Personal',
    ])
  })

  it('keeps the custom layout intact when the Reset prompt is dismissed', async () => {
    // Arrange: a custom layout, with confirm stubbed to reject.
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { screen, store } = await renderToolbar({
      pages: [
        { id: newDashboardPageId(), name: 'My Custom Page', widgets: [] },
      ],
      isEditMode: true,
    })

    // Act: click Reset but dismiss the destructive prompt.
    await screen.getByRole('button', { name: /reset/i }).click()

    // Assert: the user's single custom page is untouched.
    expect(store.getState().dashboard.pages.map((page) => page.name)).toEqual([
      'My Custom Page',
    ])
  })

  it('enters edit mode when the Edit toggle is clicked from view mode', async () => {
    // Arrange: view mode, so the toggle reads "Edit".
    const { screen, store } = await renderToolbar()

    // Act: click the Edit toggle.
    await screen.getByRole('button', { name: /edit/i }).click()

    // Assert: the dashboard is now in edit mode.
    expect(store.getState().dashboard.isEditMode).toBe(true)
  })

  it('leaves edit mode when the Done toggle is clicked', async () => {
    // Arrange: edit mode, so the toggle reads "Done".
    const { screen, store } = await renderToolbar({ isEditMode: true })

    // Act: click the Done toggle.
    await screen.getByRole('button', { name: /done/i }).click()

    // Assert: the dashboard has returned to view mode.
    expect(store.getState().dashboard.isEditMode).toBe(false)
  })
})
