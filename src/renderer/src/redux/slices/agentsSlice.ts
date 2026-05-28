import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'

import type { RootState } from '@/renderer/src/redux/store'
import type { Agent } from '@/shared/types'

/**
 * Redux state for the Agents feature area.
 * Tracks the list of discovered agents and the agent currently queued
 * for a destructive "remove all symlinks" action.
 */
interface AgentsState {
  /** All agents discovered on disk (skillsDir presence determines `exists`). */
  items: Agent[]
  /** true while the initial `fetchAgents` is in flight. */
  loading: boolean
  /** Human-readable error from the last failed thunk. */
  error: string | null
  /** Agent queued for skills-folder deletion confirmation (modal target). */
  agentToDelete: Agent | null
  /** true while a removeAllFromAgent IPC round-trip is in flight. */
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
    if (!agent.filesystemIdentity) {
      throw new Error(
        'Agent skills folder changed since review. Rescan before deleting.',
      )
    }
    const result = await window.electron.skills.removeAllFromAgent({
      agentId: agent.id,
      agentPath: agent.path,
      filesystemIdentity: agent.filesystemIdentity,
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
