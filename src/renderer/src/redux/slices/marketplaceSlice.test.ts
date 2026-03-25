import { configureStore } from '@reduxjs/toolkit'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SkillSearchResult } from '../../../../shared/types'

const mockSearch = vi.fn()
const mockInstall = vi.fn()
const mockRemove = vi.fn()
const mockCancel = vi.fn()

vi.stubGlobal('window', {
  electron: {
    skillsCli: {
      search: mockSearch,
      install: mockInstall,
      remove: mockRemove,
      cancel: mockCancel,
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
  repo: 'vercel-labs/skill-task',
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

  it('setSkillToRemove sets and clears pending removal', async () => {
    const { setSkillToRemove } = await import('./marketplaceSlice')
    const store = await createTestStore()
    store.dispatch(setSkillToRemove('task'))
    expect(store.getState().marketplace.skillToRemove).toBe('task')

    store.dispatch(setSkillToRemove(null))
    expect(store.getState().marketplace.skillToRemove).toBeNull()
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
        repo: 'vercel-labs/skill-task',
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
        repo: 'vercel-labs/skill-task',
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
        repo: 'vercel-labs/skill-task',
        global: true,
        agents: [],
      }),
    )

    expect(store.getState().marketplace.status).toBe('error')
    expect(store.getState().marketplace.error).toBe('Install failed')
  })

  // --- removeSkill thunk ---
  it('removeSkill sets removing during pending', async () => {
    let resolve!: (value: { success: boolean }) => void
    mockRemove.mockReturnValue(
      new Promise((r) => {
        resolve = r
      }),
    )

    const store = await createTestStore()
    const { removeSkill } = await import('./marketplaceSlice')
    const promise = store.dispatch(removeSkill('task'))

    expect(store.getState().marketplace.status).toBe('removing')

    resolve({ success: true })
    await promise
  })

  it('removeSkill clears skillToRemove on fulfilled', async () => {
    mockRemove.mockResolvedValue({ success: true })

    const store = await createTestStore()
    const { setSkillToRemove, removeSkill } = await import('./marketplaceSlice')
    store.dispatch(setSkillToRemove('task'))
    await store.dispatch(removeSkill('task'))

    expect(store.getState().marketplace.skillToRemove).toBeNull()
    expect(store.getState().marketplace.status).toBe('idle')
  })

  it('removeSkill sets error on rejected', async () => {
    mockRemove.mockRejectedValue(new Error('Not found'))

    const store = await createTestStore()
    const { removeSkill } = await import('./marketplaceSlice')
    await store.dispatch(removeSkill('task'))

    expect(store.getState().marketplace.status).toBe('error')
    expect(store.getState().marketplace.error).toBe('Not found')
  })
})
