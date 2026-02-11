import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'

import type { Agent } from '../../../../shared/types'

interface AgentsState {
  items: Agent[]
  selectedAgent: Agent | null
  loading: boolean
  error: string | null
  /** Agent pending bulk symlink removal confirmation */
  agentToDelete: Agent | null
  /** Whether bulk deletion is in progress */
  deleting: boolean
}

const initialState: AgentsState = {
  items: [],
  selectedAgent: null,
  loading: false,
  error: null,
  agentToDelete: null,
  deleting: false,
}

/**
 * Fetch all agents from the main process
 */
export const fetchAgents = createAsyncThunk('agents/fetchAll', async () => {
  const agents = await window.electron.agents.getAll()
  return agents as Agent[]
})

/**
 * Remove all symlinks from a specific agent
 * @param agent - Agent to remove all symlinks from
 * @returns Agent name and removed count for toast notification
 */
export const removeAllSymlinksFromAgent = createAsyncThunk(
  'agents/removeAllSymlinks',
  async (agent: Agent) => {
    const result = await window.electron.skills.removeAllFromAgent({
      agentId: agent.id,
      agentPath: agent.path,
    })
    if (!result.success) {
      throw new Error(result.error || 'Failed to remove symlinks')
    }
    return { agentName: agent.name, removedCount: result.removedCount }
  },
)

const agentsSlice = createSlice({
  name: 'agents',
  initialState,
  reducers: {
    selectAgent: (state, action: PayloadAction<Agent | null>) => {
      state.selectedAgent = action.payload
    },
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
      .addCase(removeAllSymlinksFromAgent.rejected, (state) => {
        state.deleting = false
      })
  },
})

export const { selectAgent, setAgentToDelete } = agentsSlice.actions
export default agentsSlice.reducer
