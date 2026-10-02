import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import '@/renderer/src/styles/globals.css'

// Refresh reads the preload bridge; never-resolving mocks retain its busy state.
const mockSkillsGetAll = vi.fn()
const mockAgentsGetAll = vi.fn()
const mockSourceGetStats = vi.fn()

beforeEach(() => {
  mockSkillsGetAll.mockReset()
  mockAgentsGetAll.mockReset()
  mockSourceGetStats.mockReset()
  // Never-resolving so each thunk stays pending after a click.
  mockSkillsGetAll.mockReturnValue(new Promise(() => {}))
  mockAgentsGetAll.mockReturnValue(new Promise(() => {}))
  mockSourceGetStats.mockReturnValue(new Promise(() => {}))
  vi.stubGlobal('electron', {
    skills: { getAll: mockSkillsGetAll },
    agents: { getAll: mockAgentsGetAll },
    source: { getStats: mockSourceGetStats },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Render the real QuickActionsWidget against a fresh store with all
 * action-relevant slices wired up. A new store per call guarantees
 * `isRefreshing` starts false so the Refresh button is
 * enabled and their click handlers actually run.
 * @returns Render screen plus the backing Redux store.
 */
async function renderQuickActions() {
  const [
    { default: uiReducer },
    { default: dashboardReducer },
    { default: skillsReducer },
    { default: agentsReducer },
    { QuickActionsWidget },
  ] = await Promise.all([
    import('@/renderer/src/redux/slices/uiSlice'),
    import('@/renderer/src/redux/slices/dashboardSlice'),
    import('@/renderer/src/redux/slices/skillsSlice'),
    import('@/renderer/src/redux/slices/agentsSlice'),
    import('./QuickActionsWidget'),
  ])
  const store = configureStore({
    reducer: {
      ui: uiReducer,
      dashboard: dashboardReducer,
      skills: skillsReducer,
      agents: agentsReducer,
    },
  })

  const screen = await render(
    <Provider store={store}>
      <div style={{ width: 320, height: 240 }}>
        <QuickActionsWidget />
      </div>
    </Provider>,
  )
  return { screen, store }
}

describe('QuickActionsWidget', () => {
  test('offers three shortcuts and no all-agent Sync action', async () => {
    // Arrange + Act
    const { screen } = await renderQuickActions()

    // Assert: each shortcut renders its own labelled tile, so a regression that
    // drops or mislabels one of the three quick actions fails here.
    await expect
      .element(screen.getByRole('button', { name: 'Sync' }))
      .not.toBeInTheDocument()
    await expect
      .element(screen.getByRole('button', { name: 'Refresh' }))
      .toBeVisible()
    await expect
      .element(screen.getByRole('button', { name: 'Marketplace' }))
      .toBeVisible()
    await expect
      .element(screen.getByRole('button', { name: 'Reset Layout' }))
      .toBeVisible()
  })

  test('re-scans skills, agents, and source stats and shows Refresh as busy when clicked', async () => {
    // Arrange
    const { screen } = await renderQuickActions()

    // Act
    await screen.getByRole('button', { name: 'Refresh' }).click()

    // Assert: all three refresh reads fired in parallel and the in-flight scan
    // disables the Refresh tile.
    expect(mockSkillsGetAll).toHaveBeenCalledTimes(1)
    expect(mockAgentsGetAll).toHaveBeenCalledTimes(1)
    expect(mockSourceGetStats).toHaveBeenCalledTimes(1)
    await expect
      .element(screen.getByRole('button', { name: 'Refresh' }))
      .toBeDisabled()
  })

  test('renders a non-busy tile with a static, non-spinning icon and an enabled button', async () => {
    // Arrange + Act: Marketplace is rendered without an `isBusy` prop, so the
    // tile falls back to its default idle state.
    const { screen } = await renderQuickActions()

    // Assert: an idle tile shows no spinner and stays clickable, so a
    // regression that leaves quick actions stuck in a busy/disabled state
    // (or always spinning) fails here.
    const marketplaceButton = screen.getByRole('button', {
      name: 'Marketplace',
    })
    await expect.element(marketplaceButton).toBeEnabled()
    const marketplaceIcon = marketplaceButton.element().querySelector('svg')
    expect(marketplaceIcon).not.toBeNull()
    expect(marketplaceIcon?.classList.contains('animate-spin')).toBe(false)
  })

  test('switches the main view to the marketplace tab when Marketplace is clicked', async () => {
    // Arrange: the app starts on the installed tab.
    const { screen, store } = await renderQuickActions()

    // Act
    await screen.getByRole('button', { name: 'Marketplace' }).click()

    // Assert: the active tab flips so the user lands on marketplace search.
    expect(store.getState().ui.activeTab).toBe('marketplace')
  })

  test('restores the default dashboard arrangement when Reset Layout is clicked', async () => {
    // Arrange: drift away from defaults by adding an extra page so a no-op reset
    // could not pass by accident.
    const { screen, store } = await renderQuickActions()
    const { addPage } =
      await import('@/renderer/src/redux/slices/dashboardSlice')
    store.dispatch(addPage())

    // Act
    await screen.getByRole('button', { name: 'Reset Layout' }).click()

    // Assert: the dashboard snaps back to the literal 4-page default preset,
    // with the first page being "Overview" and a page selected.
    const { pages, currentPageId } = store.getState().dashboard
    expect(pages).toHaveLength(4)
    expect(pages[0].name).toBe('Overview')
    expect(currentPageId).not.toBeNull()
  })
})
