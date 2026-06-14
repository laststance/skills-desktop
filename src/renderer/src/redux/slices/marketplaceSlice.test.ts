import { configureStore } from '@reduxjs/toolkit'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { repositoryId } from '@/shared/types'
import type { InstallProgress, SkillSearchResult } from '@/shared/types'

const mockSearch = vi.fn()
const mockInstall = vi.fn()
const mockCancel = vi.fn()
const mockLeaderboard = vi.fn()

vi.stubGlobal('window', {
  electron: {
    skillsCli: {
      search: mockSearch,
      install: mockInstall,
      cancel: mockCancel,
    },
    marketplace: {
      leaderboard: mockLeaderboard,
    },
  },
})

async function createTestStore() {
  const { default: marketplaceReducer } = await import('./marketplaceSlice')
  return configureStore({ reducer: { marketplace: marketplaceReducer } })
}

const sampleResult: SkillSearchResult = {
  rank: 1,
  name: 'task',
  repo: repositoryId('vercel-labs/skill-task'),
  url: 'https://skills.sh/vercel-labs/skill-task',
}

describe('marketplaceSlice', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('opens the Marketplace tab on a clean, idle search panel', async () => {
    // Arrange
    const store = await createTestStore()

    // Act
    const state = store.getState().marketplace

    // Assert
    expect(state.status).toBe('idle')
    expect(state.searchQuery).toBe('')
    expect(state.searchResults).toEqual([])
    expect(state.selectedSkill).toBeNull()
    expect(state.error).toBeNull()
    expect(state.leaderboard).toEqual({})
  })

  // --- Sync reducers ---
  it('reflects what the user typed into the marketplace search box', async () => {
    // Arrange
    const { setMarketplaceSearchQuery } = await import('./marketplaceSlice')
    const store = await createTestStore()

    // Act
    store.dispatch(setMarketplaceSearchQuery('react'))

    // Assert
    expect(store.getState().marketplace.searchQuery).toBe('react')
  })

  it('highlights a skill chosen to install, then deselects it when dismissed', async () => {
    // Arrange
    const { selectSkillForInstall } = await import('./marketplaceSlice')
    const store = await createTestStore()

    // Act + Assert — selecting a skill marks it for install
    store.dispatch(selectSkillForInstall(sampleResult))
    expect(store.getState().marketplace.selectedSkill).toEqual(sampleResult)

    // Act + Assert — passing null dismisses the install selection
    store.dispatch(selectSkillForInstall(null))
    expect(store.getState().marketplace.selectedSkill).toBeNull()
  })

  it('opens a skill in the preview pane, then closes the preview when dismissed', async () => {
    // Arrange
    const { setPreviewSkill } = await import('./marketplaceSlice')
    const store = await createTestStore()

    // Act + Assert — selecting a skill shows its preview
    store.dispatch(setPreviewSkill(sampleResult))
    expect(store.getState().marketplace.previewSkill).toEqual(sampleResult)

    // Act + Assert — passing null closes the preview
    store.dispatch(setPreviewSkill(null))
    expect(store.getState().marketplace.previewSkill).toBeNull()
  })

  it('aborts the in-flight CLI operation and returns the panel to idle when the user cancels', async () => {
    // Arrange
    const { cancelOperation } = await import('./marketplaceSlice')
    const store = await createTestStore()

    // Act
    store.dispatch(cancelOperation())

    // Assert
    expect(mockCancel).toHaveBeenCalled()
    expect(store.getState().marketplace.status).toBe('idle')
  })

  it('dismisses a surfaced error banner and lets the user search again', async () => {
    // Arrange — drive the panel into the error state via a failing search
    const { clearError, searchSkills, setMarketplaceSearchQuery } =
      await import('./marketplaceSlice')
    const store = await createTestStore()
    mockSearch.mockRejectedValue(new Error('fail'))
    store.dispatch(setMarketplaceSearchQuery('test'))
    await store.dispatch(searchSkills('test'))
    expect(store.getState().marketplace.status).toBe('error')

    // Act
    store.dispatch(clearError())

    // Assert
    expect(store.getState().marketplace.error).toBeNull()
    expect(store.getState().marketplace.status).toBe('idle')
  })

  it('empties the results list and the search box when results are cleared', async () => {
    // Arrange
    const { setMarketplaceSearchQuery, clearSearchResults } =
      await import('./marketplaceSlice')
    const store = await createTestStore()
    store.dispatch(setMarketplaceSearchQuery('react'))

    // Act
    store.dispatch(clearSearchResults())

    // Assert
    expect(store.getState().marketplace.searchResults).toEqual([])
    expect(store.getState().marketplace.searchQuery).toBe('')
  })

  it('shows the live install progress reported by the CLI, then clears it', async () => {
    // Arrange
    const { setInstallProgress } = await import('./marketplaceSlice')
    const store = await createTestStore()
    const progress: InstallProgress = {
      phase: 'cloning',
      message: 'Cloning vercel-labs/skill-task',
      percent: 40,
    }

    // Act + Assert — a progress update from the CLI surfaces in the panel
    store.dispatch(setInstallProgress(progress))
    expect(store.getState().marketplace.installProgress).toEqual(progress)

    // Act + Assert — passing null clears the progress indicator
    store.dispatch(setInstallProgress(null))
    expect(store.getState().marketplace.installProgress).toBeNull()
  })

  // --- searchSkills thunk ---
  it('shows a searching spinner state while the search request is in flight', async () => {
    // Arrange — keep the search request pending so the spinner state is observable
    let resolve!: (value: SkillSearchResult[]) => void
    mockSearch.mockReturnValue(
      new Promise<SkillSearchResult[]>((r) => {
        resolve = r
      }),
    )
    const store = await createTestStore()
    const { searchSkills, setMarketplaceSearchQuery } =
      await import('./marketplaceSlice')

    // Act
    store.dispatch(setMarketplaceSearchQuery('react'))
    const promise = store.dispatch(searchSkills('react'))

    // Assert
    expect(store.getState().marketplace.status).toBe('searching')

    resolve([sampleResult])
    await promise
  })

  it('lists the matching skills once the search resolves', async () => {
    // Arrange
    mockSearch.mockResolvedValue([sampleResult])
    const store = await createTestStore()
    const { searchSkills, setMarketplaceSearchQuery } =
      await import('./marketplaceSlice')

    // Act — the box holds the query before its results land (the real flow:
    // MarketplaceSearch commits the query, then dispatches the search).
    store.dispatch(setMarketplaceSearchQuery('task'))
    await store.dispatch(searchSkills('task'))

    // Assert
    const state = store.getState().marketplace
    expect(state.status).toBe('idle')
    expect(state.searchResults).toHaveLength(1)
    expect(state.searchResults[0].name).toBe('task')
  })

  it('surfaces the failure message when a search request errors out', async () => {
    // Arrange
    mockSearch.mockRejectedValue(new Error('API timeout'))
    const store = await createTestStore()
    const { searchSkills, setMarketplaceSearchQuery } =
      await import('./marketplaceSlice')

    // Act
    store.dispatch(setMarketplaceSearchQuery('test'))
    await store.dispatch(searchSkills('test'))

    // Assert
    expect(store.getState().marketplace.status).toBe('error')
    expect(store.getState().marketplace.error).toBe('API timeout')
  })

  it('keeps the latest query results when an earlier search resolves out of order', async () => {
    // Arrange — two searches in flight. "rea" is dispatched first but its
    // response is made to land AFTER "react" resolves, simulating an
    // out-of-order IPC reply (the CLI runs searches concurrently).
    let resolveRea!: (value: SkillSearchResult[]) => void
    let resolveReact!: (value: SkillSearchResult[]) => void
    const reaResult: SkillSearchResult = { ...sampleResult, name: 'rea-hit' }
    const reactResult: SkillSearchResult = {
      ...sampleResult,
      name: 'react-hit',
    }
    mockSearch
      .mockReturnValueOnce(
        new Promise<SkillSearchResult[]>((r) => {
          resolveRea = r
        }),
      )
      .mockReturnValueOnce(
        new Promise<SkillSearchResult[]>((r) => {
          resolveReact = r
        }),
      )
    const store = await createTestStore()
    const { searchSkills, setMarketplaceSearchQuery } =
      await import('./marketplaceSlice')

    // Act — fire "rea", then "react" (the box now holds "react"). Resolve
    // "react" first, then let the stale "rea" response arrive afterwards.
    store.dispatch(setMarketplaceSearchQuery('rea'))
    const reaSearch = store.dispatch(searchSkills('rea'))
    store.dispatch(setMarketplaceSearchQuery('react'))
    const reactSearch = store.dispatch(searchSkills('react'))
    resolveReact([reactResult])
    await reactSearch
    resolveRea([reaResult])
    await reaSearch

    // Assert — the box shows "react", so only its results survive; the late
    // "rea" reply is dropped instead of overwriting them.
    const state = store.getState().marketplace
    expect(state.searchResults).toEqual([reactResult])
    expect(state.status).toBe('idle')
  })

  it('ignores a stale search failure once the query has moved on', async () => {
    // Arrange — "rea" will reject, "react" will succeed; "react" resolves
    // first, then the superseded "rea" rejection lands.
    let rejectRea!: (reason: Error) => void
    let resolveReact!: (value: SkillSearchResult[]) => void
    mockSearch
      .mockReturnValueOnce(
        new Promise<SkillSearchResult[]>((_resolve, reject) => {
          rejectRea = reject
        }),
      )
      .mockReturnValueOnce(
        new Promise<SkillSearchResult[]>((r) => {
          resolveReact = r
        }),
      )
    const store = await createTestStore()
    const { searchSkills, setMarketplaceSearchQuery } =
      await import('./marketplaceSlice')

    // Act
    store.dispatch(setMarketplaceSearchQuery('rea'))
    const reaSearch = store.dispatch(searchSkills('rea'))
    store.dispatch(setMarketplaceSearchQuery('react'))
    const reactSearch = store.dispatch(searchSkills('react'))
    resolveReact([sampleResult])
    await reactSearch
    rejectRea(new Error('rea timed out'))
    await reaSearch

    // Assert — the superseded failure must not raise an error banner over the
    // "react" results the user is actually looking at.
    const state = store.getState().marketplace
    expect(state.error).toBeNull()
    expect(state.status).toBe('idle')
    expect(state.searchResults).toEqual([sampleResult])
  })

  it('discards a search response that lands after the box is cleared', async () => {
    // Arrange — a search is still in flight when the user empties the box.
    let resolveSearch!: (value: SkillSearchResult[]) => void
    mockSearch.mockReturnValue(
      new Promise<SkillSearchResult[]>((r) => {
        resolveSearch = r
      }),
    )
    const store = await createTestStore()
    const { searchSkills, setMarketplaceSearchQuery, clearSearchResults } =
      await import('./marketplaceSlice')

    // Act — fire "react", clear the box, then let the response arrive.
    store.dispatch(setMarketplaceSearchQuery('react'))
    const search = store.dispatch(searchSkills('react'))
    store.dispatch(clearSearchResults())
    resolveSearch([sampleResult])
    await search

    // Assert — the emptied box stays on the leaderboard; the late response
    // does not repopulate stale results behind it.
    const state = store.getState().marketplace
    expect(state.searchQuery).toBe('')
    expect(state.searchResults).toEqual([])
    expect(state.status).toBe('idle')
  })

  it('returns the panel to idle when the box is cleared mid-search', async () => {
    // Arrange — keep a search pending so the panel sits in 'searching'.
    mockSearch.mockReturnValue(new Promise<SkillSearchResult[]>(() => {}))
    const store = await createTestStore()
    const { searchSkills, setMarketplaceSearchQuery, clearSearchResults } =
      await import('./marketplaceSlice')
    store.dispatch(setMarketplaceSearchQuery('react'))
    store.dispatch(searchSkills('react'))
    expect(store.getState().marketplace.status).toBe('searching')

    // Act
    store.dispatch(clearSearchResults())

    // Assert — the input spinner must not outlive the emptied box.
    expect(store.getState().marketplace.status).toBe('idle')
  })

  it('clears a stranded error banner when the box is emptied after a failed search', async () => {
    // Arrange — a search fails, leaving the destructive error banner on screen.
    // The banner renders on `error` (not `status`), so emptying the box must
    // wipe `error` too or the red banner outlives the query over the leaderboard.
    mockSearch.mockRejectedValue(new Error('skills CLI offline'))
    const store = await createTestStore()
    const { searchSkills, setMarketplaceSearchQuery, clearSearchResults } =
      await import('./marketplaceSlice')
    store.dispatch(setMarketplaceSearchQuery('react'))
    await store.dispatch(searchSkills('react'))
    expect(store.getState().marketplace.error).toBe('skills CLI offline')

    // Act — empty the box.
    store.dispatch(clearSearchResults())

    // Assert — no error string survives to render a banner over the leaderboard.
    expect(store.getState().marketplace.error).toBeNull()
    expect(store.getState().marketplace.status).toBe('idle')
  })

  // --- installSkill thunk ---
  it('shows an installing state while the install request is in flight', async () => {
    // Arrange — keep the install request pending so the installing state is observable
    let resolve!: (value: { success: boolean }) => void
    mockInstall.mockReturnValue(
      new Promise((r) => {
        resolve = r
      }),
    )
    const store = await createTestStore()
    const { installSkill } = await import('./marketplaceSlice')

    // Act
    const promise = store.dispatch(
      installSkill({
        repo: repositoryId('vercel-labs/skill-task'),
        global: true,
        agents: [],
      }),
    )

    // Assert
    expect(store.getState().marketplace.status).toBe('installing')

    resolve({ success: true })
    await promise
  })

  it('clears the install selection and returns to idle once the install succeeds', async () => {
    // Arrange
    mockInstall.mockResolvedValue({ success: true })
    const store = await createTestStore()
    const { selectSkillForInstall, installSkill } =
      await import('./marketplaceSlice')
    store.dispatch(selectSkillForInstall(sampleResult))

    // Act
    await store.dispatch(
      installSkill({
        repo: repositoryId('vercel-labs/skill-task'),
        global: true,
        agents: [],
      }),
    )

    // Assert
    expect(store.getState().marketplace.selectedSkill).toBeNull()
    expect(store.getState().marketplace.status).toBe('idle')
  })

  it('surfaces the failure message when an install request errors out', async () => {
    // Arrange
    mockInstall.mockRejectedValue(new Error('Install failed'))
    const store = await createTestStore()
    const { installSkill } = await import('./marketplaceSlice')

    // Act
    await store.dispatch(
      installSkill({
        repo: repositoryId('vercel-labs/skill-task'),
        global: true,
        agents: [],
      }),
    )

    // Assert
    expect(store.getState().marketplace.status).toBe('error')
    expect(store.getState().marketplace.error).toBe('Install failed')
  })

  it('shows an install-failed error when the CLI completes but reports no success', async () => {
    // Arrange — the install promise resolves (no throw) but the CLI reports
    // success:false, e.g. a non-zero exit that the IPC layer swallowed.
    mockInstall.mockResolvedValue({ success: false })
    const store = await createTestStore()
    const { selectSkillForInstall, installSkill } =
      await import('./marketplaceSlice')
    store.dispatch(selectSkillForInstall(sampleResult))

    // Act
    await store.dispatch(
      installSkill({
        repo: repositoryId('vercel-labs/skill-task'),
        global: true,
        agents: [],
      }),
    )

    // Assert — the panel flips to error and keeps the chosen skill selected so
    // the user can retry from the still-open install modal.
    const state = store.getState().marketplace
    expect(state.status).toBe('error')
    expect(state.error).toBe('Installation failed')
    expect(state.selectedSkill).toEqual(sampleResult)
  })

  // --- loadLeaderboard thunk ---
  it('shows a loading leaderboard for a filter that has never been fetched', async () => {
    // Arrange — keep the leaderboard request pending so the loading state is observable
    let resolve!: (value: SkillSearchResult[]) => void
    mockLeaderboard.mockReturnValue(
      new Promise<SkillSearchResult[]>((r) => {
        resolve = r
      }),
    )
    const store = await createTestStore()
    const { loadLeaderboard } = await import('./marketplaceSlice')

    // Act
    const promise = store.dispatch(loadLeaderboard('all-time'))

    // Assert
    const lb = store.getState().marketplace.leaderboard['all-time']
    expect(lb?.status).toBe('loading')
    expect(lb?.skills).toEqual([])

    resolve([sampleResult])
    await promise
  })

  it('caches the fetched leaderboard rows under their filter key once loaded', async () => {
    // Arrange
    mockLeaderboard.mockResolvedValue([sampleResult])
    const store = await createTestStore()
    const { loadLeaderboard } = await import('./marketplaceSlice')

    // Act
    await store.dispatch(loadLeaderboard('trending'))

    // Assert
    const lb = store.getState().marketplace.leaderboard['trending']
    expect(lb?.status).toBe('idle')
    expect(lb?.skills).toHaveLength(1)
    expect(lb?.skills[0].name).toBe('task')
    expect(lb?.lastFetched).toBeGreaterThan(0)
  })

  it('serves a fresh leaderboard from cache instead of refetching the same filter', async () => {
    // Arrange
    mockLeaderboard.mockResolvedValue([sampleResult])
    const store = await createTestStore()
    const { loadLeaderboard } = await import('./marketplaceSlice')

    // Act — first dispatch populates the cache
    await store.dispatch(loadLeaderboard('all-time'))
    expect(mockLeaderboard).toHaveBeenCalledTimes(1)

    // Act — second dispatch is served from the still-fresh cache
    await store.dispatch(loadLeaderboard('all-time'))

    // Assert — no second IPC call was made
    expect(mockLeaderboard).toHaveBeenCalledTimes(1)
  })

  it('keeps each leaderboard filter cached separately so they do not overwrite each other', async () => {
    // Arrange
    const trendingResult: SkillSearchResult = {
      ...sampleResult,
      name: 'trending-skill',
    }
    mockLeaderboard
      .mockResolvedValueOnce([sampleResult])
      .mockResolvedValueOnce([trendingResult])
    const store = await createTestStore()
    const { loadLeaderboard } = await import('./marketplaceSlice')

    // Act
    await store.dispatch(loadLeaderboard('all-time'))
    await store.dispatch(loadLeaderboard('trending'))

    // Assert — each filter key holds its own rows
    const state = store.getState().marketplace
    expect(state.leaderboard['all-time']?.skills[0].name).toBe('task')
    expect(state.leaderboard['trending']?.skills[0].name).toBe('trending-skill')
  })

  it('leaves the last good leaderboard on screen when a stale-cache refetch fails', async () => {
    // Arrange — first fetch populates the cache
    mockLeaderboard.mockResolvedValueOnce([sampleResult])
    const store = await createTestStore()
    const { loadLeaderboard } = await import('./marketplaceSlice')
    await store.dispatch(loadLeaderboard('hot'))
    expect(
      store.getState().marketplace.leaderboard['hot']?.skills,
    ).toHaveLength(1)

    // Advance time past TTL (31 min) to make cache stale
    // Note: useFakeTimers() initializes to current real time, so
    // setSystemTime correctly offsets from the first fetch's timestamp
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 31 * 60 * 1000)

    // Act — the stale-cache refetch fails
    mockLeaderboard.mockRejectedValueOnce(new Error('Network error'))
    await store.dispatch(loadLeaderboard('hot'))

    vi.useRealTimers()

    // Assert — the stale rows remain but the status flips to error
    const state = store.getState().marketplace.leaderboard['hot']
    expect(state?.skills).toHaveLength(1)
    expect(state?.status).toBe('error')
  })

  it('shows an error and no rows when the first-ever leaderboard fetch fails', async () => {
    // Arrange
    mockLeaderboard.mockRejectedValue(new Error('Offline'))
    const store = await createTestStore()
    const { loadLeaderboard } = await import('./marketplaceSlice')

    // Act
    await store.dispatch(loadLeaderboard('all-time'))

    // Assert
    const lb = store.getState().marketplace.leaderboard['all-time']
    expect(lb?.status).toBe('error')
    expect(lb?.error).toBe('Offline')
    expect(lb?.skills).toEqual([])
  })

  it('records an error placeholder for a filter that rejects without ever loading', async () => {
    // Arrange — a rejection lands for a filter that has no cache entry yet.
    // The normal thunk lifecycle runs `pending` first (which seeds an entry),
    // so this stand-alone rejected action models a failure arriving before any
    // pending state existed for the filter.
    const store = await createTestStore()
    const { loadLeaderboard } = await import('./marketplaceSlice')
    expect(store.getState().marketplace.leaderboard['hot']).toBeUndefined()

    // Act — dispatch the rejected action directly with 'hot' as its meta.arg.
    store.dispatch(
      loadLeaderboard.rejected(new Error('DNS failure'), 'req-1', 'hot'),
    )

    // Assert — a fresh error entry is created with empty rows and the message.
    const lb = store.getState().marketplace.leaderboard['hot']
    expect(lb?.status).toBe('error')
    expect(lb?.error).toBe('DNS failure')
    expect(lb?.skills).toEqual([])
    expect(lb?.lastFetched).toBe(0)
  })

  it('loadLeaderboard fires a single fetch when two mounts request the same filter at once', async () => {
    // Arrange: keep the first request in flight so the second sees it pending
    let resolve!: (value: SkillSearchResult[]) => void
    mockLeaderboard.mockReturnValue(
      new Promise<SkillSearchResult[]>((r) => {
        resolve = r
      }),
    )
    const store = await createTestStore()
    const { loadLeaderboard } = await import('./marketplaceSlice')

    // Act: two widgets (e.g. Trending + What's New) dispatch the same filter
    const first = store.dispatch(loadLeaderboard('trending'))
    const second = store.dispatch(loadLeaderboard('trending'))

    // Assert: the second is short-circuited by `condition` — only one IPC call
    expect(mockLeaderboard).toHaveBeenCalledTimes(1)

    resolve([sampleResult])
    await Promise.all([first, second])
  })

  it('loadLeaderboard keeps already-loaded skills visible while refreshing', async () => {
    // Arrange: first fetch populates the cache
    mockLeaderboard.mockResolvedValueOnce([sampleResult])
    const store = await createTestStore()
    const { loadLeaderboard } = await import('./marketplaceSlice')
    await store.dispatch(loadLeaderboard('trending'))

    // Expire the cache so the next dispatch actually refetches.
    // try/finally guarantees real timers are restored even if an assertion
    // throws — otherwise fake timers would leak into the next test.
    vi.useFakeTimers()
    try {
      vi.setSystemTime(Date.now() + 31 * 60 * 1000)

      // Act: a refresh starts but has not resolved yet
      let resolve!: (value: SkillSearchResult[]) => void
      mockLeaderboard.mockReturnValueOnce(
        new Promise<SkillSearchResult[]>((r) => {
          resolve = r
        }),
      )
      const refresh = store.dispatch(loadLeaderboard('trending'))

      // Assert: status is loading, but the stale skill is still on screen
      const lb = store.getState().marketplace.leaderboard['trending']
      expect(lb?.status).toBe('loading')
      expect(lb?.skills).toHaveLength(1)

      resolve([sampleResult])
      await refresh
    } finally {
      vi.useRealTimers()
    }
  })
})
