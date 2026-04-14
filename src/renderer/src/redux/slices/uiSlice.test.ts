import { configureStore } from '@reduxjs/toolkit'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  SyncExecuteResult,
  SyncPreviewResult,
} from '../../../../shared/types'

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
      skipped: 4,
      errors: [],
      details: [
        { skillName: 'skill-a', agentName: 'Claude Code', action: 'created' },
      ],
    } satisfies SyncExecuteResult)

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
    // syncResult populated for SyncResultDialog
    expect(state.syncResult).not.toBeNull()
    expect(state.syncResult!.created).toBe(3)
    expect(state.syncResult!.details).toHaveLength(1)
  })

  it('sets syncResult to null on executeSyncAction rejected', async () => {
    mockSyncExecute.mockRejectedValue(new Error('Permission denied'))

    const store = await createTestStore()
    const { executeSyncAction } = await import('./uiSlice')
    await store.dispatch(executeSyncAction({ replaceConflicts: [] }))

    expect(store.getState().ui.isSyncing).toBe(false)
    expect(store.getState().ui.syncResult).toBeNull()
  })

  it('clears syncResult via clearSyncResult action', async () => {
    mockSyncExecute.mockResolvedValue({
      success: true,
      created: 1,
      replaced: 0,
      skipped: 0,
      errors: [],
      details: [{ skillName: 's', agentName: 'a', action: 'created' }],
    } satisfies SyncExecuteResult)

    const store = await createTestStore()
    const { executeSyncAction, clearSyncResult } = await import('./uiSlice')

    await store.dispatch(executeSyncAction({ replaceConflicts: [] }))
    expect(store.getState().ui.syncResult).not.toBeNull()

    store.dispatch(clearSyncResult())
    expect(store.getState().ui.syncResult).toBeNull()
  })

  it('clears syncResult when fetchSyncPreview.pending fires (prevents overlapping dialogs)', async () => {
    // First: populate syncResult via a completed sync
    mockSyncExecute.mockResolvedValue({
      success: true,
      created: 1,
      replaced: 0,
      skipped: 0,
      errors: [],
      details: [{ skillName: 's', agentName: 'a', action: 'created' }],
    } satisfies SyncExecuteResult)

    const store = await createTestStore()
    const { executeSyncAction, fetchSyncPreview } = await import('./uiSlice')

    await store.dispatch(executeSyncAction({ replaceConflicts: [] }))
    expect(store.getState().ui.syncResult).not.toBeNull()

    // Now: start a new preview. Pending should clear the old result.
    let resolve!: (value: SyncPreviewResult) => void
    mockSyncPreview.mockReturnValue(
      new Promise<SyncPreviewResult>((r) => {
        resolve = r
      }),
    )
    const promise = store.dispatch(fetchSyncPreview())

    // While pending, syncResult should already be cleared
    expect(store.getState().ui.syncResult).toBeNull()

    resolve(previewNoConflicts)
    await promise
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

describe('uiSlice bookmark detail modal', () => {
  const sampleBookmark = {
    name: 'task',
    repo: 'vercel-labs/skills',
    url: 'https://github.com/vercel-labs/skills',
    bookmarkedAt: '2026-04-01T08:00:00.000Z',
    isInstalled: false,
  }

  it('sets selectedBookmarkForDetail', async () => {
    const store = await createTestStore()
    const { setSelectedBookmarkForDetail } = await import('./uiSlice')

    store.dispatch(setSelectedBookmarkForDetail(sampleBookmark))

    expect(store.getState().ui.selectedBookmarkForDetail).toEqual(
      sampleBookmark,
    )
  })

  it('clears selectedBookmarkForDetail', async () => {
    const store = await createTestStore()
    const { setSelectedBookmarkForDetail, clearSelectedBookmarkForDetail } =
      await import('./uiSlice')

    store.dispatch(setSelectedBookmarkForDetail(sampleBookmark))
    expect(store.getState().ui.selectedBookmarkForDetail).not.toBeNull()

    store.dispatch(clearSelectedBookmarkForDetail())
    expect(store.getState().ui.selectedBookmarkForDetail).toBeNull()
  })

  it('starts with null selectedBookmarkForDetail', async () => {
    const store = await createTestStore()
    expect(store.getState().ui.selectedBookmarkForDetail).toBeNull()
  })
})
