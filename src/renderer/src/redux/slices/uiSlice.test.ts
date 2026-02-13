import { configureStore } from '@reduxjs/toolkit'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SyncPreviewResult } from '../../../../shared/types'

// Stub window.electron before importing the slice (thunks reference it at call time)
const mockSyncPreview = vi.fn()
const mockSyncExecute = vi.fn()
const mockGetStats = vi.fn()

vi.stubGlobal('window', {
  electron: {
    sync: {
      preview: mockSyncPreview,
      execute: mockSyncExecute,
    },
    source: {
      getStats: mockGetStats,
    },
  },
})

/**
 * Create a minimal Redux store with only the ui reducer.
 * Avoids storage middleware and listener middleware used in production.
 * @returns Test store instance
 */
async function createTestStore() {
  const { default: uiReducer } = await import('./uiSlice')
  return configureStore({
    reducer: { ui: uiReducer },
  })
}

/** Sample preview result with conflicts for testing */
const previewWithConflicts: SyncPreviewResult = {
  totalSkills: 5,
  totalAgents: 2,
  toCreate: 3,
  alreadySynced: 4,
  conflicts: [
    {
      skillName: 'agent-browser',
      agentId: 'cursor' as SyncPreviewResult['conflicts'][0]['agentId'],
      agentName: 'Cursor' as SyncPreviewResult['conflicts'][0]['agentName'],
      agentSkillPath: '/home/user/.cursor/skills/agent-browser',
    },
  ],
}

/** Sample preview result without conflicts */
const previewNoConflicts: SyncPreviewResult = {
  totalSkills: 3,
  totalAgents: 2,
  toCreate: 6,
  alreadySynced: 0,
  conflicts: [],
}

describe('uiSlice sync thunks', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('sets isSyncing=false when preview has conflicts (regression for disabled buttons bug)', async () => {
    mockSyncPreview.mockResolvedValue(previewWithConflicts)

    const store = await createTestStore()
    const { fetchSyncPreview } = await import('./uiSlice')
    await store.dispatch(fetchSyncPreview())

    const state = store.getState().ui
    expect(state.isSyncing).toBe(false)
    expect(state.syncPreview).not.toBeNull()
    expect(state.syncPreview!.conflicts).toHaveLength(1)
  })

  it('sets isSyncing=true during pending state', async () => {
    // Create a promise we control to keep the thunk pending
    let resolve!: (value: SyncPreviewResult) => void
    mockSyncPreview.mockReturnValue(
      new Promise<SyncPreviewResult>((r) => {
        resolve = r
      }),
    )

    const store = await createTestStore()
    const { fetchSyncPreview } = await import('./uiSlice')
    const promise = store.dispatch(fetchSyncPreview())

    // While pending, isSyncing should be true
    expect(store.getState().ui.isSyncing).toBe(true)

    // Resolve to clean up
    resolve(previewNoConflicts)
    await promise
  })

  it('sets isSyncing=false when preview is rejected', async () => {
    mockSyncPreview.mockRejectedValue(new Error('Network error'))

    const store = await createTestStore()
    const { fetchSyncPreview } = await import('./uiSlice')
    await store.dispatch(fetchSyncPreview())

    expect(store.getState().ui.isSyncing).toBe(false)
    expect(store.getState().ui.syncPreview).toBeNull()
  })

  it('populates syncPreview on fulfillment', async () => {
    mockSyncPreview.mockResolvedValue(previewNoConflicts)

    const store = await createTestStore()
    const { fetchSyncPreview } = await import('./uiSlice')
    await store.dispatch(fetchSyncPreview())

    const state = store.getState().ui
    expect(state.syncPreview).toEqual(previewNoConflicts)
    expect(state.isSyncing).toBe(false)
  })

  it('clears syncPreview and isSyncing on executeSyncAction fulfilled', async () => {
    mockSyncPreview.mockResolvedValue(previewWithConflicts)
    mockSyncExecute.mockResolvedValue({
      success: true,
      created: 3,
      replaced: 1,
      errors: [],
    })

    const store = await createTestStore()
    const { fetchSyncPreview, executeSyncAction } = await import('./uiSlice')

    // First: load preview
    await store.dispatch(fetchSyncPreview())
    expect(store.getState().ui.syncPreview).not.toBeNull()

    // Then: execute sync
    await store.dispatch(
      executeSyncAction({
        replaceConflicts: ['/home/user/.cursor/skills/agent-browser'],
      }),
    )

    const state = store.getState().ui
    expect(state.syncPreview).toBeNull()
    expect(state.isSyncing).toBe(false)
  })

  it('resets isSyncing on executeSyncAction rejected', async () => {
    mockSyncExecute.mockRejectedValue(new Error('Permission denied'))

    const store = await createTestStore()
    const { executeSyncAction } = await import('./uiSlice')
    await store.dispatch(executeSyncAction({ replaceConflicts: [] }))

    expect(store.getState().ui.isSyncing).toBe(false)
  })

  it('clears syncPreview via setSyncPreview(null)', async () => {
    mockSyncPreview.mockResolvedValue(previewWithConflicts)

    const store = await createTestStore()
    const { fetchSyncPreview, setSyncPreview } = await import('./uiSlice')

    await store.dispatch(fetchSyncPreview())
    expect(store.getState().ui.syncPreview).not.toBeNull()

    store.dispatch(setSyncPreview(null))
    expect(store.getState().ui.syncPreview).toBeNull()
  })
})
