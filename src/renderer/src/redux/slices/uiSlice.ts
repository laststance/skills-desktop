import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'

import type {
  AgentId,
  AgentName,
  BookmarkedSkill,
  IsoTimestamp,
  SearchQuery,
  SkillName,
  SourceStats,
  SyncExecuteOptions,
  SyncExecuteResult,
  SyncPreviewResult,
  ToastId,
  TombstoneId,
} from '../../../../shared/types'
import type { RootState } from '../store'

import { deleteSelectedSkills, unlinkSelectedFromAgent } from './skillsSlice'

/** Bookmark with install status, used for the detail modal */
export type BookmarkForDetail = BookmarkedSkill & { isInstalled: boolean }

export type SortOrder = 'asc' | 'desc'
export type SkillTypeFilter = 'all' | 'symlinked' | 'local'
export type ActiveTab = 'installed' | 'marketplace'

/**
 * Shape used by the sonner-rendered UndoToast for bulk delete/unlink.
 * - `id`: sonner toast id (string | number); stored so we can imperatively dismiss
 *   from the slice when another competing surface claims the notification real estate.
 * - `kind`: drives the button label ("Undo delete" vs "Undo unlink") and whether
 *   `undoLastBulkDelete` is even wired up (unlink is not tombstoned).
 * - `skillNames` / `tombstoneIds`: the batch identity — tombstoneIds is empty for
 *   unlinks, populated for deletes. Parallel arrays are intentional (index-aligned).
 * - `expiresAt`: absolute ISO timestamp; the UndoToast renders a countdown from this.
 * - `summary`: pre-formatted display string ("Deleted 3 skills. 7 symlinks removed.").
 */
export interface UndoToastState {
  id: ToastId
  kind: 'delete' | 'unlink'
  skillNames: SkillName[]
  tombstoneIds: TombstoneId[]
  expiresAt: IsoTimestamp
  summary: string
}

/**
 * Pending bulk confirmation payload. Populated by the SelectionToolbar's
 * primary-action handler when the user clicks Delete/Unlink; the
 * `BulkConfirmDialog` in MainContent reads this to render the Radix
 * AlertDialog equivalent of the old `window.confirm` call (which is
 * discouraged in Electron renderers and blocks the event loop).
 * - `kind`: drives copy and which thunk to dispatch on confirm.
 * - `skillNames`: the exact argument to pass to the thunk on confirm.
 * - `agentId` / `agentName`: carried through so the unlink thunk knows which
 *   agent to target, and the dialog copy can mention the agent by name.
 */
export interface BulkConfirmState {
  kind: 'delete' | 'unlink'
  skillNames: SkillName[]
  agentId: AgentId | null
  agentName: AgentName | null
}

interface UiState {
  /** Active main content tab */
  activeTab: ActiveTab
  searchQuery: SearchQuery
  sourceStats: SourceStats | null
  isRefreshing: boolean
  /** Currently selected agent filter (null = global/all-agents view). */
  selectedAgentId: AgentId | null
  /** Sort direction for skill name (A→Z / Z→A) */
  sortOrder: SortOrder
  /** Filter by skill type in agent view (all / symlinked / local) */
  skillTypeFilter: SkillTypeFilter
  /** Whether sync operation is in progress */
  isSyncing: boolean
  /** Sync preview result (null when not previewing) */
  syncPreview: SyncPreviewResult | null
  /** Sync execution result for showing per-item diff (null when not displaying) */
  syncResult: SyncExecuteResult | null
  error: string | null
  /** Bookmark selected for detail modal (null when modal closed) */
  selectedBookmarkForDetail: BookmarkForDetail | null
  /**
   * Active undo toast after a bulk delete/unlink. Null when no toast is live.
   * Cleared atomically when any competing surface starts: a new bulk op, a sync
   * preview, an agent change, or a tab change (see extraReducers + reducers).
   */
  undoToast: UndoToastState | null
  /**
   * Pending bulk confirm dialog payload. Null when no dialog is open.
   * Cleared on tab/agent change (same rationale as `undoToast`).
   */
  bulkConfirm: BulkConfirmState | null
  /**
   * When true, skill cards render a checkbox and bulk selection shortcuts
   * (Cmd/Ctrl+A, Esc) are active. Default false so the list is clean for
   * users who never perform bulk operations. Cleared atomically alongside
   * `undoToast` / `bulkConfirm` / selection on any context switch that makes
   * the current selection stale (tab, agent, sync op, competing bulk op).
   */
  bulkSelectMode: boolean
}

const initialState: UiState = {
  activeTab: 'installed',
  searchQuery: '',
  sourceStats: null,
  isRefreshing: false,
  selectedAgentId: null,
  sortOrder: 'asc',
  skillTypeFilter: 'all',
  isSyncing: false,
  syncPreview: null,
  syncResult: null,
  error: null,
  selectedBookmarkForDetail: null,
  undoToast: null,
  bulkConfirm: null,
  bulkSelectMode: false,
}

/**
 * Fetch source directory statistics
 */
export const fetchSourceStats = createAsyncThunk(
  'ui/fetchSourceStats',
  async () => {
    return window.electron.source.getStats()
  },
)

/**
 * Preview sync: detect conflicts and count operations without executing
 * @returns SyncPreviewResult
 */
export const fetchSyncPreview = createAsyncThunk(
  'ui/fetchSyncPreview',
  async () => {
    return window.electron.sync.preview()
  },
)

/**
 * Execute sync with conflict resolution choices
 * @param options - replaceConflicts paths
 * @returns SyncExecuteResult
 */
export const executeSyncAction = createAsyncThunk(
  'ui/executeSyncAction',
  async (options: SyncExecuteOptions) => {
    return window.electron.sync.execute(options)
  },
)

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    setActiveTab: (state, action: PayloadAction<ActiveTab>) => {
      state.activeTab = action.payload
      // Tab switch is a hard context change; any surviving undo toast from the
      // previous tab is stale (user moved away from the list that owned it).
      state.undoToast = null
      // Same reasoning for an open bulk confirm — the ticked rows belong to
      // the previous tab's list.
      state.bulkConfirm = null
      // The bulk-select affordance is list-scoped; leaving the list exits mode.
      state.bulkSelectMode = false
    },
    setSearchQuery: (state, action: PayloadAction<SearchQuery>) => {
      state.searchQuery = action.payload
    },
    setRefreshing: (state, action: PayloadAction<boolean>) => {
      state.isRefreshing = action.payload
    },
    selectAgent: (state, action: PayloadAction<AgentId | null>) => {
      state.selectedAgentId = action.payload
      state.skillTypeFilter = 'all'
      // Agent change swaps the entire list out; an undo referencing names the
      // user can no longer see would be misleading. Dismiss the toast.
      state.undoToast = null
      // The pending confirm may target a different agent; abandon it.
      state.bulkConfirm = null
      // Selection is agent-scoped in skillsSlice; mode should follow.
      state.bulkSelectMode = false
    },
    toggleSortOrder: (state) => {
      state.sortOrder = state.sortOrder === 'asc' ? 'desc' : 'asc'
    },
    setSkillTypeFilter: (state, action: PayloadAction<SkillTypeFilter>) => {
      state.skillTypeFilter = action.payload
    },
    setSyncPreview: (
      state,
      action: PayloadAction<SyncPreviewResult | null>,
    ) => {
      state.syncPreview = action.payload
    },
    clearSyncResult: (state) => {
      state.syncResult = null
    },
    setSelectedBookmarkForDetail: (
      state,
      action: PayloadAction<BookmarkForDetail>,
    ) => {
      state.selectedBookmarkForDetail = action.payload
    },
    clearSelectedBookmarkForDetail: (state) => {
      state.selectedBookmarkForDetail = null
    },
    /**
     * Show the undo toast for the most recently completed bulk operation.
     * Fired by MainContent after deleteSelectedSkills/unlinkSelectedFromAgent
     * resolves, once the sonner `toast.custom(...)` id is known.
     */
    setUndoToast: (state, action: PayloadAction<UndoToastState>) => {
      state.undoToast = action.payload
    },
    /**
     * Dismiss the active undo toast without triggering a restore. Called from
     * the UndoToast's onTimeout callback (15s elapsed) or when the user clicks
     * the explicit close affordance.
     */
    clearUndoToast: (state) => {
      state.undoToast = null
    },
    /**
     * Open the bulk confirm dialog with the pending-action payload. The actual
     * thunk dispatch (deleteSelectedSkills / unlinkSelectedFromAgent) happens
     * in MainContent's onConfirm handler after the user approves the prompt.
     */
    setBulkConfirm: (state, action: PayloadAction<BulkConfirmState>) => {
      state.bulkConfirm = action.payload
    },
    /**
     * Close the bulk confirm dialog (user cancelled or confirmed; MainContent
     * clears the state immediately so the dialog unmounts before the async
     * thunk begins — avoids a visible flicker).
     */
    clearBulkConfirm: (state) => {
      state.bulkConfirm = null
    },
    /**
     * Enter bulk-select mode. Reveals checkboxes on skill cards and activates
     * Cmd/Ctrl+A and Esc keyboard shortcuts. Does not touch selection state —
     * the user starts with an empty tick set and explicitly builds it up.
     * @example dispatch(enterBulkSelectMode())
     */
    enterBulkSelectMode: (state) => {
      state.bulkSelectMode = true
    },
    /**
     * Exit bulk-select mode. Hides checkboxes and deactivates the shortcuts.
     * The caller (MainContent) is responsible for also dispatching
     * `clearSelection()` from skillsSlice — we intentionally do not
     * cross-dispatch across slices here, keeping each slice self-contained.
     * @example
     *   dispatch(exitBulkSelectMode())
     *   dispatch(clearSelection())
     */
    exitBulkSelectMode: (state) => {
      state.bulkSelectMode = false
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchSourceStats.fulfilled, (state, action) => {
        state.sourceStats = action.payload
      })
      .addCase(fetchSyncPreview.pending, (state) => {
        state.isSyncing = true
        // Close result dialog when starting a new sync preview (prevents overlapping dialogs)
        state.syncResult = null
        // A fresh sync attempt takes notification precedence; any pending undo is stale.
        state.undoToast = null
        // Close an open bulk confirm — sync conflict dialog will render on top.
        state.bulkConfirm = null
        // Sync preview supersedes bulk affordance; user's attention shifts.
        state.bulkSelectMode = false
      })
      .addCase(fetchSyncPreview.fulfilled, (state, action) => {
        state.syncPreview = action.payload
        // Preview phase complete — stop syncing so UI buttons are enabled.
        // executeSyncAction handles its own loading state via isExecuting (component-local).
        state.isSyncing = false
      })
      .addCase(fetchSyncPreview.rejected, (state, action) => {
        state.isSyncing = false
        state.error = action.error.message ?? 'Failed to fetch sync preview'
      })
      .addCase(executeSyncAction.fulfilled, (state, action) => {
        state.isSyncing = false
        state.syncPreview = null
        // Store result for SyncResultDialog to display per-item diff
        state.syncResult = action.payload
      })
      .addCase(executeSyncAction.rejected, (state, action) => {
        state.isSyncing = false
        state.syncResult = null
        state.error = action.error.message ?? 'Sync failed'
      })
      // ── Bulk delete/unlink: clear stale undo toast atomically ──────────
      // A new bulk operation supersedes any in-flight undo affordance. The
      // fresh fulfilled outcome will dispatch `setUndoToast` from MainContent.
      .addCase(deleteSelectedSkills.pending, (state) => {
        state.undoToast = null
        state.bulkConfirm = null
        // Bulk op committed — leaving mode ON would strand a checkbox column
        // over a fresh post-delete list the user is now observing for result.
        state.bulkSelectMode = false
      })
      .addCase(unlinkSelectedFromAgent.pending, (state) => {
        state.undoToast = null
        state.bulkConfirm = null
        state.bulkSelectMode = false
      })
  },
})

export const {
  setActiveTab,
  setSearchQuery,
  setRefreshing,
  selectAgent,
  toggleSortOrder,
  setSkillTypeFilter,
  setSyncPreview,
  clearSyncResult,
  setSelectedBookmarkForDetail,
  clearSelectedBookmarkForDetail,
  setUndoToast,
  clearUndoToast,
  setBulkConfirm,
  clearBulkConfirm,
  enterBulkSelectMode,
  exitBulkSelectMode,
} = uiSlice.actions
export default uiSlice.reducer

// --- Named selectors ---
export const selectActiveTab = (state: RootState): ActiveTab =>
  state.ui.activeTab
export const selectSearchQuery = (state: RootState): SearchQuery =>
  state.ui.searchQuery
export const selectSelectedAgentId = (state: RootState): AgentId | null =>
  state.ui.selectedAgentId
export const selectSourceStats = (state: RootState): SourceStats | null =>
  state.ui.sourceStats
export const selectIsRefreshing = (state: RootState): boolean =>
  state.ui.isRefreshing
export const selectIsSyncing = (state: RootState): boolean => state.ui.isSyncing
export const selectSyncPreview = (state: RootState): SyncPreviewResult | null =>
  state.ui.syncPreview
export const selectSyncResult = (state: RootState): SyncExecuteResult | null =>
  state.ui.syncResult
export const selectUiError = (state: RootState): string | null => state.ui.error
export const selectSortOrder = (state: RootState): SortOrder =>
  state.ui.sortOrder
export const selectSkillTypeFilter = (state: RootState): SkillTypeFilter =>
  state.ui.skillTypeFilter
export const selectSelectedBookmarkForDetail = (
  state: RootState,
): BookmarkForDetail | null => state.ui.selectedBookmarkForDetail
export const selectUndoToast = (state: RootState): UndoToastState | null =>
  state.ui.undoToast
export const selectBulkConfirm = (state: RootState): BulkConfirmState | null =>
  state.ui.bulkConfirm
export const selectBulkSelectMode = (state: RootState): boolean =>
  state.ui.bulkSelectMode
