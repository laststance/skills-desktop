import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'

import type { RootState } from '@/renderer/src/redux/store'
import type { AbsolutePath, Agent } from '@/shared/types'

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
 * Collect protected slots that physically live inside the selected agent folder so main can preserve those direct children while deleting everything else.
 * @param state - Current Redux state containing protected names and scanned skills.
 * @param agent - Agent whose skills folder is being deleted.
 * @returns Absolute agent slot paths that should survive folder deletion.
 * @example collectProtectedAgentSlotPaths(state, cursorAgent)
 */
function collectProtectedAgentSlotPaths(
  state: RootState,
  agent: Agent,
): AbsolutePath[] {
  const protectedNames = new Set(state.protect.items)

  return state.skills.items
    .filter((skill) => protectedNames.has(skill.name))
    .flatMap((skill) =>
      skill.symlinks
        .filter(
          (symlink) =>
            symlink.agentId === agent.id && symlink.status !== 'missing',
        )
        .map((symlink) => symlink.linkPath),
    )
}

/**
 * Delete a specific agent's entire skills folder
 * @param agent - Agent whose skills folder will be deleted
 * @returns Agent name and removed item count for toast notification
 */
export const removeAllSymlinksFromAgent = createAsyncThunk(
  'agents/removeAllSymlinks',
  async (agent: Agent, { getState }) => {
    if (!agent.filesystemIdentity) {
      throw new Error(
        'Agent skills folder changed since review. Rescan before deleting.',
      )
    }
    const state = getState() as RootState
    const protectedSkillPaths = collectProtectedAgentSlotPaths(state, agent)
    const result = await window.electron.skills.removeAllFromAgent({
      agentId: agent.id,
      agentPath: agent.path,
      filesystemIdentity: agent.filesystemIdentity,
      protectedSkillPaths,
    })
    if (!result.success) {
      throw new Error(result.error || 'Failed to delete skills folder')
    }
    return {
      agentName: agent.name,
      removedCount: result.removedCount,
      preservedCount: result.preservedCount ?? 0,
    }
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
        /* v8 ignore next -- getAll() rejection always carries a populated Error.message in normal app flow; the empty-message fallback never fires */
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
        /* v8 ignore next -- every reject path (identity guard, line-59 `||` fallback, IPC rejection) supplies a non-empty Error.message; the nullish fallback never fires in normal app flow */
        state.error = action.error.message ?? 'Failed to remove symlinks'
      })
  },
})

export const { setAgentToDelete } = agentsSlice.actions
export default agentsSlice.reducer

// --- Named selectors ---
export const selectAgentItems = (state: RootState): Agent[] =>
  state.agents.items
