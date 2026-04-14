import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'

import type {
  AgentId,
  BookmarkedSkill,
  SourceStats,
  SyncExecuteOptions,
  SyncPreviewResult,
} from '../../../../shared/types'
import type { RootState } from '../store'

/** Bookmark with install status, used for the detail modal */
export type BookmarkForDetail = BookmarkedSkill & { isInstalled: boolean }

export type SortOrder = 'asc' | 'desc'
export type SkillTypeFilter = 'all' | 'symlinked' | 'local'
export type ActiveTab = 'installed' | 'marketplace'

interface UiState {
  /** Active main content tab */
  activeTab: ActiveTab
  searchQuery: string
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
  error: string | null
  /** Bookmark selected for detail modal (null when modal closed) */
  selectedBookmarkForDetail: BookmarkForDetail | null
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
  error: null,
  selectedBookmarkForDetail: null,
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
    },
    setSearchQuery: (state, action: PayloadAction<string>) => {
      state.searchQuery = action.payload
    },
    setRefreshing: (state, action: PayloadAction<boolean>) => {
      state.isRefreshing = action.payload
    },
    selectAgent: (state, action: PayloadAction<AgentId | null>) => {
      state.selectedAgentId = action.payload
      state.skillTypeFilter = 'all'
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
    setSelectedBookmarkForDetail: (
      state,
      action: PayloadAction<BookmarkForDetail>,
    ) => {
      state.selectedBookmarkForDetail = action.payload
    },
    clearSelectedBookmarkForDetail: (state) => {
      state.selectedBookmarkForDetail = null
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchSourceStats.fulfilled, (state, action) => {
        state.sourceStats = action.payload
      })
      .addCase(fetchSyncPreview.pending, (state) => {
        state.isSyncing = true
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
      .addCase(executeSyncAction.fulfilled, (state) => {
        state.isSyncing = false
        state.syncPreview = null
      })
      .addCase(executeSyncAction.rejected, (state, action) => {
        state.isSyncing = false
        state.error = action.error.message ?? 'Sync failed'
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
  setSelectedBookmarkForDetail,
  clearSelectedBookmarkForDetail,
} = uiSlice.actions
export default uiSlice.reducer

// --- Named selectors ---
export const selectActiveTab = (state: RootState): ActiveTab =>
  state.ui.activeTab
export const selectSearchQuery = (state: RootState): string =>
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
export const selectUiError = (state: RootState): string | null => state.ui.error
export const selectSortOrder = (state: RootState): SortOrder =>
  state.ui.sortOrder
export const selectSkillTypeFilter = (state: RootState): SkillTypeFilter =>
  state.ui.skillTypeFilter
export const selectSelectedBookmarkForDetail = (
  state: RootState,
): BookmarkForDetail | null => state.ui.selectedBookmarkForDetail
