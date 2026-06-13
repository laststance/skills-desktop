import { configureStore } from '@reduxjs/toolkit'
import { Flame } from 'lucide-react'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import '@/renderer/src/styles/globals.css'
import type {
  RankingFilter,
  SkillSearchResult,
  LeaderboardData,
} from '@/shared/types'
import { repositoryId } from '@/shared/types'

// The widget dispatches `loadLeaderboard(filter)` on mount, whose thunk reads
// `window.electron.marketplace.leaderboard`. Browser-mode tests replace the
// preload bridge, so the IPC surface is stubbed. A never-resolving promise is
// the default: it lets each test pin the leaderboard state it seeded without a
// late `fulfilled` action racing in and overwriting the rendered branch.
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
 * Build a leaderboard skill row fixture. The widget passes each skill straight
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
 * Seed the marketplace store with one leaderboard cache entry, then render the
 * widget inside a sized wrapper (it is `h-full w-full`). Seeding the slice
 * directly (rather than driving a thunk) lets a test pin any status/skills combo
 * — loading-with-stale-rows and error-with-empty are otherwise unreachable.
 * @param filter - Which leaderboard slot to seed and render for.
 * @param entry - Cache entry for that filter, or null to leave it unseeded.
 */
async function renderLeaderboard(
  filter: RankingFilter,
  entry: LeaderboardData | null,
) {
  const { default: marketplaceReducer } =
    await import('@/renderer/src/redux/slices/marketplaceSlice')
  const { LeaderboardWidget } = await import('./LeaderboardWidget')

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
            leaderboard: { [filter]: entry },
          },
        }
      : undefined,
  })

  const screen = await render(
    <Provider store={store}>
      <div style={{ width: 320, height: 240 }}>
        <LeaderboardWidget
          filter={filter}
          rowLimit={3}
          emptyIcon={Flame}
          emptyMessage="No trending skills yet"
          errorMessage="Couldn't load trending skills"
        />
      </div>
    </Provider>,
  )
  return { screen, store }
}

describe('LeaderboardWidget', () => {
  it('shows loading placeholders while the first fetch is still in flight', async () => {
    // Arrange: the filter has never resolved — status loading, no skills yet.
    const loadingEntry: LeaderboardData = {
      skills: [],
      lastFetched: 0,
      filter: 'trending',
      status: 'loading',
    }

    // Act
    const { screen } = await renderLeaderboard('trending', loadingEntry)

    // Assert: the skeleton's pulsing placeholders are on screen and no real
    // skill row text has rendered yet, so a regression that skipped the
    // first-load skeleton (popping data in abruptly) would fail here.
    await expect
      .element(screen.getByText('No trending skills yet'))
      .not.toBeInTheDocument()
    const skeleton = screen.baseElement.querySelector('.animate-pulse')
    expect(skeleton).not.toBeNull()
  })

  it('shows loading placeholders when no leaderboard data exists at all', async () => {
    // Arrange: nothing seeded — the widget renders before its mount fetch lands.
    // Act
    const { screen } = await renderLeaderboard('trending', null)

    // Assert: the absence of any cached entry still resolves to the skeleton,
    // never a crash from reading `.status` off undefined.
    const skeleton = screen.baseElement.querySelector('.animate-pulse')
    expect(skeleton).not.toBeNull()
  })

  it('shows the error hint when the load failed with no data to fall back on', async () => {
    // Arrange: the fetch failed and there is no stale data — error + empty.
    // The mount thunk re-fetches errored filters (errors bypass the TTL gate),
    // so the IPC mock must reject for state to settle back on the error branch
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
    const { screen } = await renderLeaderboard('trending', erroredEntry)

    // Assert: the widget surfaces the caller-supplied error copy.
    await expect
      .element(screen.getByText("Couldn't load trending skills"))
      .toBeVisible()
  })

  it('shows the empty-state message when the leaderboard returned zero rows', async () => {
    // Arrange: a successful load that returned no skills.
    const emptyEntry: LeaderboardData = {
      skills: [],
      lastFetched: Date.now(),
      filter: 'trending',
      status: 'idle',
    }

    // Act
    const { screen } = await renderLeaderboard('trending', emptyEntry)

    // Assert: the caller-supplied empty copy renders (not the error copy).
    await expect
      .element(screen.getByText('No trending skills yet'))
      .toBeVisible()
  })

  it('renders one row per ranked skill once data has loaded', async () => {
    // Arrange: a successful load with two ranked skills.
    const loadedEntry: LeaderboardData = {
      skills: [makeSkill(1, 'alpha-skill'), makeSkill(2, 'beta-skill')],
      lastFetched: Date.now(),
      filter: 'trending',
      status: 'idle',
    }

    // Act
    const { screen } = await renderLeaderboard('trending', loadedEntry)

    // Assert: each ranked skill shows as its own list row.
    const rows = screen.getByRole('listitem')
    await expect.element(rows.nth(0)).toHaveTextContent('alpha-skill')
    await expect.element(rows.nth(1)).toHaveTextContent('beta-skill')
  })

  it('caps the rendered rows at rowLimit even when more skills loaded', async () => {
    // Arrange: five skills loaded but the widget was given rowLimit 3.
    const overflowEntry: LeaderboardData = {
      skills: [
        makeSkill(1, 'one-skill'),
        makeSkill(2, 'two-skill'),
        makeSkill(3, 'three-skill'),
        makeSkill(4, 'four-skill'),
        makeSkill(5, 'five-skill'),
      ],
      lastFetched: Date.now(),
      filter: 'trending',
      status: 'idle',
    }

    // Act
    const { screen } = await renderLeaderboard('trending', overflowEntry)

    // Assert: only the first three ranks render; the fourth is dropped.
    // Exact match avoids colliding with the row's `owner/three-skill` repo span.
    await expect
      .element(screen.getByText('three-skill', { exact: true }))
      .toBeVisible()
    await expect
      .element(screen.getByText('four-skill', { exact: true }))
      .not.toBeInTheDocument()
  })
})
