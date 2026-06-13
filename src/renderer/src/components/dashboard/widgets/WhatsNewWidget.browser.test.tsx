import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import '@/renderer/src/styles/globals.css'
import type { SkillSearchResult, LeaderboardData } from '@/shared/types'

// WhatsNewWidget wraps LeaderboardWidget pinned to the `hot` feed. On mount the
// inner widget dispatches `loadLeaderboard('hot')`, whose thunk reads
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
 * Seed the marketplace store with one `hot` leaderboard cache entry, then render
 * WhatsNewWidget inside a sized wrapper (the inner body is `h-full w-full`).
 * Seeding the `hot` slot directly proves the wrapper reads the `hot` filter:
 * a wrong filter would miss this slot and fall back to the skeleton instead.
 * @param entry - Cache entry to seed into the `hot` slot, or null to leave it unseeded.
 */
async function renderWhatsNew(entry: LeaderboardData | null) {
  const { default: marketplaceReducer } =
    await import('@/renderer/src/redux/slices/marketplaceSlice')
  const { WhatsNewWidget } = await import('./WhatsNewWidget')

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
            leaderboard: { hot: entry },
          },
        }
      : undefined,
  })

  const screen = await render(
    <Provider store={store}>
      <div style={{ width: 320, height: 240 }}>
        <WhatsNewWidget />
      </div>
    </Provider>,
  )
  return { screen, store }
}

describe('WhatsNewWidget', () => {
  it('shows the "Nothing new yet" hint when the hot feed returned zero skills', async () => {
    // Arrange: a successful `hot` load that returned no skills.
    const emptyHotEntry: LeaderboardData = {
      skills: [],
      lastFetched: Date.now(),
      filter: 'hot',
      status: 'idle',
    }

    // Act
    const { screen } = await renderWhatsNew(emptyHotEntry)

    // Assert: the wrapper's own empty copy renders. This only appears if the
    // widget read the `hot` slot we seeded, so it proves both the `filter="hot"`
    // wiring and the `emptyMessage="Nothing new yet"` wiring in one shot.
    await expect.element(screen.getByText('Nothing new yet')).toBeVisible()
  })

  it('shows the "Couldn\'t load new skills" hint when the hot feed failed with no data', async () => {
    // Arrange: the fetch failed and there is no stale data — error + empty.
    // The mount thunk re-fetches errored filters (errors bypass the TTL gate),
    // so the IPC mock must reject for state to settle back on the error branch
    // instead of getting stuck on the in-flight skeleton.
    mockLeaderboard.mockRejectedValue(new Error('network down'))
    const erroredHotEntry: LeaderboardData = {
      skills: [],
      lastFetched: 0,
      filter: 'hot',
      status: 'error',
      error: 'network down',
    }

    // Act
    const { screen } = await renderWhatsNew(erroredHotEntry)

    // Assert: the wrapper surfaces its own error copy, not a generic message.
    await expect
      .element(screen.getByText("Couldn't load new skills"))
      .toBeVisible()
  })
})
