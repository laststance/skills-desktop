import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'

import type {
  SourceStats,
  SyncExecuteOptions,
  SyncPreviewResult,
} from '../../../../shared/types'

interface UiState {
  searchQuery: string
  sourceStats: SourceStats | null
  isRefreshing: boolean
  selectedAgentId: string | null
  /** Whether sync operation is in progress */
  isSyncing: boolean
  /** Sync preview result (null when not previewing) */
  syncPreview: SyncPreviewResult | null
}

const initialState: UiState = {
  searchQuery: '',
  sourceStats: null,
  isRefreshing: false,
  selectedAgentId: null,
  isSyncing: false,
  syncPreview: null,
}

/**
 * Fetch source directory statistics
 */
export const fetchSourceStats = createAsyncThunk(
  'ui/fetchSourceStats',
  async () => {
    const stats = await window.electron.source.getStats()
    return stats as SourceStats
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
      .addCase(fetchSyncPreview.rejected, (state) => {
        state.isSyncing = false
      })
      .addCase(executeSyncAction.fulfilled, (state) => {
        state.isSyncing = false
        state.syncPreview = null
      })
      .addCase(executeSyncAction.rejected, (state) => {
        state.isSyncing = false
      })
  },
})

export const { setSearchQuery, setRefreshing, selectAgent, setSyncPreview } =
  uiSlice.actions
export default uiSlice.reducer
