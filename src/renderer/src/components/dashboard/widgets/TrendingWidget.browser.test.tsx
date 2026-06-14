import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import '@/renderer/src/styles/globals.css'
import type { SkillSearchResult, LeaderboardData } from '@/shared/types'
import { repositoryId } from '@/shared/types'

// TrendingWidget mounts LeaderboardWidget, which dispatches
// `loadLeaderboard('trending')` on mount; the thunk reads
// `window.electron.marketplace.leaderboard`. Browser-mode tests replace the
// preload bridge. A never-resolving promise is the default so the seeded
// leaderboard state stays pinned without a late `fulfilled` action racing in.
const mockLeaderboard = vi.fn()

beforeEach(() => {
  mockLeaderboard.mockReset()
  mockLeaderboard.mockReturnValue(new Promise<SkillSearchResult[]>(() => {}))
  vi.stubGlobal('electron', {
    marketplace: {
      leaderboard: mockLeaderboard,
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Build a trending skill row fixture. TrendingWidget hands each skill straight
 * to `MarketplaceSkillRow`, which renders the name; tests assert on the name.
 * @param rank - 1-indexed leaderboard rank.
 * @param name - Skill name (also the row's visible label and React key).
 */
function makeSkill(rank: number, name: string): SkillSearchResult {
  return {
    rank,
    name,
    repo: repositoryId(`owner/${name}`),
    url: `https://skills.sh/${name}`,
    installCount: 100,
  }
}

/**
 * Seed the marketplace store's `trending` cache slot, then render TrendingWidget
 * inside a sized wrapper (it is `h-full w-full`). Seeding the slice directly lets
 * a test pin any status/skills combo for the trending feed.
 * @param entry - Cache entry for the trending filter, or null to leave it unseeded.
 */
async function renderTrending(entry: LeaderboardData | null) {
  const { default: marketplaceReducer } =
    await import('@/renderer/src/redux/slices/marketplaceSlice')
  const { TrendingWidget } = await import('./TrendingWidget')

  const store = configureStore({
    reducer: { marketplace: marketplaceReducer },
    preloadedState: entry
      ? {
          marketplace: {
            status: 'idle' as const,
            searchQuery: '',
            searchResults: [],
            selectedSkill: null,
            previewSkill: null,
            installProgress: null,
            error: null,
            leaderboard: { trending: entry },
          },
        }
      : undefined,
  })

  const screen = await render(
    <Provider store={store}>
      <div style={{ width: 320, height: 240 }}>
        <TrendingWidget />
      </div>
    </Provider>,
  )
  return { screen, store }
}

describe('TrendingWidget', () => {
  it('surfaces the trending empty-state copy when the trending feed returned zero rows', async () => {
    // Arrange: a successful trending load that returned no skills.
    const emptyEntry: LeaderboardData = {
      skills: [],
      lastFetched: Date.now(),
      filter: 'trending',
      status: 'idle',
    }

    // Act
    const { screen } = await renderTrending(emptyEntry)

    // Assert: the trending-specific empty copy renders, proving the wrapper
    // wired its `emptyMessage` prop through to LeaderboardWidget.
    await expect
      .element(screen.getByText('No trending skills yet'))
      .toBeVisible()
  })

  it('surfaces the trending error copy when the trending feed failed with no data to fall back on', async () => {
    // Arrange: the trending fetch failed and there is no stale data — error +
    // empty. The mount thunk re-fetches errored filters (errors bypass the TTL
    // gate), so the IPC mock must reject for state to settle on the error branch
    // instead of getting stuck on the in-flight skeleton.
    mockLeaderboard.mockRejectedValue(new Error('network down'))
    const erroredEntry: LeaderboardData = {
      skills: [],
      lastFetched: 0,
      filter: 'trending',
      status: 'error',
      error: 'network down',
    }

    // Act
    const { screen } = await renderTrending(erroredEntry)

    // Assert: the trending-specific error copy renders, proving the wrapper
    // wired its `errorMessage` prop through.
    await expect
      .element(screen.getByText("Couldn't load trending skills"))
      .toBeVisible()
  })

  it('renders one row per trending skill once the trending feed has loaded', async () => {
    // Arrange: a successful trending load with two ranked skills.
    const loadedEntry: LeaderboardData = {
      skills: [makeSkill(1, 'alpha-skill'), makeSkill(2, 'beta-skill')],
      lastFetched: Date.now(),
      filter: 'trending',
      status: 'idle',
    }

    // Act
    const { screen } = await renderTrending(loadedEntry)

    // Assert: each ranked trending skill shows as its own list row.
    const rows = screen.getByRole('listitem')
    await expect.element(rows.nth(0)).toHaveTextContent('alpha-skill')
    await expect.element(rows.nth(1)).toHaveTextContent('beta-skill')
  })

  it('caps trending rows at eight even when more skills loaded', async () => {
    // Arrange: nine skills loaded; TrendingWidget hard-codes rowLimit 8.
    const overflowEntry: LeaderboardData = {
      skills: [
        makeSkill(1, 'one-skill'),
        makeSkill(2, 'two-skill'),
        makeSkill(3, 'three-skill'),
        makeSkill(4, 'four-skill'),
        makeSkill(5, 'five-skill'),
        makeSkill(6, 'six-skill'),
        makeSkill(7, 'seven-skill'),
        makeSkill(8, 'eight-skill'),
        makeSkill(9, 'nine-skill'),
      ],
      lastFetched: Date.now(),
      filter: 'trending',
      status: 'idle',
    }

    // Act
    const { screen } = await renderTrending(overflowEntry)

    // Assert: the eighth rank renders but the ninth is dropped, proving the
    // wrapper's hard-coded `rowLimit={8}` reached LeaderboardWidget.
    // Exact match avoids colliding with the row's `owner/eight-skill` repo span.
    await expect
      .element(screen.getByText('eight-skill', { exact: true }))
      .toBeVisible()
    await expect
      .element(screen.getByText('nine-skill', { exact: true }))
      .not.toBeInTheDocument()
  })
})
