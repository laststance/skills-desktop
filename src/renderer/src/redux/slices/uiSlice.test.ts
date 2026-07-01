import { configureStore } from '@reduxjs/toolkit'
import type { UnknownAction } from '@reduxjs/toolkit'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RootState } from '@/renderer/src/redux/store'
import type {
  AgentId,
  BulkDeleteResult,
  BulkUnlinkResult,
  ClearBrokenSymlinkSlotsResult,
  ClearOrphanSymlinksResult,
  FilesystemEntryIdentity,
  Skill,
  SkillName,
  SourceStats,
  SyncExecuteResult,
  SyncPreviewResult,
  TombstoneId,
} from '@/shared/types'
import { repositoryId, tombstoneId } from '@/shared/types'

const directoryIdentity: FilesystemEntryIdentity = {
  kind: 'directory',
  dev: 1,
  ino: 2,
  size: 96,
  ctimeMs: 3,
  mtimeMs: 4,
}

// Stub window.electron before importing the slice (thunks reference it at call time)
const mockSyncPreview = vi.fn()
const mockSyncExecute = vi.fn()
const mockGetStats = vi.fn()
const mockGetAll = vi.fn()
const mockDeleteSkills = vi.fn()
const mockClearOrphanSymlinks = vi.fn()
const mockClearBrokenSymlinkSlots = vi.fn()
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
      clearOrphanSymlinks: mockClearOrphanSymlinks,
      clearBrokenSymlinkSlots: mockClearBrokenSymlinkSlots,
      unlinkManyFromAgent: mockUnlinkManyFromAgent,
    },
  },
})

/**
 * Build a reviewed delete target so combined-store tests satisfy destructive IPC shape.
 * @param skillName - Display name selected by the user.
 * @returns Delete thunk target with exact reviewed source path.
 * @example deleteTarget('task')
 */
function deleteTarget(skillName: Skill['name']) {
  return {
    skillName,
    skillPath: `/home/user/.agents/skills/${skillName}`,
    filesystemIdentity: directoryIdentity,
  }
}

/**
 * Build a reviewed unlink target so combined-store tests satisfy destructive IPC shape.
 * @param skillName - Display name selected by the user.
 * @returns Unlink thunk target with exact reviewed agent slot path.
 * @example unlinkTarget('task')
 */
function unlinkTarget(skillName: Skill['name']) {
  return {
    skillName,
    linkPath: `/home/user/.cursor/skills/${skillName}`,
    targetPath: `/home/user/.agents/skills/${skillName}`,
  }
}

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
  it('opens on the Installed tab by default', async () => {
    // Arrange
    const store = await createTestStore()

    // Act
    const activeTab = store.getState().ui.activeTab

    // Assert
    expect(activeTab).toBe('installed')
  })

  it('switches to the Marketplace tab when the user clicks it', async () => {
    // Arrange
    const store = await createTestStore()
    const { setActiveTab } = await import('./uiSlice')

    // Act
    store.dispatch(setActiveTab('marketplace'))

    // Assert
    expect(store.getState().ui.activeTab).toBe('marketplace')
  })
})

describe('uiSlice symlink cleanup dialog', () => {
  it('starts with the Symlink Health cleanup dialog closed', async () => {
    // Arrange
    const store = await createTestStore()

    // Act
    const isOpen = store.getState().ui.symlinkCleanupDialogOpen

    // Assert
    expect(isOpen).toBe(false)
  })

  it('opens and closes the Symlink Health cleanup dialog', async () => {
    // Arrange
    const store = await createTestStore()
    const { closeSymlinkCleanupDialog, openSymlinkCleanupDialog } =
      await import('./uiSlice')

    // Act
    store.dispatch(openSymlinkCleanupDialog())
    const openState = store.getState().ui.symlinkCleanupDialogOpen
    store.dispatch(closeSymlinkCleanupDialog())
    const closedState = store.getState().ui.symlinkCleanupDialogOpen

    // Assert
    expect(openState).toBe(true)
    expect(closedState).toBe(false)
  })

  it('setActiveTab closes the Symlink Health cleanup dialog', async () => {
    // Arrange
    const store = await createTestStore()
    const { openSymlinkCleanupDialog, setActiveTab } = await import('./uiSlice')
    store.dispatch(openSymlinkCleanupDialog())

    // Act
    store.dispatch(setActiveTab('marketplace'))

    // Assert
    expect(store.getState().ui.symlinkCleanupDialogOpen).toBe(false)
  })

  it('selectAgent closes the Symlink Health cleanup dialog', async () => {
    // Arrange
    const store = await createTestStore()
    const { openSymlinkCleanupDialog, selectAgent } = await import('./uiSlice')
    store.dispatch(openSymlinkCleanupDialog())

    // Act
    store.dispatch(selectAgent('cursor'))

    // Assert
    expect(store.getState().ui.symlinkCleanupDialogOpen).toBe(false)
  })

  it('setCleanupAgentTarget closes the Symlink Health cleanup dialog', async () => {
    // Arrange
    const store = await createTestStore()
    const { openSymlinkCleanupDialog, setCleanupAgentTarget } =
      await import('./uiSlice')
    store.dispatch(openSymlinkCleanupDialog())

    // Act
    store.dispatch(setCleanupAgentTarget('cursor'))

    // Assert
    expect(store.getState().ui.symlinkCleanupDialogOpen).toBe(false)
  })
})

describe('uiSlice skill type excludes', () => {
  it('starts with no skill types excluded', async () => {
    // Arrange
    const store = await createTestStore()

    // Act
    const excluded = store.getState().ui.excludedSkillTypeFilters

    // Assert
    expect(excluded).toEqual([])
  })

  it('excludes a skill type when ticked and re-includes it when unticked', async () => {
    // Arrange
    const store = await createTestStore()
    const { toggleExcludedSkillTypeFilter } = await import('./uiSlice')

    // Act + Assert — ticking adds the exclude
    store.dispatch(toggleExcludedSkillTypeFilter('local'))
    expect(store.getState().ui.excludedSkillTypeFilters).toEqual(['local'])

    // Act + Assert — unticking removes it
    store.dispatch(toggleExcludedSkillTypeFilter('local'))
    expect(store.getState().ui.excludedSkillTypeFilters).toEqual([])
  })

  it('refuses to exclude a skill type that the active include filter does not offer', async () => {
    // Arrange
    const store = await createTestStore()
    const { setSkillTypeFilter, toggleExcludedSkillTypeFilter } =
      await import('./uiSlice')

    // Act — include only local, then try to exclude the unavailable symlinked type
    store.dispatch(setSkillTypeFilter('local'))
    store.dispatch(toggleExcludedSkillTypeFilter('symlinked'))

    // Assert
    expect(store.getState().ui.excludedSkillTypeFilters).toEqual([])
  })

  it('drops excludes that no longer apply when the include filter narrows', async () => {
    // Arrange
    const store = await createTestStore()
    const { setSkillTypeFilter, toggleExcludedSkillTypeFilter } =
      await import('./uiSlice')

    // Act — exclude two types, then narrow the include filter to local
    store.dispatch(toggleExcludedSkillTypeFilter('local'))
    store.dispatch(toggleExcludedSkillTypeFilter('gstack'))
    store.dispatch(setSkillTypeFilter('local'))

    // Assert — only the still-applicable exclude survives
    expect(store.getState().ui.excludedSkillTypeFilters).toEqual(['gstack'])
  })

  it('resets both the include and exclude skill-type filters when the user swaps agents', async () => {
    // Arrange
    const store = await createTestStore()
    const { selectAgent, setSkillTypeFilter, toggleExcludedSkillTypeFilter } =
      await import('./uiSlice')
    store.dispatch(setSkillTypeFilter('gstack'))
    store.dispatch(toggleExcludedSkillTypeFilter('local'))

    // Act
    store.dispatch(selectAgent('cursor' as AgentId))

    // Assert
    expect(store.getState().ui.skillTypeFilter).toBe('all')
    expect(store.getState().ui.excludedSkillTypeFilters).toEqual([])
  })
})

describe('uiSlice sync thunks', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('keeps the sync buttons enabled when a preview comes back with conflicts (regression for disabled buttons bug)', async () => {
    // Arrange
    mockSyncPreview.mockResolvedValue(previewWithConflicts)
    const store = await createTestStore()
    const { fetchSyncPreview } = await import('./uiSlice')

    // Act
    await store.dispatch(fetchSyncPreview())

    // Assert
    const state = store.getState().ui
    expect(state.isSyncing).toBe(false)
    expect(state.syncPreview).not.toBeNull()
    expect(state.syncPreview!.conflicts).toHaveLength(1)
  })

  it('shows the syncing spinner while the preview request is in flight', async () => {
    // Arrange — keep the preview request pending so the spinner state is observable
    let resolve!: (value: SyncPreviewResult) => void
    mockSyncPreview.mockReturnValue(
      new Promise<SyncPreviewResult>((r) => {
        resolve = r
      }),
    )
    const store = await createTestStore()
    const { fetchSyncPreview } = await import('./uiSlice')

    // Act
    const promise = store.dispatch(fetchSyncPreview())

    // Assert
    expect(store.getState().ui.isSyncing).toBe(true)

    // Resolve to clean up
    resolve(previewNoConflicts)
    await promise
  })

  it('stops the syncing spinner and shows no preview when the preview request fails', async () => {
    // Arrange
    mockSyncPreview.mockRejectedValue(new Error('Network error'))
    const store = await createTestStore()
    const { fetchSyncPreview } = await import('./uiSlice')

    // Act
    await store.dispatch(fetchSyncPreview())

    // Assert
    expect(store.getState().ui.isSyncing).toBe(false)
    expect(store.getState().ui.syncPreview).toBeNull()
  })

  it('shows the sync preview once the preview request resolves', async () => {
    // Arrange
    mockSyncPreview.mockResolvedValue(previewNoConflicts)
    const store = await createTestStore()
    const { fetchSyncPreview } = await import('./uiSlice')

    // Act
    await store.dispatch(fetchSyncPreview())

    // Assert
    const state = store.getState().ui
    expect(state.syncPreview).toEqual(previewNoConflicts)
    expect(state.isSyncing).toBe(false)
  })

  it('replaces the preview with a results dialog once the sync runs to completion', async () => {
    // Arrange
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
    await store.dispatch(fetchSyncPreview())
    expect(store.getState().ui.syncPreview).not.toBeNull()

    // Act — execute the sync
    await store.dispatch(
      executeSyncAction({
        replaceConflicts: ['/home/user/.cursor/skills/agent-browser'],
      }),
    )

    // Assert — preview is dismissed and a populated result drives the dialog
    const state = store.getState().ui
    expect(state.syncPreview).toBeNull()
    expect(state.isSyncing).toBe(false)
    // syncResult populated for SyncResultDialog
    expect(state.syncResult).not.toBeNull()
    expect(state.syncResult!.created).toBe(3)
    expect(state.syncResult!.details).toHaveLength(1)
  })

  it('shows no results dialog when the sync execution fails', async () => {
    // Arrange
    mockSyncExecute.mockRejectedValue(new Error('Permission denied'))
    const store = await createTestStore()
    const { executeSyncAction } = await import('./uiSlice')

    // Act
    await store.dispatch(executeSyncAction({ replaceConflicts: [] }))

    // Assert
    expect(store.getState().ui.isSyncing).toBe(false)
    expect(store.getState().ui.syncResult).toBeNull()
  })

  it('dismisses the sync results dialog when the user closes it', async () => {
    // Arrange
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

    // Act
    store.dispatch(clearSyncResult())

    // Assert
    expect(store.getState().ui.syncResult).toBeNull()
  })

  it('dismisses a stale results dialog when a new preview starts (prevents overlapping dialogs)', async () => {
    // Arrange — populate syncResult via a completed sync
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

    // Act — start a new preview; the pending phase should clear the old result
    let resolve!: (value: SyncPreviewResult) => void
    mockSyncPreview.mockReturnValue(
      new Promise<SyncPreviewResult>((r) => {
        resolve = r
      }),
    )
    const promise = store.dispatch(fetchSyncPreview())

    // Assert
    expect(store.getState().ui.syncResult).toBeNull()

    resolve(previewNoConflicts)
    await promise
  })

  it('dismisses the sync preview when it is cleared programmatically', async () => {
    // Arrange
    mockSyncPreview.mockResolvedValue(previewWithConflicts)
    const store = await createTestStore()
    const { fetchSyncPreview, setSyncPreview } = await import('./uiSlice')
    await store.dispatch(fetchSyncPreview())
    expect(store.getState().ui.syncPreview).not.toBeNull()

    // Act
    store.dispatch(setSyncPreview(null))

    // Assert
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

  it('opens the bookmark detail modal for the chosen bookmark', async () => {
    // Arrange
    const store = await createTestStore()
    const { setSelectedBookmarkForDetail } = await import('./uiSlice')

    // Act
    store.dispatch(setSelectedBookmarkForDetail(sampleBookmark))

    // Assert
    expect(store.getState().ui.selectedBookmarkForDetail).toEqual(
      sampleBookmark,
    )
  })

  it('closes the bookmark detail modal when dismissed', async () => {
    // Arrange
    const store = await createTestStore()
    const { setSelectedBookmarkForDetail, clearSelectedBookmarkForDetail } =
      await import('./uiSlice')
    store.dispatch(setSelectedBookmarkForDetail(sampleBookmark))
    expect(store.getState().ui.selectedBookmarkForDetail).not.toBeNull()

    // Act
    store.dispatch(clearSelectedBookmarkForDetail())

    // Assert
    expect(store.getState().ui.selectedBookmarkForDetail).toBeNull()
  })

  it('starts with the bookmark detail modal closed', async () => {
    // Arrange
    const store = await createTestStore()

    // Act
    const selectedBookmark = store.getState().ui.selectedBookmarkForDetail

    // Assert
    expect(selectedBookmark).toBeNull()
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

  it('starts with no undo toast on screen', async () => {
    // Arrange
    const store = await createTestStore()

    // Act
    const undoToast = store.getState().ui.undoToast

    // Assert
    expect(undoToast).toBeNull()
  })

  it('shows an undo toast after a bulk delete completes', async () => {
    // Arrange
    const store = await createTestStore()
    const { setUndoToast } = await import('./uiSlice')
    const toast = makeToast('delete')

    // Act
    store.dispatch(setUndoToast(toast))

    // Assert
    expect(store.getState().ui.undoToast).toEqual(toast)
  })

  it('dismisses the undo toast when it is cleared', async () => {
    // Arrange
    const store = await createTestStore()
    const { setUndoToast, clearUndoToast } = await import('./uiSlice')
    store.dispatch(setUndoToast(makeToast()))
    expect(store.getState().ui.undoToast).not.toBeNull()

    // Act
    store.dispatch(clearUndoToast())

    // Assert
    expect(store.getState().ui.undoToast).toBeNull()
  })

  it('keeps the newer undo toast when an older toast dismissal arrives late', async () => {
    // Arrange
    const store = await createTestStore()
    const { setUndoToast, clearUndoToastIfCurrent } = await import('./uiSlice')
    const olderToast = makeToast()
    const newerToast = {
      ...makeToast(),
      id: 'toast-2',
      skillNames: ['newer-task'] as SkillName[],
      summary: 'Deleted 1 skill. 0 symlinks removed.',
    }
    store.dispatch(setUndoToast(olderToast))
    store.dispatch(setUndoToast(newerToast))

    // Act
    store.dispatch(clearUndoToastIfCurrent(olderToast.id))

    // Assert
    expect(store.getState().ui.undoToast).toEqual(newerToast)
  })

  it('dismisses an active undo toast when the user switches agents (context switch invalidates it)', async () => {
    // Arrange
    const store = await createTestStore()
    const { setUndoToast, selectAgent } = await import('./uiSlice')
    store.dispatch(setUndoToast(makeToast()))
    expect(store.getState().ui.undoToast).not.toBeNull()

    // Act
    store.dispatch(selectAgent('cursor' as AgentId))

    // Assert
    expect(store.getState().ui.undoToast).toBeNull()
  })

  it('dismisses an active undo toast when the user switches tabs (tab switch invalidates it)', async () => {
    // Arrange
    const store = await createTestStore()
    const { setUndoToast, setActiveTab } = await import('./uiSlice')
    store.dispatch(setUndoToast(makeToast()))

    // Act
    store.dispatch(setActiveTab('marketplace'))

    // Assert
    expect(store.getState().ui.undoToast).toBeNull()
  })

  it('dismisses the undo toast when a sync preview starts', async () => {
    // Arrange
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

    // Act
    const promise = store.dispatch(fetchSyncPreview())

    // Assert
    expect(store.getState().ui.undoToast).toBeNull()

    resolve(previewNoConflicts)
    await promise
  })

  it('dismisses the undo toast when a new bulk delete begins (combined store)', async () => {
    // Arrange
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

    // Act
    const promise = store.dispatch(deleteSelectedSkills([deleteTarget('task')]))

    // Assert
    expect(store.getState().ui.undoToast).toBeNull()

    resolve({ items: [] })
    await promise
  })

  it('dismisses the undo toast when an orphan-symlink cleanup begins (combined store)', async () => {
    // Arrange
    const store = await createCombinedStore()
    const { setUndoToast } = await import('./uiSlice')
    const { clearSelectedOrphanSymlinks } = await import('./skillsSlice')
    store.dispatch(setUndoToast(makeToast()))
    expect(store.getState().ui.undoToast).not.toBeNull()
    let resolve!: (value: ClearOrphanSymlinksResult) => void
    mockClearOrphanSymlinks.mockReturnValue(
      new Promise<ClearOrphanSymlinksResult>((r) => {
        resolve = r
      }),
    )

    // Act
    const promise = store.dispatch(
      clearSelectedOrphanSymlinks([
        {
          skillName: 'task',
          agents: [
            {
              agentId: 'codex' as AgentId,
              linkPath: '/home/user/.codex/skills/task',
              targetPath: '/home/user/.agents/skills/task',
            },
          ],
        },
      ]),
    )

    // Assert
    expect(store.getState().ui.undoToast).toBeNull()

    resolve({ items: [] })
    await promise
  })

  it('dismisses the undo toast when a broken-slot cleanup begins (combined store)', async () => {
    // Arrange
    const store = await createCombinedStore()
    const { setUndoToast } = await import('./uiSlice')
    const { clearSelectedBrokenSymlinkSlots } = await import('./skillsSlice')
    store.dispatch(setUndoToast(makeToast()))
    expect(store.getState().ui.undoToast).not.toBeNull()
    let resolve!: (value: ClearBrokenSymlinkSlotsResult) => void
    mockClearBrokenSymlinkSlots.mockReturnValue(
      new Promise<ClearBrokenSymlinkSlotsResult>((r) => {
        resolve = r
      }),
    )

    // Act
    const promise = store.dispatch(
      clearSelectedBrokenSymlinkSlots({
        items: [
          {
            agentId: 'codex' as AgentId,
            linkName: 'task',
            displaySkillName: 'task',
            linkPath: '/home/user/.codex/skills/task',
            targetPath: '/home/user/.agents/skills/task',
          },
        ],
      }),
    )

    // Assert
    expect(store.getState().ui.undoToast).toBeNull()

    resolve({ items: [] })
    await promise
  })

  it('dismisses the undo toast when a bulk unlink begins (combined store)', async () => {
    // Arrange
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

    // Act
    const promise = store.dispatch(
      unlinkSelectedFromAgent({
        agentId: 'cursor' as AgentId,
        selectedNames: [unlinkTarget('task')],
      }),
    )

    // Assert
    expect(store.getState().ui.undoToast).toBeNull()

    resolve({ items: [] })
    await promise
  })
})

describe('uiSlice bulkSelectMode', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('starts with bulk-select mode off (default is a clean list)', async () => {
    // Arrange
    const store = await createTestStore()

    // Act
    const bulkSelectMode = store.getState().ui.bulkSelectMode

    // Assert
    expect(bulkSelectMode).toBe(false)
  })

  it('turns on bulk-select mode when the user enters it', async () => {
    // Arrange
    const store = await createTestStore()
    const { enterBulkSelectMode } = await import('./uiSlice')

    // Act
    store.dispatch(enterBulkSelectMode())

    // Assert
    expect(store.getState().ui.bulkSelectMode).toBe(true)
  })

  it('turns off bulk-select mode when the user exits it', async () => {
    // Arrange
    const store = await createTestStore()
    const { enterBulkSelectMode, exitBulkSelectMode } =
      await import('./uiSlice')
    store.dispatch(enterBulkSelectMode())

    // Act
    store.dispatch(exitBulkSelectMode())

    // Assert
    expect(store.getState().ui.bulkSelectMode).toBe(false)
  })

  it('exits bulk-select mode when the user switches tabs', async () => {
    // Arrange
    const store = await createTestStore()
    const { enterBulkSelectMode, setActiveTab } = await import('./uiSlice')
    store.dispatch(enterBulkSelectMode())
    expect(store.getState().ui.bulkSelectMode).toBe(true)

    // Act
    store.dispatch(setActiveTab('marketplace'))

    // Assert
    expect(store.getState().ui.bulkSelectMode).toBe(false)
  })

  it('exits bulk-select mode when the user swaps agents', async () => {
    // Arrange
    const store = await createTestStore()
    const { enterBulkSelectMode, selectAgent } = await import('./uiSlice')
    store.dispatch(enterBulkSelectMode())

    // Act
    store.dispatch(selectAgent('cursor' as AgentId))

    // Assert
    expect(store.getState().ui.bulkSelectMode).toBe(false)
  })

  it('exits bulk-select mode when a sync preview starts', async () => {
    // Arrange
    const store = await createTestStore()
    const { enterBulkSelectMode, fetchSyncPreview } = await import('./uiSlice')
    store.dispatch(enterBulkSelectMode())
    let resolve!: (value: SyncPreviewResult) => void
    mockSyncPreview.mockReturnValue(
      new Promise<SyncPreviewResult>((r) => {
        resolve = r
      }),
    )

    // Act
    const promise = store.dispatch(fetchSyncPreview())

    // Assert
    expect(store.getState().ui.bulkSelectMode).toBe(false)

    resolve(previewNoConflicts)
    await promise
  })

  it('exits bulk-select mode when a bulk delete begins (combined store)', async () => {
    // Arrange
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

    // Act
    const promise = store.dispatch(deleteSelectedSkills([deleteTarget('task')]))

    // Assert
    expect(store.getState().ui.bulkSelectMode).toBe(false)

    resolve({ items: [] })
    await promise
  })

  it('exits bulk-select mode when an orphan-symlink cleanup begins (combined store)', async () => {
    // Arrange
    const store = await createCombinedStore()
    const { enterBulkSelectMode } = await import('./uiSlice')
    const { clearSelectedOrphanSymlinks } = await import('./skillsSlice')
    store.dispatch(enterBulkSelectMode())
    let resolve!: (value: ClearOrphanSymlinksResult) => void
    mockClearOrphanSymlinks.mockReturnValue(
      new Promise<ClearOrphanSymlinksResult>((r) => {
        resolve = r
      }),
    )

    // Act
    const promise = store.dispatch(
      clearSelectedOrphanSymlinks([
        {
          skillName: 'task',
          agents: [
            {
              agentId: 'codex' as AgentId,
              linkPath: '/home/user/.codex/skills/task',
              targetPath: '/home/user/.agents/skills/task',
            },
          ],
        },
      ]),
    )

    // Assert
    expect(store.getState().ui.bulkSelectMode).toBe(false)

    resolve({ items: [] })
    await promise
  })

  it('exits bulk-select mode when a broken-slot cleanup begins (combined store)', async () => {
    // Arrange
    const store = await createCombinedStore()
    const { enterBulkSelectMode } = await import('./uiSlice')
    const { clearSelectedBrokenSymlinkSlots } = await import('./skillsSlice')
    store.dispatch(enterBulkSelectMode())
    let resolve!: (value: ClearBrokenSymlinkSlotsResult) => void
    mockClearBrokenSymlinkSlots.mockReturnValue(
      new Promise<ClearBrokenSymlinkSlotsResult>((r) => {
        resolve = r
      }),
    )

    // Act
    const promise = store.dispatch(
      clearSelectedBrokenSymlinkSlots({
        items: [
          {
            agentId: 'codex' as AgentId,
            linkName: 'task',
            displaySkillName: 'task',
            linkPath: '/home/user/.codex/skills/task',
            targetPath: '/home/user/.agents/skills/task',
          },
        ],
      }),
    )

    // Assert
    expect(store.getState().ui.bulkSelectMode).toBe(false)

    resolve({ items: [] })
    await promise
  })

  it('exits bulk-select mode when a bulk unlink begins (combined store)', async () => {
    // Arrange
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

    // Act
    const promise = store.dispatch(
      unlinkSelectedFromAgent({
        agentId: 'cursor' as AgentId,
        selectedNames: [unlinkTarget('task')],
      }),
    )

    // Assert
    expect(store.getState().ui.bulkSelectMode).toBe(false)

    resolve({ items: [] })
    await promise
  })

  // ── Idempotency ───────────────────────────────────────────────────────
  // Guards against a future refactor splitting the reducer into conditional
  // branches; if "already-true enter" started side-effecting, toggling rapidly
  // could wipe unrelated state. The invariant is a plain boolean assignment.

  it('stays in bulk-select mode when entered twice in a row', async () => {
    // Arrange
    const store = await createTestStore()
    const { enterBulkSelectMode } = await import('./uiSlice')

    // Act
    store.dispatch(enterBulkSelectMode())
    store.dispatch(enterBulkSelectMode())

    // Assert
    expect(store.getState().ui.bulkSelectMode).toBe(true)
  })

  it('stays out of bulk-select mode when exited twice in a row', async () => {
    // Arrange
    const store = await createTestStore()
    const { exitBulkSelectMode } = await import('./uiSlice')

    // Act
    store.dispatch(exitBulkSelectMode())
    store.dispatch(exitBulkSelectMode())

    // Assert
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
        sourceSummary: null,
        deleteTargets: [deleteTarget('a' as Skill['name'])],
        orphanRecords: [],
        staleDeleteErrors: [],
        orphanErrors: [],
        protectedErrors: [],
      }),
    )
  }

  it('clears bulk-select mode, the undo toast, and the bulk-confirm dialog together when switching tabs', async () => {
    // Arrange
    const store = await createTestStore()
    await seedAllEphemeralState(store)
    const { setActiveTab } = await import('./uiSlice')

    // Act
    store.dispatch(setActiveTab('marketplace'))

    // Assert
    expect(store.getState().ui).toMatchObject({
      bulkSelectMode: false,
      undoToast: null,
      bulkConfirm: null,
    })
  })

  it('clears bulk-select mode, the undo toast, and the bulk-confirm dialog together when swapping agents', async () => {
    // Arrange
    const store = await createTestStore()
    await seedAllEphemeralState(store)
    const { selectAgent } = await import('./uiSlice')

    // Act
    store.dispatch(selectAgent('cursor' as AgentId))

    // Assert
    expect(store.getState().ui).toMatchObject({
      bulkSelectMode: false,
      undoToast: null,
      bulkConfirm: null,
    })
  })

  it('clears all ephemeral UI state together when a sync preview starts', async () => {
    // Arrange
    const store = await createTestStore()
    await seedAllEphemeralState(store)
    const { fetchSyncPreview } = await import('./uiSlice')
    let resolve!: (value: SyncPreviewResult) => void
    mockSyncPreview.mockReturnValue(
      new Promise<SyncPreviewResult>((r) => {
        resolve = r
      }),
    )

    // Act
    const promise = store.dispatch(fetchSyncPreview())

    // Assert
    expect(store.getState().ui).toMatchObject({
      bulkSelectMode: false,
      undoToast: null,
      bulkConfirm: null,
    })

    resolve(previewNoConflicts)
    await promise
  })

  it('clears all ephemeral UI state together when a bulk delete begins', async () => {
    // Arrange
    const store = await createCombinedStore()
    await seedAllEphemeralState(store)
    const { deleteSelectedSkills } = await import('./skillsSlice')
    let resolve!: (value: BulkDeleteResult) => void
    mockDeleteSkills.mockReturnValue(
      new Promise<BulkDeleteResult>((r) => {
        resolve = r
      }),
    )

    // Act
    const promise = store.dispatch(deleteSelectedSkills([deleteTarget('a')]))

    // Assert
    expect(store.getState().ui).toMatchObject({
      bulkSelectMode: false,
      undoToast: null,
      bulkConfirm: null,
    })

    resolve({ items: [] })
    await promise
  })

  it('keeps the Symlink Health cleanup dialog open while a bulk delete runs inside it', async () => {
    // Arrange
    const store = await createCombinedStore()
    const { openSymlinkCleanupDialog } = await import('./uiSlice')
    const { deleteSelectedSkills } = await import('./skillsSlice')
    store.dispatch(openSymlinkCleanupDialog())
    let resolve!: (value: BulkDeleteResult) => void
    mockDeleteSkills.mockReturnValue(
      new Promise<BulkDeleteResult>((r) => {
        resolve = r
      }),
    )

    // Act
    const promise = store.dispatch(deleteSelectedSkills([deleteTarget('a')]))

    // Assert
    expect(store.getState().ui.symlinkCleanupDialogOpen).toBe(true)

    resolve({ items: [] })
    await promise
  })

  it('clears all ephemeral UI state together when a bulk unlink begins', async () => {
    // Arrange
    const store = await createCombinedStore()
    await seedAllEphemeralState(store)
    const { unlinkSelectedFromAgent } = await import('./skillsSlice')
    let resolve!: (value: BulkUnlinkResult) => void
    mockUnlinkManyFromAgent.mockReturnValue(
      new Promise<BulkUnlinkResult>((r) => {
        resolve = r
      }),
    )

    // Act
    const promise = store.dispatch(
      unlinkSelectedFromAgent({
        agentId: 'cursor' as AgentId,
        selectedNames: [unlinkTarget('a')],
      }),
    )

    // Assert
    expect(store.getState().ui).toMatchObject({
      bulkSelectMode: false,
      undoToast: null,
      bulkConfirm: null,
    })

    resolve({ items: [] })
    await promise
  })

  it('keeps the Symlink Health cleanup dialog open while a bulk unlink runs inside it', async () => {
    // Arrange
    const store = await createCombinedStore()
    const { openSymlinkCleanupDialog } = await import('./uiSlice')
    const { unlinkSelectedFromAgent } = await import('./skillsSlice')
    store.dispatch(openSymlinkCleanupDialog())
    let resolve!: (value: BulkUnlinkResult) => void
    mockUnlinkManyFromAgent.mockReturnValue(
      new Promise<BulkUnlinkResult>((r) => {
        resolve = r
      }),
    )

    // Act
    const promise = store.dispatch(
      unlinkSelectedFromAgent({
        agentId: 'cursor' as AgentId,
        selectedNames: [unlinkTarget('a')],
      }),
    )

    // Assert
    expect(store.getState().ui.symlinkCleanupDialogOpen).toBe(true)

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

  it('does not re-enter bulk-select mode after a sync preview fails', async () => {
    // Arrange
    const store = await createTestStore()
    const { enterBulkSelectMode, fetchSyncPreview } = await import('./uiSlice')
    store.dispatch(enterBulkSelectMode())
    mockSyncPreview.mockRejectedValue(new Error('Network error'))

    // Act
    await store.dispatch(fetchSyncPreview())

    // Assert
    expect(store.getState().ui.bulkSelectMode).toBe(false)
  })

  it('does not re-enter bulk-select mode after a bulk delete fails', async () => {
    // Arrange
    const store = await createCombinedStore()
    const { enterBulkSelectMode } = await import('./uiSlice')
    const { deleteSelectedSkills } = await import('./skillsSlice')
    store.dispatch(enterBulkSelectMode())
    mockDeleteSkills.mockRejectedValue(new Error('FS error'))

    // Act
    await store.dispatch(deleteSelectedSkills([deleteTarget('task')]))

    // Assert
    expect(store.getState().ui.bulkSelectMode).toBe(false)
  })

  it('does not re-enter bulk-select mode after a bulk unlink fails', async () => {
    // Arrange
    const store = await createCombinedStore()
    const { enterBulkSelectMode } = await import('./uiSlice')
    const { unlinkSelectedFromAgent } = await import('./skillsSlice')
    store.dispatch(enterBulkSelectMode())
    mockUnlinkManyFromAgent.mockRejectedValue(new Error('Permission denied'))

    // Act
    await store.dispatch(
      unlinkSelectedFromAgent({
        agentId: 'cursor' as AgentId,
        selectedNames: [unlinkTarget('task')],
      }),
    )

    // Assert
    expect(store.getState().ui.bulkSelectMode).toBe(false)
  })
})

describe('uiSlice source filter (selectedSources)', () => {
  /**
   * Minimal source-bearing skill for the refetch-prune test. The prune reducer
   * reads only `skill.source`; the remaining fields satisfy the `Skill` shape.
   * @param name - Skill directory name.
   * @param source - Repo slug; omit to model a source-less local skill.
   * @returns A `Skill` carrying `source`/`sourceUrl` when a slug is provided.
   */
  function skillWithSource(name: string, source?: string): Skill {
    return {
      name,
      description: `${name} skill`,
      path: `/home/user/.agents/skills/${name}`,
      symlinkCount: 0,
      symlinks: [],
      isSource: true,
      isOrphan: false,
      ...(source
        ? {
            source: repositoryId(source),
            sourceUrl: `https://github.com/${source}.git`,
          }
        : {}),
    }
  }

  it('starts with an empty source include-filter (shows all sources)', async () => {
    // Arrange
    const store = await createTestStore()

    // Act
    const selectedSources = store.getState().ui.selectedSources

    // Assert
    expect(selectedSources).toEqual([])
  })

  it('toggleSource adds a repo to the empty include-filter', async () => {
    // Arrange
    const store = await createTestStore()
    const { toggleSource } = await import('./uiSlice')

    // Act
    store.dispatch(toggleSource(repositoryId('vercel-labs/skills')))

    // Assert
    expect(store.getState().ui.selectedSources).toEqual([
      repositoryId('vercel-labs/skills'),
    ])
  })

  it('toggleSource is additive — a second repo joins rather than replacing the first', async () => {
    // Arrange
    const store = await createTestStore()
    const { toggleSource } = await import('./uiSlice')

    // Act
    store.dispatch(toggleSource(repositoryId('vercel-labs/skills')))
    store.dispatch(toggleSource(repositoryId('pbakaus/impeccable')))

    // Assert — both repos coexist in selection order
    expect(store.getState().ui.selectedSources).toEqual([
      repositoryId('vercel-labs/skills'),
      repositoryId('pbakaus/impeccable'),
    ])
  })

  it('toggleSource removes a repo that is already ticked', async () => {
    // Arrange
    const store = await createTestStore()
    const { toggleSource } = await import('./uiSlice')

    // Act — tick then untick the same repo
    store.dispatch(toggleSource(repositoryId('vercel-labs/skills')))
    store.dispatch(toggleSource(repositoryId('vercel-labs/skills')))

    // Assert
    expect(store.getState().ui.selectedSources).toEqual([])
  })

  it('setSelectedSources replaces the whole include-filter in one shot', async () => {
    // Arrange — start with an unrelated repo ticked
    const store = await createTestStore()
    const { toggleSource, setSelectedSources } = await import('./uiSlice')
    store.dispatch(toggleSource(repositoryId('old/repo')))

    // Act — bulk overwrite
    store.dispatch(
      setSelectedSources([
        repositoryId('vercel-labs/skills'),
        repositoryId('pbakaus/impeccable'),
      ]),
    )

    // Assert — previous selection is gone, replaced wholesale
    expect(store.getState().ui.selectedSources).toEqual([
      repositoryId('vercel-labs/skills'),
      repositoryId('pbakaus/impeccable'),
    ])
  })

  it('clearSelectedSources empties the include-filter back to show-all', async () => {
    // Arrange
    const store = await createTestStore()
    const { setSelectedSources, clearSelectedSources } =
      await import('./uiSlice')
    store.dispatch(setSelectedSources([repositoryId('vercel-labs/skills')]))

    // Act
    store.dispatch(clearSelectedSources())

    // Assert
    expect(store.getState().ui.selectedSources).toEqual([])
  })

  it('drops a ticked repo that no longer backs any skill after a refetch', async () => {
    // The prune guards against a refetch (delete/sync/refresh) leaving a ticked
    // repo that the new inventory no longer contains. Arrange — two ticked.
    const store = await createTestStore()
    const { setSelectedSources } = await import('./uiSlice')
    const { fetchSkills } = await import('./skillsSlice')
    store.dispatch(
      setSelectedSources([
        repositoryId('vercel-labs/skills'),
        repositoryId('stale/removed-repo'),
      ]),
    )

    // Act — the reload only carries vercel-labs/skills
    store.dispatch(
      fetchSkills.fulfilled(
        [skillWithSource('task', 'vercel-labs/skills')],
        'req-prune',
      ),
    )

    // Assert — the orphaned id is pruned, the still-backed id survives
    expect(store.getState().ui.selectedSources).toEqual([
      repositoryId('vercel-labs/skills'),
    ])
  })
})

describe('getAvailableExcludeTypes offered subtractions per include mode', () => {
  it('offers G-Stack, orphan, and unique as valid excludes while including symlinked skills', async () => {
    // Arrange
    const { getAvailableExcludeTypes } = await import('./uiSlice')

    // Act
    const offered = getAvailableExcludeTypes('symlinked')

    // Assert
    expect(offered).toEqual(['gstack', 'orphan', 'unique'])
  })

  it('offers symlinked, local, and G-Stack — but not orphan — as excludes while including unique skills', async () => {
    // Arrange
    const { getAvailableExcludeTypes } = await import('./uiSlice')

    // Act
    const offered = getAvailableExcludeTypes('unique')

    // Assert — orphan omitted: an orphan skill has no valid slots, so it can
    // never also be unique (orphan ∩ unique = ∅).
    expect(offered).toEqual(['symlinked', 'local', 'gstack'])
  })

  it('offers G-Stack and unique as the valid excludes while including local skills', async () => {
    // Arrange
    const { getAvailableExcludeTypes } = await import('./uiSlice')

    // Act
    const offered = getAvailableExcludeTypes('local')

    // Assert
    expect(offered).toEqual(['gstack', 'unique'])
  })

  it('does NOT offer unique as an exclude while including orphan skills (orphans are never unique)', async () => {
    // Arrange
    const { getAvailableExcludeTypes } = await import('./uiSlice')

    // Act
    const offered = getAvailableExcludeTypes('orphan')

    // Assert — unchanged from before unique existed; guards orphan ∩ unique = ∅.
    expect(offered).toEqual(['gstack'])
  })

  it('lets the user exclude orphan skills while the symlinked include mode is active', async () => {
    // Arrange
    const store = await createTestStore()
    const { setSkillTypeFilter, toggleExcludedSkillTypeFilter } =
      await import('./uiSlice')
    store.dispatch(setSkillTypeFilter('symlinked'))

    // Act
    store.dispatch(toggleExcludedSkillTypeFilter('orphan'))

    // Assert
    expect(store.getState().ui.excludedSkillTypeFilters).toEqual(['orphan'])
  })

  it('lets the user exclude unique skills while the local include mode is active', async () => {
    // Arrange
    const store = await createTestStore()
    const { setSkillTypeFilter, toggleExcludedSkillTypeFilter } =
      await import('./uiSlice')
    store.dispatch(setSkillTypeFilter('local'))

    // Act
    store.dispatch(toggleExcludedSkillTypeFilter('unique'))

    // Assert
    expect(store.getState().ui.excludedSkillTypeFilters).toEqual(['unique'])
  })

  it('refuses to exclude unique while the orphan include mode is active', async () => {
    // Arrange
    const store = await createTestStore()
    const { setSkillTypeFilter, toggleExcludedSkillTypeFilter } =
      await import('./uiSlice')
    store.dispatch(setSkillTypeFilter('orphan'))

    // Act — orphan ∩ unique = ∅, so excluding unique here must be a no-op.
    store.dispatch(toggleExcludedSkillTypeFilter('unique'))

    // Assert
    expect(store.getState().ui.excludedSkillTypeFilters).toEqual([])
  })

  it('drops a now-invalid unique exclude when the include filter narrows to orphan', async () => {
    // Arrange — exclude unique under the permissive "all" include, then narrow.
    const store = await createTestStore()
    const { setSkillTypeFilter, toggleExcludedSkillTypeFilter } =
      await import('./uiSlice')
    store.dispatch(toggleExcludedSkillTypeFilter('unique'))

    // Act — narrowing to orphan must prune unique (unavailable for orphan).
    store.dispatch(setSkillTypeFilter('orphan'))

    // Assert
    expect(store.getState().ui.excludedSkillTypeFilters).toEqual([])
  })

  it('accepts unique as the active include filter', async () => {
    // Arrange
    const store = await createTestStore()
    const { setSkillTypeFilter } = await import('./uiSlice')

    // Act
    store.dispatch(setSkillTypeFilter('unique'))

    // Assert
    expect(store.getState().ui.skillTypeFilter).toBe('unique')
  })
})

describe('uiSlice search box', () => {
  it('matches skills against the typed search query', async () => {
    // Arrange
    const store = await createTestStore()
    const { setSearchQuery } = await import('./uiSlice')

    // Act
    store.dispatch(setSearchQuery('browser'))

    // Assert
    expect(store.getState().ui.searchQuery).toBe('browser')
  })

  it('switches the search box to match against repository names', async () => {
    // Arrange
    const store = await createTestStore()
    const { setSearchScope } = await import('./uiSlice')

    // Act
    store.dispatch(setSearchScope('repo'))

    // Assert
    expect(store.getState().ui.searchScope).toBe('repo')
  })
})

describe('uiSlice sort order', () => {
  it('starts sorted A to Z', async () => {
    // Arrange
    const store = await createTestStore()

    // Act
    const sortOrder = store.getState().ui.sortOrder

    // Assert
    expect(sortOrder).toBe('asc')
  })

  it('flips the skill list to Z to A when the user toggles the sort control', async () => {
    // Arrange
    const store = await createTestStore()
    const { toggleSortOrder } = await import('./uiSlice')

    // Act
    store.dispatch(toggleSortOrder())

    // Assert
    expect(store.getState().ui.sortOrder).toBe('desc')
  })

  it('flips the skill list back to A to Z when the user toggles the sort control again', async () => {
    // Arrange
    const store = await createTestStore()
    const { toggleSortOrder } = await import('./uiSlice')
    store.dispatch(toggleSortOrder())

    // Act
    store.dispatch(toggleSortOrder())

    // Assert
    expect(store.getState().ui.sortOrder).toBe('asc')
  })
})

describe('uiSlice clear-all excluded skill types', () => {
  it('removes every active skill-type exclude in one action', async () => {
    // Arrange — exclude two types under the default "all" include mode
    const store = await createTestStore()
    const { toggleExcludedSkillTypeFilter, clearExcludedSkillTypeFilters } =
      await import('./uiSlice')
    store.dispatch(toggleExcludedSkillTypeFilter('local'))
    store.dispatch(toggleExcludedSkillTypeFilter('gstack'))
    expect(store.getState().ui.excludedSkillTypeFilters).toEqual([
      'local',
      'gstack',
    ])

    // Act
    store.dispatch(clearExcludedSkillTypeFilters())

    // Assert
    expect(store.getState().ui.excludedSkillTypeFilters).toEqual([])
  })
})

describe('uiSlice bulk confirm dialog', () => {
  it('closes the bulk confirm dialog when the user cancels or confirms', async () => {
    // Arrange — open the dialog with a pending delete payload
    const store = await createTestStore()
    const { setBulkConfirm, clearBulkConfirm } = await import('./uiSlice')
    store.dispatch(
      setBulkConfirm({
        kind: 'delete',
        skillNames: ['task'],
        agentId: null,
        agentName: null,
        sourceSummary: null,
        deleteTargets: [deleteTarget('task' as Skill['name'])],
        orphanRecords: [],
        staleDeleteErrors: [],
        orphanErrors: [],
        protectedErrors: [],
      }),
    )
    expect(store.getState().ui.bulkConfirm).not.toBeNull()

    // Act
    store.dispatch(clearBulkConfirm())

    // Assert
    expect(store.getState().ui.bulkConfirm).toBeNull()
  })
})

describe('uiSlice per-agent cleanup dialog', () => {
  it('targets an agent for the per-agent cleanup dialog', async () => {
    // Arrange
    const store = await createTestStore()
    const { setCleanupAgentTarget } = await import('./uiSlice')

    // Act
    store.dispatch(setCleanupAgentTarget('cursor' as AgentId))

    // Assert
    expect(store.getState().ui.cleanupAgentTarget).toBe('cursor')
  })

  it('closes the per-agent cleanup dialog and discards its scoped sync preview', async () => {
    // Arrange — open the dialog with an agent target and a scoped preview present
    const store = await createTestStore()
    const { setCleanupAgentTarget, setSyncPreview, clearCleanupAgentTarget } =
      await import('./uiSlice')
    store.dispatch(setCleanupAgentTarget('cursor' as AgentId))
    store.dispatch(setSyncPreview(previewWithConflicts))
    expect(store.getState().ui.cleanupAgentTarget).toBe('cursor')
    expect(store.getState().ui.syncPreview).not.toBeNull()

    // Act
    store.dispatch(clearCleanupAgentTarget())

    // Assert — both the target and the stale scoped preview are cleared
    expect(store.getState().ui.cleanupAgentTarget).toBeNull()
    expect(store.getState().ui.syncPreview).toBeNull()
  })
})

describe('uiSlice source stats refresh', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  /** Sample source-directory stats for the refresh thunk */
  const sampleStats = {
    path: '/Users/me/.agents/skills',
    skillCount: 15,
    totalSize: '2.4 MB',
    lastModified: '2026-04-10T08:00:00.000Z',
  } satisfies SourceStats

  it('spins the Refresh button while the source-stats request is in flight', async () => {
    // Arrange — keep the stats request pending so the spinner state is observable
    let resolve!: (value: SourceStats) => void
    mockGetStats.mockReturnValue(
      new Promise<SourceStats>((r) => {
        resolve = r
      }),
    )
    const store = await createTestStore()
    const { fetchSourceStats } = await import('./uiSlice')

    // Act
    const promise = store.dispatch(fetchSourceStats())

    // Assert
    expect(store.getState().ui.isRefreshing).toBe(true)

    resolve(sampleStats)
    await promise
  })

  it('shows the refreshed source stats and stops spinning once the request resolves', async () => {
    // Arrange
    mockGetStats.mockResolvedValue(sampleStats)
    const store = await createTestStore()
    const { fetchSourceStats } = await import('./uiSlice')

    // Act
    await store.dispatch(fetchSourceStats())

    // Assert
    const state = store.getState().ui
    expect(state.sourceStats).toEqual(sampleStats)
    expect(state.isRefreshing).toBe(false)
  })

  it('stops the Refresh spinner when the source-stats request fails', async () => {
    // Arrange
    mockGetStats.mockRejectedValue(new Error('Disk unreadable'))
    const store = await createTestStore()
    const { fetchSourceStats } = await import('./uiSlice')

    // Act
    await store.dispatch(fetchSourceStats())

    // Assert
    expect(store.getState().ui.isRefreshing).toBe(false)
  })
})

describe('uiSlice selectors read the live ui state', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('reads the typed query, scope, sources, agent, and sort order back through their selectors', async () => {
    // Arrange — drive these fields into non-default values
    const store = await createTestStore()
    const {
      setSearchQuery,
      setSearchScope,
      setSelectedSources,
      selectAgent,
      toggleSortOrder,
      setSkillTypeFilter,
      toggleExcludedSkillTypeFilter,
      selectSearchQuery,
      selectSearchScope,
      selectSelectedSources,
      selectSelectedAgentId,
      selectSortOrder,
      selectSkillTypeFilter,
      selectExcludedSkillTypeFilters,
    } = await import('./uiSlice')
    // selectAgent resets skill-type filters, so set the type filters afterwards.
    store.dispatch(selectAgent('claude-code' as AgentId))
    store.dispatch(setSearchQuery('browser'))
    store.dispatch(setSearchScope('repo'))
    store.dispatch(setSelectedSources([repositoryId('vercel-labs/skills')]))
    store.dispatch(toggleSortOrder())
    store.dispatch(setSkillTypeFilter('symlinked'))
    store.dispatch(toggleExcludedSkillTypeFilter('gstack'))

    // Cast the ui-only test store to RootState; selectors only read state.ui.
    const rootState = store.getState() as RootState

    // Act + Assert — each selector returns the stored value
    expect(selectSearchQuery(rootState)).toBe('browser')
    expect(selectSearchScope(rootState)).toBe('repo')
    expect(selectSelectedSources(rootState)).toEqual([
      repositoryId('vercel-labs/skills'),
    ])
    expect(selectSelectedAgentId(rootState)).toBe('claude-code')
    expect(selectSortOrder(rootState)).toBe('desc')
    expect(selectSkillTypeFilter(rootState)).toBe('symlinked')
    expect(selectExcludedSkillTypeFilters(rootState)).toEqual(['gstack'])
  })

  it('reports the Refresh spinner is idle through selectIsRefreshing by default', async () => {
    // Arrange
    const store = await createTestStore()
    const { selectIsRefreshing } = await import('./uiSlice')

    // Act
    // Cast the ui-only test store to RootState; the selector only reads state.ui.
    const isRefreshing = selectIsRefreshing(store.getState() as RootState)

    // Assert
    expect(isRefreshing).toBe(false)
  })

  it('reads the sync flags and result back through their selectors after a sync runs', async () => {
    // Arrange — execute a sync so isSyncing settles false and syncResult fills
    mockSyncExecute.mockResolvedValue({
      success: true,
      created: 2,
      replaced: 0,
      skipped: 0,
      errors: [],
      details: [
        { skillName: 's', agentName: 'Claude Code', action: 'created' },
      ],
    } satisfies SyncExecuteResult)
    const store = await createTestStore()
    const {
      executeSyncAction,
      selectIsSyncing,
      selectSyncPreview,
      selectSyncResult,
    } = await import('./uiSlice')
    await store.dispatch(executeSyncAction({ replaceConflicts: [] }))

    // Cast the ui-only test store to RootState; selectors only read state.ui.
    const rootState = store.getState() as RootState

    // Act + Assert
    expect(selectIsSyncing(rootState)).toBe(false)
    expect(selectSyncPreview(rootState)).toBeNull()
    expect(selectSyncResult(rootState)).not.toBeNull()
  })

  it('reads the bookmark, bulk, cleanup, and dialog surfaces back through their selectors', async () => {
    // Arrange — seed the foreground surfaces; order avoids the mutual-exclusion clears
    const store = await createTestStore()
    const {
      setSelectedBookmarkForDetail,
      setBulkConfirm,
      enterBulkSelectMode,
      openSymlinkCleanupDialog,
      setCleanupAgentTarget,
      selectSelectedBookmarkForDetail,
      selectBulkConfirm,
      selectBulkSelectMode,
      selectCleanupAgentTarget,
      selectSymlinkCleanupDialogOpen,
    } = await import('./uiSlice')
    store.dispatch(
      setSelectedBookmarkForDetail({
        name: 'task',
        repo: repositoryId('vercel-labs/skills'),
        url: 'https://github.com/vercel-labs/skills',
        bookmarkedAt: '2026-04-01T08:00:00.000Z',
        isInstalled: false,
      }),
    )
    store.dispatch(
      setBulkConfirm({
        kind: 'delete',
        skillNames: ['task'],
        agentId: null,
        agentName: null,
        sourceSummary: null,
        deleteTargets: [deleteTarget('task' as Skill['name'])],
        orphanRecords: [],
        staleDeleteErrors: [],
        orphanErrors: [],
        protectedErrors: [],
      }),
    )
    store.dispatch(enterBulkSelectMode())
    // openSymlinkCleanupDialog clears cleanupAgentTarget, so set the target last.
    store.dispatch(openSymlinkCleanupDialog())
    store.dispatch(setCleanupAgentTarget('cursor' as AgentId))

    // Cast the ui-only test store to RootState; selectors only read state.ui.
    const rootState = store.getState() as RootState

    // Act + Assert
    expect(selectSelectedBookmarkForDetail(rootState)).not.toBeNull()
    expect(selectBulkConfirm(rootState)).not.toBeNull()
    expect(selectBulkSelectMode(rootState)).toBe(true)
    expect(selectCleanupAgentTarget(rootState)).toBe('cursor')
    // setCleanupAgentTarget closes the dashboard dialog (one surface at a time).
    expect(selectSymlinkCleanupDialogOpen(rootState)).toBe(false)
  })
})
