import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'

import type { Agent } from '../../../../shared/types'
import type { RootState } from '../store'

interface AgentsState {
  items: Agent[]
  loading: boolean
  error: string | null
  /** Agent pending skills folder deletion confirmation */
  agentToDelete: Agent | null
  /** Whether folder deletion is in progress */
  deleting: boolean
}

const initialState: AgentsState = {
  items: [],
  loading: false,
  error: null,
  agentToDelete: null,
  deleting: false,
}

/**
 * Fetch all agents from the main process
 */
export const fetchAgents = createAsyncThunk('agents/fetchAll', async () => {
  return window.electron.agents.getAll()
})

/**
 * Delete a specific agent's entire skills folder
 * @param agent - Agent whose skills folder will be deleted
 * @returns Agent name and removed item count for toast notification
 */
export const removeAllSymlinksFromAgent = createAsyncThunk(
  'agents/removeAllSymlinks',
  async (agent: Agent) => {
    const result = await window.electron.skills.removeAllFromAgent({
      agentId: agent.id,
      agentPath: agent.path,
    })
    if (!result.success) {
      throw new Error(result.error || 'Failed to delete skills folder')
    }
    return { agentName: agent.name, removedCount: result.removedCount }
  },
)

const agentsSlice = createSlice({
  name: 'agents',
  initialState,
  reducers: {
    setAgentToDelete: (state, action: PayloadAction<Agent | null>) => {
      state.agentToDelete = action.payload
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
      .addCase(removeAllSymlinksFromAgent.pending, (state) => {
        state.deleting = true
      })
      .addCase(removeAllSymlinksFromAgent.fulfilled, (state) => {
        state.deleting = false
        state.agentToDelete = null
      })
      .addCase(removeAllSymlinksFromAgent.rejected, (state, action) => {
        state.deleting = false
        state.error = action.error.message ?? 'Failed to remove symlinks'
      })
  },
})

export const { setAgentToDelete } = agentsSlice.actions
export default agentsSlice.reducer

// --- Named selectors ---
export const selectAgentItems = (state: RootState): Agent[] =>
  state.agents.items
export const selectAgentsLoading = (state: RootState): boolean =>
  state.agents.loading
export const selectAgentToDelete = (state: RootState): Agent | null =>
  state.agents.agentToDelete
export const selectAgentsDeleting = (state: RootState): boolean =>
  state.agents.deleting
