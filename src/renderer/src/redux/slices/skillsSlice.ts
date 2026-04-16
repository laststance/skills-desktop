import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'

import type { AgentId, Skill, SymlinkInfo } from '../../../../shared/types'
import type { RootState } from '../store'

/**
 * Redux state for the Installed Skills feature area.
 * Pairs "currently selected" entities with per-operation in-flight flags
 * so the UI can disable inputs and show spinners deterministically.
 */
interface SkillsState {
  /** All skills discovered under ~/.agents/skills/. */
  items: Skill[]
  /** Skill highlighted in the list (null = no selection). */
  selectedSkill: Skill | null
  /** true while the initial `fetchSkills` is in flight. */
  loading: boolean
  /** Human-readable error from the last failed thunk. */
  error: string | null
  /** Skill + symlink queued for unlink confirmation (modal target). */
  skillToUnlink: { skill: Skill; symlink: SymlinkInfo } | null
  /** true while an unlink IPC round-trip is in flight. */
  unlinking: boolean
  /** Skill queued for delete confirmation. */
  skillToDelete: Skill | null
  /** true while a deleteSkill IPC round-trip is in flight. */
  deleting: boolean
  /** Skill targeted by the AddSymlinkModal. */
  skillToAddSymlinks: Skill | null
  /** true while createSymlinks is in flight. */
  addingSymlinks: boolean
  /** Skill targeted by the CopyToAgentsModal. */
  skillToCopy: Skill | null
  /** true while copyToAgents is in flight. */
  copying: boolean
}

const initialState: SkillsState = {
  items: [],
  selectedSkill: null,
  loading: false,
  error: null,
  skillToUnlink: null,
  unlinking: false,
  skillToDelete: null,
  deleting: false,
  skillToAddSymlinks: null,
  addingSymlinks: false,
  skillToCopy: null,
  copying: false,
}

/**
 * Fetch all skills from the main process
 * @returns Promise<Skill[]> - Array of skill objects from ~/.agents/skills/
 */
export const fetchSkills = createAsyncThunk('skills/fetchAll', async () => {
  return window.electron.skills.getAll()
})

/**
 * Unlink a skill from a specific agent
 * @param params - skill and symlink info
 * @returns Promise with success status
 */
export const unlinkSkillFromAgent = createAsyncThunk(
  'skills/unlinkFromAgent',
  async (params: { skill: Skill; symlink: SymlinkInfo }) => {
    const { skill, symlink } = params
    const result = await window.electron.skills.unlinkFromAgent({
      skillName: skill.name,
      agentId: symlink.agentId,
      linkPath: symlink.linkPath,
    })
    if (!result.success) {
      throw new Error(result.error || 'Failed to unlink skill')
    }
    return { skillName: skill.name, agentName: symlink.agentName }
  },
)

/**
 * Delete a skill entirely: source dir + all agent symlinks/copies
 * @param skill - Skill to delete
 * @returns Skill name and symlinks removed count
 */
export const deleteSkill = createAsyncThunk(
  'skills/deleteSkill',
  async (skill: Skill) => {
    const result = await window.electron.skills.deleteSkill({
      skillName: skill.name,
      skillPath: skill.path,
    })
    if (!result.success) {
      throw new Error(result.error || 'Failed to delete skill')
    }
    return {
      skillName: skill.name,
      symlinksRemoved: result.symlinksRemoved,
    }
  },
)

/**
 * Create symlinks for a skill to multiple agents
 * @param params - skill and target agent IDs
 * @returns Created count and failures
 */
export const createSymlinks = createAsyncThunk(
  'skills/createSymlinks',
  async (params: { skill: Skill; agentIds: AgentId[] }) => {
    const { skill, agentIds } = params
    const result = await window.electron.skills.createSymlinks({
      skillName: skill.name,
      skillPath: skill.path,
      agentIds,
    })
    if (!result.success && result.created === 0) {
      throw new Error('Failed to create any symlinks')
    }
    return {
      skillName: skill.name,
      created: result.created,
      failures: result.failures,
    }
  },
)

/**
 * Copy a skill from one agent to other agents
 * @param params - skill, linkPath of source, and target agent IDs
 * @returns Copied count and failures
 */
export const copyToAgents = createAsyncThunk(
  'skills/copyToAgents',
  async (params: { skill: Skill; linkPath: string; agentIds: AgentId[] }) => {
    const { skill, linkPath, agentIds } = params
    const result = await window.electron.skills.copyToAgents({
      skillName: skill.name,
      linkPath,
      targetAgentIds: agentIds,
    })
    if (!result.success && result.copied === 0) {
      throw new Error('Failed to copy to any agent')
    }
    return {
      skillName: skill.name,
      copied: result.copied,
      failures: result.failures,
    }
  },
)

const skillsSlice = createSlice({
  name: 'skills',
  initialState,
  reducers: {
    selectSkill: (state, action: PayloadAction<Skill | null>) => {
      state.selectedSkill = action.payload
    },
    setSkillToUnlink: (
      state,
      action: PayloadAction<{ skill: Skill; symlink: SymlinkInfo } | null>,
    ) => {
      state.skillToUnlink = action.payload
    },
    setSkillToDelete: (state, action: PayloadAction<Skill | null>) => {
      state.skillToDelete = action.payload
    },
    setSkillToAddSymlinks: (state, action: PayloadAction<Skill | null>) => {
      state.skillToAddSymlinks = action.payload
    },
    setSkillToCopy: (state, action: PayloadAction<Skill | null>) => {
      state.skillToCopy = action.payload
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchSkills.pending, (state) => {
        state.loading = true
        state.error = null
      })
      .addCase(fetchSkills.fulfilled, (state, action) => {
        state.items = action.payload
        state.loading = false
      })
      .addCase(fetchSkills.rejected, (state, action) => {
        state.loading = false
        state.error = action.error.message || 'Failed to fetch skills'
      })
      // Unlink skill from agent
      .addCase(unlinkSkillFromAgent.pending, (state) => {
        state.unlinking = true
      })
      .addCase(unlinkSkillFromAgent.fulfilled, (state, action) => {
        state.unlinking = false
        if (state.selectedSkill?.name === action.payload.skillName) {
          state.selectedSkill = null
        }
        state.skillToUnlink = null
      })
      .addCase(unlinkSkillFromAgent.rejected, (state, action) => {
        state.unlinking = false
        state.error = action.error.message ?? 'Failed to unlink skill'
      })
      // Delete skill
      .addCase(deleteSkill.pending, (state) => {
        state.deleting = true
      })
      .addCase(deleteSkill.fulfilled, (state, action) => {
        state.deleting = false
        if (state.selectedSkill?.name === action.payload.skillName) {
          state.selectedSkill = null
        }
        state.skillToDelete = null
      })
      .addCase(deleteSkill.rejected, (state, action) => {
        state.deleting = false
        state.error = action.error.message ?? 'Failed to delete skill'
      })
      // Create symlinks
      .addCase(createSymlinks.pending, (state) => {
        state.addingSymlinks = true
      })
      .addCase(createSymlinks.fulfilled, (state) => {
        state.addingSymlinks = false
        state.skillToAddSymlinks = null
      })
      .addCase(createSymlinks.rejected, (state, action) => {
        state.addingSymlinks = false
        state.error = action.error.message ?? 'Failed to create symlinks'
      })
      // Copy to agents
      .addCase(copyToAgents.pending, (state) => {
        state.copying = true
      })
      .addCase(copyToAgents.fulfilled, (state) => {
        state.copying = false
        state.skillToCopy = null
      })
      .addCase(copyToAgents.rejected, (state, action) => {
        state.copying = false
        state.error = action.error.message ?? 'Failed to copy skill'
      })
  },
})

export const {
  selectSkill,
  setSkillToUnlink,
  setSkillToDelete,
  setSkillToAddSymlinks,
  setSkillToCopy,
} = skillsSlice.actions
export default skillsSlice.reducer

// --- Named selectors ---
export const selectSkillsItems = (state: RootState): Skill[] =>
  state.skills.items
export const selectSkillsLoading = (state: RootState): boolean =>
  state.skills.loading
export const selectSkillsError = (state: RootState): string | null =>
  state.skills.error
export const selectSelectedSkill = (state: RootState): Skill | null =>
  state.skills.selectedSkill
export const selectSkillToDelete = (state: RootState): Skill | null =>
  state.skills.skillToDelete
export const selectSkillsDeleting = (state: RootState): boolean =>
  state.skills.deleting
export const selectSkillToUnlink = (
  state: RootState,
): { skill: Skill; symlink: SymlinkInfo } | null => state.skills.skillToUnlink
export const selectSkillsUnlinking = (state: RootState): boolean =>
  state.skills.unlinking
export const selectSkillToAddSymlinks = (state: RootState): Skill | null =>
  state.skills.skillToAddSymlinks
export const selectSkillsAddingSymlinks = (state: RootState): boolean =>
  state.skills.addingSymlinks
export const selectSkillToCopy = (state: RootState): Skill | null =>
  state.skills.skillToCopy
export const selectSkillsCopying = (state: RootState): boolean =>
  state.skills.copying
