import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import '@/renderer/src/styles/globals.css'

// QuickActionsWidget's Sync/Refresh tiles dispatch async thunks that read the
// preload bridge (`window.electron.sync.preview`, `skills.getAll`,
// `agents.getAll`, `source.getStats`). Browser-mode tests replace that bridge,
// so every IPC method is stubbed with a never-resolving promise: this keeps the
// thunk parked in `pending` (so `isSyncing` / `isRefreshing` stay true for the
// disabled-state assertions) and prevents a late `fulfilled` action from
// dispatching after a test's assertion and flipping the flag back — the classic
// browser-lane "passes then flakes" race.
const mockSyncPreview = vi.fn()
const mockSkillsGetAll = vi.fn()
const mockAgentsGetAll = vi.fn()
const mockSourceGetStats = vi.fn()

beforeEach(() => {
  mockSyncPreview.mockReset()
  mockSkillsGetAll.mockReset()
  mockAgentsGetAll.mockReset()
  mockSourceGetStats.mockReset()
  // Never-resolving so each thunk stays pending after a click.
  mockSyncPreview.mockReturnValue(new Promise(() => {}))
  mockSkillsGetAll.mockReturnValue(new Promise(() => {}))
  mockAgentsGetAll.mockReturnValue(new Promise(() => {}))
  mockSourceGetStats.mockReturnValue(new Promise(() => {}))
  vi.stubGlobal('electron', {
    sync: { preview: mockSyncPreview },
    skills: { getAll: mockSkillsGetAll },
    agents: { getAll: mockAgentsGetAll },
    source: { getStats: mockSourceGetStats },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Render the real QuickActionsWidget against a fresh store with all four
 * action-relevant slices wired up. A new store per call guarantees
 * `isSyncing` / `isRefreshing` start false so the Sync/Refresh buttons are
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
  it('offers all four cold-start shortcuts as labelled buttons', async () => {
    // Arrange + Act
    const { screen } = await renderQuickActions()

    // Assert: each shortcut renders its own labelled tile, so a regression that
    // drops or mislabels one of the four quick actions fails here.
    await expect
      .element(screen.getByRole('button', { name: 'Sync' }))
      .toBeVisible()
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

  it('starts a sync preview and shows the Sync tile as busy when clicked', async () => {
    // Arrange
    const { screen } = await renderQuickActions()

    // Act
    await screen.getByRole('button', { name: 'Sync' }).click()

    // Assert: the preview IPC fired and the in-flight sync disables the tile
    // (the spinner/busy wiring the user relies on to know work has started).
    expect(mockSyncPreview).toHaveBeenCalledTimes(1)
    await expect
      .element(screen.getByRole('button', { name: 'Sync' }))
      .toBeDisabled()
  })

  it('re-scans skills, agents, and source stats and shows Refresh as busy when clicked', async () => {
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

  it('renders a non-busy tile with a static, non-spinning icon and an enabled button', async () => {
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

  it('switches the main view to the marketplace tab when Marketplace is clicked', async () => {
    // Arrange: the app starts on the installed tab.
    const { screen, store } = await renderQuickActions()

    // Act
    await screen.getByRole('button', { name: 'Marketplace' }).click()

    // Assert: the active tab flips so the user lands on marketplace search.
    expect(store.getState().ui.activeTab).toBe('marketplace')
  })

  it('restores the default dashboard arrangement when Reset Layout is clicked', async () => {
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
