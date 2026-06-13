import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import { selectSkill } from '@/renderer/src/redux/slices/skillsSlice'
import { setActiveTab } from '@/renderer/src/redux/slices/uiSlice'
import { DEFAULT_SETTINGS } from '@/shared/settings'
import type { Skill, SkillName } from '@/shared/types'
import { repositoryId } from '@/shared/types'

// Replace the three routed panels with marker stubs so DetailPanel renders in
// isolation — the real children fetch via IPC on mount, which is irrelevant to
// the panel's routing + close-button behavior under test here.
vi.mock('@/renderer/src/components/skills/SkillDetail', () => ({
  SkillDetail: () => <div data-testid="skill-detail" />,
}))
vi.mock('@/renderer/src/components/dashboard/DashboardCanvas', () => ({
  DashboardCanvas: () => <div data-testid="dashboard-canvas" />,
}))
vi.mock('@/renderer/src/components/marketplace/MarketplaceDetailPanel', () => ({
  MarketplaceDetailPanel: () => <div data-testid="marketplace-detail" />,
}))

/**
 * Build a combined store from each slice's own initialState so DetailPanel reads
 * real defaults (`activeTab: 'installed'`, `selectedSkill: null`). Tests dispatch
 * actions after rendering to drive non-default routing states.
 * @returns Redux store wired with the slices DetailPanel subscribes to
 */
async function createStore() {
  const { default: uiReducer } =
    await import('@/renderer/src/redux/slices/uiSlice')
  const { default: skillsReducer } =
    await import('@/renderer/src/redux/slices/skillsSlice')
  const { default: settingsReducer } =
    await import('@/renderer/src/redux/slices/settingsSlice')
  return configureStore({
    reducer: {
      ui: uiReducer,
      skills: skillsReducer,
      settings: settingsReducer,
    },
    preloadedState: {
      settings: { ...DEFAULT_SETTINGS },
    },
  })
}

/**
 * Render DetailPanel inside the Redux provider it requires.
 * @returns { screen, store } — screen exposes vitest-browser-react locators
 */
async function renderDetailPanel() {
  const store = await createStore()
  const { DetailPanel } = await import('./DetailPanel')
  const screen = await render(
    <Provider store={store}>
      <DetailPanel />
    </Provider>,
  )
  return { screen, store }
}

/**
 * Minimal source-repo skill so a selection can flip the panel into the
 * SkillDetail route and surface the close button.
 * @returns Skill row sufficient for `selectSkill`
 */
function makeSelectableSkill(): Skill {
  return {
    name: 'demo-skill' as SkillName,
    description: '',
    path: '/skills/demo-skill' as never,
    symlinkCount: 0,
    symlinks: [],
    isSource: true,
    isOrphan: false,
    source: repositoryId('owner/repo'),
    sourceUrl: 'https://github.com/owner/repo.git',
  }
}

describe('DetailPanel routing and close affordance', () => {
  it('shows the dashboard widgets when the Installed tab has no skill selected', async () => {
    // Arrange
    const { screen } = await renderDetailPanel()

    // Act — default state is installed tab + no selection, so just render

    // Assert
    await expect
      .element(screen.getByTestId('dashboard-canvas'))
      .toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Close detail panel' }).query(),
    ).toBeNull()
  })

  it('exposes a close affordance and returns to the dashboard when a selected skill is dismissed', async () => {
    // Arrange — select a skill so the Installed tab routes to SkillDetail and
    // reveals the close button
    const { screen, store } = await renderDetailPanel()
    store.dispatch(selectSkill(makeSelectableSkill()))
    await expect.element(screen.getByTestId('skill-detail')).toBeInTheDocument()

    // Act — click the close button (runs the dispatch(selectSkill(null)) handler)
    await screen.getByRole('button', { name: 'Close detail panel' }).click()

    // Assert — selection cleared, so the panel falls back to the dashboard and
    // the close button is gone
    await expect
      .element(screen.getByTestId('dashboard-canvas'))
      .toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Close detail panel' }).query(),
    ).toBeNull()
  })

  it('shows the marketplace inspector with no close button on the Marketplace tab', async () => {
    // Arrange — switch to the marketplace tab and select a skill; the close
    // button must stay hidden because marketplace owns its own back affordance
    const { screen, store } = await renderDetailPanel()
    store.dispatch(setActiveTab('marketplace'))
    store.dispatch(selectSkill(makeSelectableSkill()))

    // Act — render reflects the marketplace route

    // Assert
    await expect
      .element(screen.getByTestId('marketplace-detail'))
      .toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Close detail panel' }).query(),
    ).toBeNull()
  })
})
