import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import { SEARCH_DEBOUNCE_MS } from '@/shared/constants'
import { repositoryId } from '@/shared/types'
import type { SkillSearchResult } from '@/shared/types'

// The unit tests cover the debounce primitive and the reducer's latest-wins
// guard in isolation. This file is the only place the *composed* incremental
// search runs end to end: a real keystroke → handleChange → debounced run →
// runSearch's commit+dispatch → the IPC `search` call → results in the store.
// It guards the wiring the lint-forced callback pivot moved into the component,
// which nothing else exercises.

const mockSearch = vi.fn()

beforeEach(() => {
  // Fresh mock state per test, then re-point `window.electron.skillsCli.search`
  // at it. Stub `electron` (not `window`) so the browser lane keeps its real
  // window/DOM — `window.electron` resolves to this on `globalThis`.
  vi.resetAllMocks()
  vi.stubGlobal('electron', {
    skillsCli: {
      search: mockSearch,
      install: vi.fn(),
      cancel: vi.fn(),
      onProgress: vi.fn(() => () => {}),
    },
    // MarketplaceSearch never dispatches loadLeaderboard, but stubbing keeps the
    // test resilient if a future render path pulls the thunk in transitively.
    marketplace: {
      leaderboard: vi.fn(async () => []),
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const sampleResult: SkillSearchResult = {
  rank: 1,
  name: 'task',
  repo: repositoryId('vercel-labs/skill-task'),
  url: 'https://skills.sh/vercel-labs/skill-task',
}

/**
 * Render MarketplaceSearch over a marketplace-only store. Dynamic imports run
 * after `beforeEach` installs the `electron` stub, so the IPC bridge is in
 * place before the component module evaluates.
 */
async function renderSearch() {
  const { default: marketplaceReducer } =
    await import('@/renderer/src/redux/slices/marketplaceSlice')
  const store = configureStore({
    reducer: { marketplace: marketplaceReducer },
  })
  const { MarketplaceSearch } = await import('./MarketplaceSearch')
  const screen = await render(
    <Provider store={store}>
      <MarketplaceSearch />
    </Provider>,
  )
  const input = screen.getByRole('searchbox', {
    name: 'Search marketplace skills',
  })
  return { screen, store, input }
}

describe('MarketplaceSearch — incremental search', () => {
  it('fires a single remote search for the final query after a burst of typing', async () => {
    // Arrange
    mockSearch.mockResolvedValue([sampleResult])
    const { store, input } = await renderSearch()

    // Act — a fast burst: each keystroke restarts the debounce window.
    await input.fill('r')
    await input.fill('re')
    await input.fill('react')

    // Assert — exactly one remote call lands, for the final query, not one per
    // keystroke (that would be three calls).
    await expect.poll(() => mockSearch.mock.calls.length).toBe(1)
    expect(mockSearch).toHaveBeenCalledWith('react')

    // Assert — the settled query is committed and its results fill the panel.
    expect(store.getState().marketplace.searchQuery).toBe('react')
    await expect
      .poll(() => store.getState().marketplace.searchResults)
      .toEqual([sampleResult])
  })

  it('wipes the results and returns to the leaderboard when the box is cleared', async () => {
    // Arrange — run one search to completion so there is state to clear.
    mockSearch.mockResolvedValue([sampleResult])
    const { store, input } = await renderSearch()
    await input.fill('react')
    await expect
      .poll(() => store.getState().marketplace.searchResults)
      .toEqual([sampleResult])

    // Act — empty the box.
    await input.fill('')

    // Assert — results cleared, query reset, panel back to its idle state.
    await expect.poll(() => store.getState().marketplace.status).toBe('idle')
    expect(store.getState().marketplace.searchResults).toEqual([])
    expect(store.getState().marketplace.searchQuery).toBe('')
  })

  it('cancels the pending remote search when the box is cleared before it fires', async () => {
    // Arrange — search never gets to run; the clear should pre-empt it.
    const { input } = await renderSearch()

    // Act — type, then clear within the same quiet window.
    await input.fill('react')
    await input.fill('')

    // Assert — well past the debounce window, no remote call ever happened.
    await new Promise((resolve) => setTimeout(resolve, SEARCH_DEBOUNCE_MS * 2))
    expect(mockSearch).not.toHaveBeenCalled()
  })
})
