import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'

import type {
  BookmarkedSkill,
  SourceStats,
  SyncExecuteOptions,
  SyncPreviewResult,
} from '../../../../shared/types'
import type { RootState } from '../store'

/** Bookmark with install status, used for the detail modal */
export type BookmarkForDetail = BookmarkedSkill & { isInstalled: boolean }

interface UiState {
  searchQuery: string
  sourceStats: SourceStats | null
  isRefreshing: boolean
  selectedAgentId: string | null
  /** Whether sync operation is in progress */
  isSyncing: boolean
  /** Sync preview result (null when not previewing) */
  syncPreview: SyncPreviewResult | null
  error: string | null
  /** Bookmark selected for detail modal (null when modal closed) */
  selectedBookmarkForDetail: BookmarkForDetail | null
}

const initialState: UiState = {
  searchQuery: '',
  sourceStats: null,
  isRefreshing: false,
  selectedAgentId: null,
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
    setSearchQuery: (state, action: PayloadAction<string>) => {
      state.searchQuery = action.payload
    },
    setRefreshing: (state, action: PayloadAction<boolean>) => {
      state.isRefreshing = action.payload
    },
    selectAgent: (state, action: PayloadAction<string | null>) => {
      state.selectedAgentId = action.payload
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
  setSearchQuery,
  setRefreshing,
  selectAgent,
  setSyncPreview,
  setSelectedBookmarkForDetail,
  clearSelectedBookmarkForDetail,
} = uiSlice.actions
export default uiSlice.reducer

// --- Named selectors ---
export const selectSearchQuery = (state: RootState): string =>
  state.ui.searchQuery
export const selectSelectedAgentId = (state: RootState): string | null =>
  state.ui.selectedAgentId
export const selectSourceStats = (state: RootState): SourceStats | null =>
  state.ui.sourceStats
export const selectIsRefreshing = (state: RootState): boolean =>
  state.ui.isRefreshing
export const selectIsSyncing = (state: RootState): boolean => state.ui.isSyncing
export const selectSyncPreview = (state: RootState): SyncPreviewResult | null =>
  state.ui.syncPreview
export const selectUiError = (state: RootState): string | null => state.ui.error
export const selectSelectedBookmarkForDetail = (
  state: RootState,
): BookmarkForDetail | null => state.ui.selectedBookmarkForDetail
