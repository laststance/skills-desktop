import { configureStore } from '@reduxjs/toolkit'
import type { UnknownAction } from '@reduxjs/toolkit'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  AgentId,
  BulkDeleteResult,
  BulkUnlinkResult,
  SyncExecuteResult,
  SyncPreviewResult,
  TombstoneId,
} from '../../../../shared/types'
import { repositoryId, tombstoneId } from '../../../../shared/types'

// Stub window.electron before importing the slice (thunks reference it at call time)
const mockSyncPreview = vi.fn()
const mockSyncExecute = vi.fn()
const mockGetStats = vi.fn()
const mockGetAll = vi.fn()
const mockDeleteSkills = vi.fn()
const mockUnlinkManyFromAgent = vi.fn()

vi.stubGlobal('window', {
  electron: {
    sync: {
      preview: mockSyncPreview,
      execute: mockSyncExecute,
    },
    source: {
      getStats: mockGetStats,
    },
    skills: {
      getAll: mockGetAll,
      deleteSkills: mockDeleteSkills,
      unlinkManyFromAgent: mockUnlinkManyFromAgent,
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

/**
 * Create a combined store with both ui and skills slices. Used for tests that
 * verify cross-slice clearing (e.g. a skills thunk clearing an ui.undoToast).
 */
async function createCombinedStore() {
  const { default: uiReducer } = await import('./uiSlice')
  const { default: skillsReducer } = await import('./skillsSlice')
  return configureStore({
    reducer: { ui: uiReducer, skills: skillsReducer },
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

describe('uiSlice activeTab', () => {
  it('starts with activeTab=installed', async () => {
    const store = await createTestStore()
    expect(store.getState().ui.activeTab).toBe('installed')
  })

  it('setActiveTab switches tab value', async () => {
    const store = await createTestStore()
    const { setActiveTab } = await import('./uiSlice')
    store.dispatch(setActiveTab('marketplace'))
    expect(store.getState().ui.activeTab).toBe('marketplace')
  })
})

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
      details: [
        { skillName: 's', agentName: 'Claude Code', action: 'created' },
      ],
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
      details: [
        { skillName: 's', agentName: 'Claude Code', action: 'created' },
      ],
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
    repo: repositoryId('vercel-labs/skills'),
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

describe('uiSlice undoToast (v2.4 bulk delete)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  /** Build a minimal undoToast payload */
  const makeToast = (kind: 'delete' | 'unlink' = 'delete') => ({
    id: 'toast-1',
    kind,
    skillNames: ['task', 'browser'],
    tombstoneIds:
      kind === 'delete'
        ? [tombstoneId('1-task-aaaaaaaa'), tombstoneId('1-browser-bbbbbbbb')]
        : ([] as TombstoneId[]),
    expiresAt: '2026-04-17T12:00:15.000Z',
    summary:
      kind === 'delete'
        ? 'Deleted 2 skills. 4 symlinks removed.'
        : 'Unlinked 2 skills from Cursor.',
  })

  it('starts with undoToast=null', async () => {
    const store = await createTestStore()
    expect(store.getState().ui.undoToast).toBeNull()
  })

  it('setUndoToast populates the state', async () => {
    const store = await createTestStore()
    const { setUndoToast } = await import('./uiSlice')

    const toast = makeToast('delete')
    store.dispatch(setUndoToast(toast))

    expect(store.getState().ui.undoToast).toEqual(toast)
  })

  it('clearUndoToast resets to null', async () => {
    const store = await createTestStore()
    const { setUndoToast, clearUndoToast } = await import('./uiSlice')

    store.dispatch(setUndoToast(makeToast()))
    expect(store.getState().ui.undoToast).not.toBeNull()

    store.dispatch(clearUndoToast())
    expect(store.getState().ui.undoToast).toBeNull()
  })

  it('selectAgent clears an active undoToast (context switch invalidates it)', async () => {
    const store = await createTestStore()
    const { setUndoToast, selectAgent } = await import('./uiSlice')

    store.dispatch(setUndoToast(makeToast()))
    expect(store.getState().ui.undoToast).not.toBeNull()

    store.dispatch(selectAgent('cursor' as AgentId))
    expect(store.getState().ui.undoToast).toBeNull()
  })

  it('setActiveTab clears an active undoToast (tab switch invalidates it)', async () => {
    const store = await createTestStore()
    const { setUndoToast, setActiveTab } = await import('./uiSlice')

    store.dispatch(setUndoToast(makeToast()))
    store.dispatch(setActiveTab('marketplace'))

    expect(store.getState().ui.undoToast).toBeNull()
  })

  it('fetchSyncPreview.pending clears undoToast', async () => {
    const store = await createTestStore()
    const { setUndoToast, fetchSyncPreview } = await import('./uiSlice')

    store.dispatch(setUndoToast(makeToast()))

    // Keep preview pending so .pending is the only case that runs.
    let resolve!: (value: SyncPreviewResult) => void
    mockSyncPreview.mockReturnValue(
      new Promise<SyncPreviewResult>((r) => {
        resolve = r
      }),
    )
    const promise = store.dispatch(fetchSyncPreview())

    expect(store.getState().ui.undoToast).toBeNull()

    resolve(previewNoConflicts)
    await promise
  })

  it('deleteSelectedSkills.pending clears undoToast (combined store)', async () => {
    const store = await createCombinedStore()
    const { setUndoToast } = await import('./uiSlice')
    const { deleteSelectedSkills } = await import('./skillsSlice')

    store.dispatch(setUndoToast(makeToast()))
    expect(store.getState().ui.undoToast).not.toBeNull()

    // Hold pending so we observe the state during the .pending phase
    let resolve!: (value: BulkDeleteResult) => void
    mockDeleteSkills.mockReturnValue(
      new Promise<BulkDeleteResult>((r) => {
        resolve = r
      }),
    )
    const promise = store.dispatch(deleteSelectedSkills(['task']))

    expect(store.getState().ui.undoToast).toBeNull()

    resolve({ items: [] })
    await promise
  })

  it('unlinkSelectedFromAgent.pending clears undoToast (combined store)', async () => {
    const store = await createCombinedStore()
    const { setUndoToast } = await import('./uiSlice')
    const { unlinkSelectedFromAgent } = await import('./skillsSlice')

    store.dispatch(setUndoToast(makeToast('unlink')))
    expect(store.getState().ui.undoToast).not.toBeNull()

    let resolve!: (value: BulkUnlinkResult) => void
    mockUnlinkManyFromAgent.mockReturnValue(
      new Promise<BulkUnlinkResult>((r) => {
        resolve = r
      }),
    )
    const promise = store.dispatch(
      unlinkSelectedFromAgent({
        agentId: 'cursor' as AgentId,
        selectedNames: ['task'],
      }),
    )

    expect(store.getState().ui.undoToast).toBeNull()

    resolve({ items: [] })
    await promise
  })
})

describe('uiSlice bulkSelectMode', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('starts with bulkSelectMode=false (default is clean list)', async () => {
    const store = await createTestStore()
    expect(store.getState().ui.bulkSelectMode).toBe(false)
  })

  it('enterBulkSelectMode flips the flag to true', async () => {
    const store = await createTestStore()
    const { enterBulkSelectMode } = await import('./uiSlice')

    store.dispatch(enterBulkSelectMode())
    expect(store.getState().ui.bulkSelectMode).toBe(true)
  })

  it('exitBulkSelectMode flips the flag back to false', async () => {
    const store = await createTestStore()
    const { enterBulkSelectMode, exitBulkSelectMode } =
      await import('./uiSlice')

    store.dispatch(enterBulkSelectMode())
    store.dispatch(exitBulkSelectMode())
    expect(store.getState().ui.bulkSelectMode).toBe(false)
  })

  it('setActiveTab clears bulkSelectMode (tab switch exits mode)', async () => {
    const store = await createTestStore()
    const { enterBulkSelectMode, setActiveTab } = await import('./uiSlice')

    store.dispatch(enterBulkSelectMode())
    expect(store.getState().ui.bulkSelectMode).toBe(true)

    store.dispatch(setActiveTab('marketplace'))
    expect(store.getState().ui.bulkSelectMode).toBe(false)
  })

  it('selectAgent clears bulkSelectMode (agent swap exits mode)', async () => {
    const store = await createTestStore()
    const { enterBulkSelectMode, selectAgent } = await import('./uiSlice')

    store.dispatch(enterBulkSelectMode())
    store.dispatch(selectAgent('cursor' as AgentId))
    expect(store.getState().ui.bulkSelectMode).toBe(false)
  })

  it('fetchSyncPreview.pending clears bulkSelectMode', async () => {
    const store = await createTestStore()
    const { enterBulkSelectMode, fetchSyncPreview } = await import('./uiSlice')

    store.dispatch(enterBulkSelectMode())

    let resolve!: (value: SyncPreviewResult) => void
    mockSyncPreview.mockReturnValue(
      new Promise<SyncPreviewResult>((r) => {
        resolve = r
      }),
    )
    const promise = store.dispatch(fetchSyncPreview())

    expect(store.getState().ui.bulkSelectMode).toBe(false)

    resolve(previewNoConflicts)
    await promise
  })

  it('deleteSelectedSkills.pending clears bulkSelectMode (combined store)', async () => {
    const store = await createCombinedStore()
    const { enterBulkSelectMode } = await import('./uiSlice')
    const { deleteSelectedSkills } = await import('./skillsSlice')

    store.dispatch(enterBulkSelectMode())

    let resolve!: (value: BulkDeleteResult) => void
    mockDeleteSkills.mockReturnValue(
      new Promise<BulkDeleteResult>((r) => {
        resolve = r
      }),
    )
    const promise = store.dispatch(deleteSelectedSkills(['task']))

    expect(store.getState().ui.bulkSelectMode).toBe(false)

    resolve({ items: [] })
    await promise
  })

  it('unlinkSelectedFromAgent.pending clears bulkSelectMode (combined store)', async () => {
    const store = await createCombinedStore()
    const { enterBulkSelectMode } = await import('./uiSlice')
    const { unlinkSelectedFromAgent } = await import('./skillsSlice')

    store.dispatch(enterBulkSelectMode())

    let resolve!: (value: BulkUnlinkResult) => void
    mockUnlinkManyFromAgent.mockReturnValue(
      new Promise<BulkUnlinkResult>((r) => {
        resolve = r
      }),
    )
    const promise = store.dispatch(
      unlinkSelectedFromAgent({
        agentId: 'cursor' as AgentId,
        selectedNames: ['task'],
      }),
    )

    expect(store.getState().ui.bulkSelectMode).toBe(false)

    resolve({ items: [] })
    await promise
  })

  // ── Idempotency ───────────────────────────────────────────────────────
  // Guards against a future refactor splitting the reducer into conditional
  // branches; if "already-true enter" started side-effecting, toggling rapidly
  // could wipe unrelated state. The invariant is a plain boolean assignment.

  it('enterBulkSelectMode is idempotent when already true', async () => {
    const store = await createTestStore()
    const { enterBulkSelectMode } = await import('./uiSlice')

    store.dispatch(enterBulkSelectMode())
    store.dispatch(enterBulkSelectMode())
    expect(store.getState().ui.bulkSelectMode).toBe(true)
  })

  it('exitBulkSelectMode is idempotent when already false', async () => {
    const store = await createTestStore()
    const { exitBulkSelectMode } = await import('./uiSlice')

    store.dispatch(exitBulkSelectMode())
    store.dispatch(exitBulkSelectMode())
    expect(store.getState().ui.bulkSelectMode).toBe(false)
  })
})

/**
 * Atomic-clear contract: every context-switch action that clears
 * `bulkSelectMode` MUST also clear `undoToast` + `bulkConfirm` in the same
 * reducer tick. These tests assert the *full* invariant (not individual
 * flags) so a future refactor that drops one co-clear fails CI instead of
 * regressing the hidden-selection anti-pattern in production.
 */
describe('uiSlice atomic-clear contract on context switch', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  /**
   * Pre-populate all three ephemeral flags so each test can assert co-clear.
   * Narrowed to `{ dispatch }` so both the ui-only and combined stores satisfy
   * the signature — the helper never reads state, just seeds it.
   */
  async function seedAllEphemeralState(store: {
    dispatch: (action: UnknownAction) => unknown
  }): Promise<void> {
    const { enterBulkSelectMode, setUndoToast, setBulkConfirm } =
      await import('./uiSlice')
    store.dispatch(enterBulkSelectMode())
    store.dispatch(
      setUndoToast({
        id: 'toast-seed',
        kind: 'delete',
        skillNames: ['a'],
        tombstoneIds: [tombstoneId('1-a-aaaaaaaa')],
        expiresAt: '2026-04-17T12:00:15.000Z',
        summary: 'Deleted 1 skill.',
      }),
    )
    store.dispatch(
      setBulkConfirm({
        kind: 'delete',
        skillNames: ['a'],
        agentId: null,
        agentName: null,
      }),
    )
  }

  it('setActiveTab atomically clears bulkSelectMode + undoToast + bulkConfirm', async () => {
    const store = await createTestStore()
    await seedAllEphemeralState(store)
    const { setActiveTab } = await import('./uiSlice')

    store.dispatch(setActiveTab('marketplace'))

    expect(store.getState().ui).toMatchObject({
      bulkSelectMode: false,
      undoToast: null,
      bulkConfirm: null,
    })
  })

  it('selectAgent atomically clears bulkSelectMode + undoToast + bulkConfirm', async () => {
    const store = await createTestStore()
    await seedAllEphemeralState(store)
    const { selectAgent } = await import('./uiSlice')

    store.dispatch(selectAgent('cursor' as AgentId))

    expect(store.getState().ui).toMatchObject({
      bulkSelectMode: false,
      undoToast: null,
      bulkConfirm: null,
    })
  })

  it('fetchSyncPreview.pending atomically clears all ephemeral UI state', async () => {
    const store = await createTestStore()
    await seedAllEphemeralState(store)
    const { fetchSyncPreview } = await import('./uiSlice')

    let resolve!: (value: SyncPreviewResult) => void
    mockSyncPreview.mockReturnValue(
      new Promise<SyncPreviewResult>((r) => {
        resolve = r
      }),
    )
    const promise = store.dispatch(fetchSyncPreview())

    expect(store.getState().ui).toMatchObject({
      bulkSelectMode: false,
      undoToast: null,
      bulkConfirm: null,
    })

    resolve(previewNoConflicts)
    await promise
  })

  it('deleteSelectedSkills.pending atomically clears all ephemeral UI state', async () => {
    const store = await createCombinedStore()
    await seedAllEphemeralState(store)
    const { deleteSelectedSkills } = await import('./skillsSlice')

    let resolve!: (value: BulkDeleteResult) => void
    mockDeleteSkills.mockReturnValue(
      new Promise<BulkDeleteResult>((r) => {
        resolve = r
      }),
    )
    const promise = store.dispatch(deleteSelectedSkills(['a']))

    expect(store.getState().ui).toMatchObject({
      bulkSelectMode: false,
      undoToast: null,
      bulkConfirm: null,
    })

    resolve({ items: [] })
    await promise
  })

  it('unlinkSelectedFromAgent.pending atomically clears all ephemeral UI state', async () => {
    const store = await createCombinedStore()
    await seedAllEphemeralState(store)
    const { unlinkSelectedFromAgent } = await import('./skillsSlice')

    let resolve!: (value: BulkUnlinkResult) => void
    mockUnlinkManyFromAgent.mockReturnValue(
      new Promise<BulkUnlinkResult>((r) => {
        resolve = r
      }),
    )
    const promise = store.dispatch(
      unlinkSelectedFromAgent({
        agentId: 'cursor' as AgentId,
        selectedNames: ['a'],
      }),
    )

    expect(store.getState().ui).toMatchObject({
      bulkSelectMode: false,
      undoToast: null,
      bulkConfirm: null,
    })

    resolve({ items: [] })
    await promise
  })
})

/**
 * Rejection-path coverage for bulkSelectMode. `.pending` clears the flag
 * (proved above), but nothing re-enters the mode on failure. These tests
 * document that behavior: after a failed bulk op or sync preview, the user
 * has to explicitly re-enter mode to retry — no auto-resume into a
 * partially-stale selection.
 */
describe('uiSlice bulkSelectMode on rejection', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('fetchSyncPreview.rejected leaves bulkSelectMode=false (no auto re-enter)', async () => {
    const store = await createTestStore()
    const { enterBulkSelectMode, fetchSyncPreview } = await import('./uiSlice')

    store.dispatch(enterBulkSelectMode())
    mockSyncPreview.mockRejectedValue(new Error('Network error'))

    await store.dispatch(fetchSyncPreview())

    expect(store.getState().ui.bulkSelectMode).toBe(false)
  })

  it('deleteSelectedSkills.rejected keeps bulkSelectMode=false (no auto re-enter)', async () => {
    const store = await createCombinedStore()
    const { enterBulkSelectMode } = await import('./uiSlice')
    const { deleteSelectedSkills } = await import('./skillsSlice')

    store.dispatch(enterBulkSelectMode())
    mockDeleteSkills.mockRejectedValue(new Error('FS error'))

    await store.dispatch(deleteSelectedSkills(['task']))

    expect(store.getState().ui.bulkSelectMode).toBe(false)
  })

  it('unlinkSelectedFromAgent.rejected keeps bulkSelectMode=false', async () => {
    const store = await createCombinedStore()
    const { enterBulkSelectMode } = await import('./uiSlice')
    const { unlinkSelectedFromAgent } = await import('./skillsSlice')

    store.dispatch(enterBulkSelectMode())
    mockUnlinkManyFromAgent.mockRejectedValue(new Error('Permission denied'))

    await store.dispatch(
      unlinkSelectedFromAgent({
        agentId: 'cursor' as AgentId,
        selectedNames: ['task'],
      }),
    )

    expect(store.getState().ui.bulkSelectMode).toBe(false)
  })
})
