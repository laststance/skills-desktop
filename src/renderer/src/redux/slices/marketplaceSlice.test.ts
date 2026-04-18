import { configureStore } from '@reduxjs/toolkit'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { repositoryId } from '../../../../shared/types'
import type { SkillSearchResult } from '../../../../shared/types'

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

  it('has correct initial state', async () => {
    const store = await createTestStore()
    const state = store.getState().marketplace
    expect(state.status).toBe('idle')
    expect(state.searchQuery).toBe('')
    expect(state.searchResults).toEqual([])
    expect(state.selectedSkill).toBeNull()
    expect(state.error).toBeNull()
    expect(state.leaderboard).toEqual({})
  })

  // --- Sync reducers ---
  it('setSearchQuery updates query', async () => {
    const { setSearchQuery } = await import('./marketplaceSlice')
    const store = await createTestStore()
    store.dispatch(setSearchQuery('react'))
    expect(store.getState().marketplace.searchQuery).toBe('react')
  })

  it('selectSkillForInstall sets and clears selection', async () => {
    const { selectSkillForInstall } = await import('./marketplaceSlice')
    const store = await createTestStore()
    store.dispatch(selectSkillForInstall(sampleResult))
    expect(store.getState().marketplace.selectedSkill).toEqual(sampleResult)

    store.dispatch(selectSkillForInstall(null))
    expect(store.getState().marketplace.selectedSkill).toBeNull()
  })

  it('cancelOperation calls IPC cancel and resets state', async () => {
    const { cancelOperation } = await import('./marketplaceSlice')
    const store = await createTestStore()
    store.dispatch(cancelOperation())
    expect(mockCancel).toHaveBeenCalled()
    expect(store.getState().marketplace.status).toBe('idle')
  })

  it('clearError resets error and status', async () => {
    const { clearError } = await import('./marketplaceSlice')
    const store = await createTestStore()
    // Simulate error state by searching then failing
    mockSearch.mockRejectedValue(new Error('fail'))
    const { searchSkills } = await import('./marketplaceSlice')
    await store.dispatch(searchSkills('test'))
    expect(store.getState().marketplace.status).toBe('error')

    store.dispatch(clearError())
    expect(store.getState().marketplace.error).toBeNull()
    expect(store.getState().marketplace.status).toBe('idle')
  })

  it('clearSearchResults empties results and query', async () => {
    const { setSearchQuery, clearSearchResults } =
      await import('./marketplaceSlice')
    const store = await createTestStore()
    store.dispatch(setSearchQuery('react'))
    store.dispatch(clearSearchResults())

    expect(store.getState().marketplace.searchResults).toEqual([])
    expect(store.getState().marketplace.searchQuery).toBe('')
  })

  // --- searchSkills thunk ---
  it('searchSkills sets searching during pending', async () => {
    let resolve!: (value: SkillSearchResult[]) => void
    mockSearch.mockReturnValue(
      new Promise<SkillSearchResult[]>((r) => {
        resolve = r
      }),
    )

    const store = await createTestStore()
    const { searchSkills } = await import('./marketplaceSlice')
    const promise = store.dispatch(searchSkills('react'))

    expect(store.getState().marketplace.status).toBe('searching')

    resolve([sampleResult])
    await promise
  })

  it('searchSkills populates results on fulfilled', async () => {
    mockSearch.mockResolvedValue([sampleResult])

    const store = await createTestStore()
    const { searchSkills } = await import('./marketplaceSlice')
    await store.dispatch(searchSkills('task'))

    const state = store.getState().marketplace
    expect(state.status).toBe('idle')
    expect(state.searchResults).toHaveLength(1)
    expect(state.searchResults[0].name).toBe('task')
  })

  it('searchSkills sets error on rejected', async () => {
    mockSearch.mockRejectedValue(new Error('API timeout'))

    const store = await createTestStore()
    const { searchSkills } = await import('./marketplaceSlice')
    await store.dispatch(searchSkills('test'))

    expect(store.getState().marketplace.status).toBe('error')
    expect(store.getState().marketplace.error).toBe('API timeout')
  })

  // --- installSkill thunk ---
  it('installSkill sets installing during pending', async () => {
    let resolve!: (value: { success: boolean }) => void
    mockInstall.mockReturnValue(
      new Promise((r) => {
        resolve = r
      }),
    )

    const store = await createTestStore()
    const { installSkill } = await import('./marketplaceSlice')
    const promise = store.dispatch(
      installSkill({
        repo: repositoryId('vercel-labs/skill-task'),
        global: true,
        agents: [],
      }),
    )

    expect(store.getState().marketplace.status).toBe('installing')

    resolve({ success: true })
    await promise
  })

  it('installSkill clears selection on fulfilled', async () => {
    mockInstall.mockResolvedValue({ success: true })

    const store = await createTestStore()
    const { selectSkillForInstall, installSkill } =
      await import('./marketplaceSlice')
    store.dispatch(selectSkillForInstall(sampleResult))
    await store.dispatch(
      installSkill({
        repo: repositoryId('vercel-labs/skill-task'),
        global: true,
        agents: [],
      }),
    )

    expect(store.getState().marketplace.selectedSkill).toBeNull()
    expect(store.getState().marketplace.status).toBe('idle')
  })

  it('installSkill sets error on rejected', async () => {
    mockInstall.mockRejectedValue(new Error('Install failed'))

    const store = await createTestStore()
    const { installSkill } = await import('./marketplaceSlice')
    await store.dispatch(
      installSkill({
        repo: repositoryId('vercel-labs/skill-task'),
        global: true,
        agents: [],
      }),
    )

    expect(store.getState().marketplace.status).toBe('error')
    expect(store.getState().marketplace.error).toBe('Install failed')
  })

  // --- loadLeaderboard thunk ---
  it('loadLeaderboard sets loading state for new filter', async () => {
    let resolve!: (value: SkillSearchResult[]) => void
    mockLeaderboard.mockReturnValue(
      new Promise<SkillSearchResult[]>((r) => {
        resolve = r
      }),
    )

    const store = await createTestStore()
    const { loadLeaderboard } = await import('./marketplaceSlice')
    const promise = store.dispatch(loadLeaderboard('all-time'))

    const lb = store.getState().marketplace.leaderboard['all-time']
    expect(lb?.status).toBe('loading')
    expect(lb?.skills).toEqual([])

    resolve([sampleResult])
    await promise
  })

  it('loadLeaderboard populates per-filter cache on fulfilled', async () => {
    mockLeaderboard.mockResolvedValue([sampleResult])

    const store = await createTestStore()
    const { loadLeaderboard } = await import('./marketplaceSlice')
    await store.dispatch(loadLeaderboard('trending'))

    const lb = store.getState().marketplace.leaderboard['trending']
    expect(lb?.status).toBe('idle')
    expect(lb?.skills).toHaveLength(1)
    expect(lb?.skills[0].name).toBe('task')
    expect(lb?.lastFetched).toBeGreaterThan(0)
  })

  it('loadLeaderboard skips fetch when cache is fresh', async () => {
    mockLeaderboard.mockResolvedValue([sampleResult])

    const store = await createTestStore()
    const { loadLeaderboard } = await import('./marketplaceSlice')

    // First fetch populates cache
    await store.dispatch(loadLeaderboard('all-time'))
    expect(mockLeaderboard).toHaveBeenCalledTimes(1)

    // Second fetch skips (cache is fresh)
    await store.dispatch(loadLeaderboard('all-time'))
    expect(mockLeaderboard).toHaveBeenCalledTimes(1)
  })

  it('loadLeaderboard stores different data per filter', async () => {
    const trendingResult: SkillSearchResult = {
      ...sampleResult,
      name: 'trending-skill',
    }
    mockLeaderboard
      .mockResolvedValueOnce([sampleResult])
      .mockResolvedValueOnce([trendingResult])

    const store = await createTestStore()
    const { loadLeaderboard } = await import('./marketplaceSlice')

    await store.dispatch(loadLeaderboard('all-time'))
    await store.dispatch(loadLeaderboard('trending'))

    const state = store.getState().marketplace
    expect(state.leaderboard['all-time']?.skills[0].name).toBe('task')
    expect(state.leaderboard['trending']?.skills[0].name).toBe('trending-skill')
  })

  it('loadLeaderboard keeps stale data on error', async () => {
    mockLeaderboard.mockResolvedValueOnce([sampleResult])

    const store = await createTestStore()
    const { loadLeaderboard } = await import('./marketplaceSlice')

    // First fetch succeeds
    await store.dispatch(loadLeaderboard('hot'))
    expect(
      store.getState().marketplace.leaderboard['hot']?.skills,
    ).toHaveLength(1)

    // Advance time past TTL (31 min) to make cache stale
    // Note: useFakeTimers() initializes to current real time, so
    // setSystemTime correctly offsets from the first fetch's timestamp
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 31 * 60 * 1000)

    // Second fetch fails
    mockLeaderboard.mockRejectedValueOnce(new Error('Network error'))
    await store.dispatch(loadLeaderboard('hot'))

    vi.useRealTimers()

    // Should still have the stale data but status is error
    const state = store.getState().marketplace.leaderboard['hot']
    expect(state?.skills).toHaveLength(1)
    expect(state?.status).toBe('error')
  })

  it('loadLeaderboard sets error when no cache exists', async () => {
    mockLeaderboard.mockRejectedValue(new Error('Offline'))

    const store = await createTestStore()
    const { loadLeaderboard } = await import('./marketplaceSlice')
    await store.dispatch(loadLeaderboard('all-time'))

    const lb = store.getState().marketplace.leaderboard['all-time']
    expect(lb?.status).toBe('error')
    expect(lb?.error).toBe('Offline')
    expect(lb?.skills).toEqual([])
  })
})
