import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'

import type { AgentId, Skill, SymlinkInfo } from '../../../../shared/types'

interface SkillsState {
  items: Skill[]
  selectedSkill: Skill | null
  loading: boolean
  error: string | null
  /** Skill symlink info pending unlink confirmation */
  skillToUnlink: { skill: Skill; symlink: SymlinkInfo } | null
  /** Whether unlinking is in progress */
  unlinking: boolean
  /** Skill pending delete confirmation */
  skillToDelete: Skill | null
  /** Whether deletion is in progress */
  deleting: boolean
  /** Skill to add symlinks for (opens AddSymlinkModal) */
  skillToAddSymlinks: Skill | null
  /** Whether symlink creation is in progress */
  addingSymlinks: boolean
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
}

/**
 * Fetch all skills from the main process
 * @returns Promise<Skill[]> - Array of skill objects from ~/.agents/skills/
 */
export const fetchSkills = createAsyncThunk('skills/fetchAll', async () => {
  const skills = await window.electron.skills.getAll()
  return skills as Skill[]
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
      .addCase(unlinkSkillFromAgent.rejected, (state) => {
        state.unlinking = false
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
      .addCase(deleteSkill.rejected, (state) => {
        state.deleting = false
      })
      // Create symlinks
      .addCase(createSymlinks.pending, (state) => {
        state.addingSymlinks = true
      })
      .addCase(createSymlinks.fulfilled, (state) => {
        state.addingSymlinks = false
        state.skillToAddSymlinks = null
      })
      .addCase(createSymlinks.rejected, (state) => {
        state.addingSymlinks = false
      })
  },
})

export const {
  selectSkill,
  setSkillToUnlink,
  setSkillToDelete,
  setSkillToAddSymlinks,
} = skillsSlice.actions
export default skillsSlice.reducer
