import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'

import type { SourceStats } from '../../../../shared/types'

interface UiState {
  searchQuery: string
  sourceStats: SourceStats | null
  isRefreshing: boolean
  selectedAgentId: string | null
}

const initialState: UiState = {
  searchQuery: '',
  sourceStats: null,
  isRefreshing: false,
  selectedAgentId: null,
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
  },
  extraReducers: (builder) => {
    builder.addCase(fetchSourceStats.fulfilled, (state, action) => {
      state.sourceStats = action.payload
    })
  },
})

export const { setSearchQuery, setRefreshing, selectAgent } = uiSlice.actions
export default uiSlice.reducer
