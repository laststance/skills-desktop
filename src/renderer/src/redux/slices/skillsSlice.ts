import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'

import type { Skill } from '../../../../shared/types'

interface SkillsState {
  items: Skill[]
  selectedSkill: Skill | null
  loading: boolean
  error: string | null
}

const initialState: SkillsState = {
  items: [],
  selectedSkill: null,
  loading: false,
  error: null,
}

/**
 * Fetch all skills from the main process
 * @returns Promise<Skill[]> - Array of skill objects from ~/.agents/skills/
 */
export const fetchSkills = createAsyncThunk('skills/fetchAll', async () => {
  const skills = await window.electron.skills.getAll()
  return skills as Skill[]
})

const skillsSlice = createSlice({
  name: 'skills',
  initialState,
  reducers: {
    selectSkill: (state, action: PayloadAction<Skill | null>) => {
      state.selectedSkill = action.payload
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
  },
})

export const { selectSkill } = skillsSlice.actions
export default skillsSlice.reducer
