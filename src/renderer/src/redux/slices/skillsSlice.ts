import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'

import type { Skill, SymlinkInfo } from '../../../../shared/types'

interface SkillsState {
  items: Skill[]
  selectedSkill: Skill | null
  loading: boolean
  error: string | null
  /** Skill symlink info pending unlink confirmation */
  skillToUnlink: { skill: Skill; symlink: SymlinkInfo } | null
  /** Whether unlinking is in progress */
  unlinking: boolean
}

const initialState: SkillsState = {
  items: [],
  selectedSkill: null,
  loading: false,
  error: null,
  skillToUnlink: null,
  unlinking: false,
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
        // Clear selected skill if it was the one being unlinked
        if (state.selectedSkill?.name === action.payload.skillName) {
          state.selectedSkill = null
        }
        state.skillToUnlink = null
      })
      .addCase(unlinkSkillFromAgent.rejected, (state) => {
        state.unlinking = false
      })
  },
})

export const { selectSkill, setSkillToUnlink } = skillsSlice.actions
export default skillsSlice.reducer
