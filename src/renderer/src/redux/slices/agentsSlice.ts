import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'

import type { Agent } from '../../../../shared/types'

interface AgentsState {
  items: Agent[]
  selectedAgent: Agent | null
  loading: boolean
  error: string | null
}

const initialState: AgentsState = {
  items: [],
  selectedAgent: null,
  loading: false,
  error: null,
}

/**
 * Fetch all agents from the main process
 */
export const fetchAgents = createAsyncThunk('agents/fetchAll', async () => {
  const agents = await window.electron.agents.getAll()
  return agents as Agent[]
})

const agentsSlice = createSlice({
  name: 'agents',
  initialState,
  reducers: {
    selectAgent: (state, action: PayloadAction<Agent | null>) => {
      state.selectedAgent = action.payload
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchAgents.pending, (state) => {
        state.loading = true
        state.error = null
      })
      .addCase(fetchAgents.fulfilled, (state, action) => {
        state.items = action.payload
        state.loading = false
      })
      .addCase(fetchAgents.rejected, (state, action) => {
        state.loading = false
        state.error = action.error.message || 'Failed to fetch agents'
      })
  },
})

export const { selectAgent } = agentsSlice.actions
export default agentsSlice.reducer
