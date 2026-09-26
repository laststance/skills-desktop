import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import { selectSkill } from '@/renderer/src/redux/slices/skillsSlice'
import { setActiveTab } from '@/renderer/src/redux/slices/uiSlice'
import '@/renderer/src/styles/globals.css'
import { isInspectorFocused } from '@/renderer/src/utils/isInspectorFocused'
import {
  DEFAULT_BACKGROUND_CROP,
  type BackgroundSnapshot,
} from '@/shared/backgrounds'
import { DEFAULT_SETTINGS } from '@/shared/settings'
import type { Skill } from '@/shared/types'
import {
  repositoryId,
  toAbsolutePath,
  toHttpUrl,
  toSkillName,
  toSymlinkCount,
} from '@/shared/types'

// Replace the three routed panels with marker stubs so DetailPanel renders in
// isolation — the real children fetch via IPC on mount, which is irrelevant to
// the panel's routing + close-button behavior under test here.
vi.mock('@/renderer/src/components/skills/SkillDetail', () => ({
  SkillDetail: () => <div data-testid="skill-detail" />,
}))
// Fills the remaining height like the real DashboardCanvas root, so layout tests
// can tell whether the background credit covers routed content.
vi.mock('@/renderer/src/components/dashboard/DashboardCanvas', () => ({
  DashboardCanvas: () => (
    <div data-testid="dashboard-canvas" className="min-h-0 flex-1" />
  ),
}))
vi.mock('@/renderer/src/components/marketplace/MarketplaceDetailPanel', () => ({
  MarketplaceDetailPanel: () => <div data-testid="marketplace-detail" />,
}))

// Mutable per test: most tests run without an applied background image.
const backgroundSnapshot = vi.hoisted((): { current: BackgroundSnapshot } => ({
  current: {
    revision: 0,
    displayRetryRevision: 0,
    operation: null,
    display: null,
  },
}))
vi.mock('@/renderer/src/hooks/useBackgroundSnapshot', () => ({
  useBackgroundSnapshot: () => backgroundSnapshot.current,
}))

beforeEach(() => {
  backgroundSnapshot.current = {
    revision: 0,
    displayRetryRevision: 0,
    operation: null,
    display: null,
  }
})

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
    name: toSkillName('demo-skill'),
    description: '',
    path: toAbsolutePath('/skills/demo-skill'),
    symlinkCount: toSymlinkCount(0),
    symlinks: [],
    isSource: true,
    isOrphan: false,
    source: repositoryId('owner/repo'),
    sourceUrl: toHttpUrl('https://github.com/owner/repo.git'),
  }
}

describe('DetailPanel routing and close affordance', () => {
  test('shows the dashboard widgets when the Installed tab has no skill selected', async () => {
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

  test('exposes a close affordance and returns to the dashboard when a selected skill is dismissed', async () => {
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

  test('shows the marketplace inspector with no close button on the Marketplace tab', async () => {
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

describe('DetailPanel keyboard select-all', () => {
  test('marks the Inspector so Cmd+A inside it keeps native select-all', async () => {
    // Arrange — a selected skill routes to SkillDetail and shows the close button
    const { screen, store } = await renderDetailPanel()
    store.dispatch(selectSkill(makeSelectableSkill()))
    const closeButton = screen.getByRole('button', {
      name: 'Close detail panel',
    })
    await expect.element(closeButton).toBeVisible()

    // Act
    closeButton.element().focus()

    // Assert — the Installed tab's Cmd+A reads this as Inspector focus and
    // leaves the pane's text to the browser
    expect(isInspectorFocused(document.activeElement, null)).toBe(true)
  })
})

describe('DetailPanel background credit', () => {
  test('pins the Unsplash credit to the bottom-right corner below the panel content, away from the titlebar', async () => {
    // Arrange — an applied Unsplash background with photographer credit
    backgroundSnapshot.current = {
      revision: 1,
      displayRetryRevision: 0,
      operation: null,
      display: {
        selection: {
          source: { kind: 'builtin', builtinId: 'alpine-lake' },
          displayId: '00000000-0000-4000-8000-000000000001',
          crop: DEFAULT_BACKGROUND_CROP,
          aspect: 'original',
        },
        image: {
          url: 'https://images.unsplash.com/photo-1',
          width: 3840,
          height: 2160,
        },
        crop: DEFAULT_BACKGROUND_CROP,
        title: 'Alpine lake',
        credit: {
          photographerName: 'Kellen Riggin',
          photographerUrl: 'https://unsplash.com/@kellenriggin',
          photoUrl: 'https://unsplash.com/photos/alpine-lake',
        },
      },
    }
    const store = await createStore()
    const { DetailPanel } = await import('./DetailPanel')

    // Act — size the panel like a real inspector column
    const screen = await render(
      <Provider store={store}>
        <div style={{ width: 480, height: 600 }}>
          <DetailPanel />
        </div>
      </Provider>,
    )

    // Assert — both required credit links stay reachable
    const unsplashLink = screen.getByRole('link', { name: 'Unsplash' })
    await expect
      .element(screen.getByRole('link', { name: 'Kellen Riggin' }))
      .toBeVisible()
    await expect.element(unsplashLink).toBeVisible()
    const panelRect = screen
      .getByRole('complementary')
      .element()
      .getBoundingClientRect()
    const contentRect = screen
      .getByTestId('dashboard-canvas')
      .element()
      .getBoundingClientRect()
    const creditRect = unsplashLink.element().getBoundingClientRect()
    // Hugs the bottom-right corner of the window-edge inspector...
    expect(panelRect.bottom - creditRect.bottom).toBeLessThanOrEqual(8)
    expect(panelRect.right - creditRect.right).toBeLessThanOrEqual(16)
    // ...and sits below routed content instead of covering its controls.
    expect(creditRect.top).toBeGreaterThanOrEqual(contentRect.bottom)
  })
})
