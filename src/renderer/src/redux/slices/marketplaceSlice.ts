import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'

import type {
  SkillSearchResult,
  InstallOptions,
  InstallProgress,
  MarketplaceStatus,
} from '../../../../shared/types'

interface MarketplaceState {
  status: MarketplaceStatus
  searchQuery: string
  searchResults: SkillSearchResult[]
  selectedSkill: SkillSearchResult | null
  installProgress: InstallProgress | null
  skillToRemove: string | null
  error: string | null
}

const initialState: MarketplaceState = {
  status: 'idle',
  searchQuery: '',
  searchResults: [],
  selectedSkill: null,
  installProgress: null,
  skillToRemove: null,
  error: null,
}

/**
 * Search for skills in the marketplace
 * @param query - Search query string
 * @returns Promise<SkillSearchResult[]> - Array of matching skills
 */
export const searchSkills = createAsyncThunk(
  'marketplace/search',
  async (query: string) => {
    const results = await window.electron.skillsCli.search(query)
    return results
  },
)

/**
 * Install a skill from the marketplace
 * @param options - Installation options including repo, global flag, and agents
 * @returns Promise<boolean> - Success status
 */
export const installSkill = createAsyncThunk(
  'marketplace/install',
  async (options: InstallOptions) => {
    const result = await window.electron.skillsCli.install(options)
    return result.success
  },
)

/**
 * Remove an installed skill
 * @param skillName - Name of the skill to remove
 * @returns Promise<boolean> - Success status
 */
export const removeSkill = createAsyncThunk(
  'marketplace/remove',
  async (skillName: string) => {
    const result = await window.electron.skillsCli.remove(skillName)
    return result.success
  },
)

const marketplaceSlice = createSlice({
  name: 'marketplace',
  initialState,
  reducers: {
    setSearchQuery: (state, action: PayloadAction<string>) => {
      state.searchQuery = action.payload
    },
    selectSkillForInstall: (
      state,
      action: PayloadAction<SkillSearchResult | null>,
    ) => {
      state.selectedSkill = action.payload
    },
    setInstallProgress: (
      state,
      action: PayloadAction<InstallProgress | null>,
    ) => {
      state.installProgress = action.payload
    },
    setSkillToRemove: (state, action: PayloadAction<string | null>) => {
      state.skillToRemove = action.payload
    },
    cancelOperation: (state) => {
      window.electron.skillsCli.cancel()
      state.status = 'idle'
      state.installProgress = null
    },
    clearError: (state) => {
      state.error = null
      state.status = 'idle'
    },
    clearSearchResults: (state) => {
      state.searchResults = []
      state.searchQuery = ''
    },
  },
  extraReducers: (builder) => {
    builder
      // Search
      .addCase(searchSkills.pending, (state) => {
        state.status = 'searching'
        state.error = null
      })
      .addCase(searchSkills.fulfilled, (state, action) => {
        state.status = 'idle'
        state.searchResults = action.payload
      })
      .addCase(searchSkills.rejected, (state, action) => {
        state.status = 'error'
        state.error = action.error.message || 'Search failed'
      })
      // Install
      .addCase(installSkill.pending, (state) => {
        state.status = 'installing'
        state.error = null
      })
      .addCase(installSkill.fulfilled, (state) => {
        state.status = 'idle'
        state.selectedSkill = null
        state.installProgress = null
      })
      .addCase(installSkill.rejected, (state, action) => {
        state.status = 'error'
        state.error = action.error.message || 'Installation failed'
        state.installProgress = null
      })
      // Remove
      .addCase(removeSkill.pending, (state) => {
        state.status = 'removing'
        state.error = null
      })
      .addCase(removeSkill.fulfilled, (state) => {
        state.status = 'idle'
        state.skillToRemove = null
      })
      .addCase(removeSkill.rejected, (state, action) => {
        state.status = 'error'
        state.error = action.error.message || 'Remove failed'
        state.skillToRemove = null
      })
  },
})

export const {
  setSearchQuery,
  selectSkillForInstall,
  setInstallProgress,
  setSkillToRemove,
  cancelOperation,
  clearError,
  clearSearchResults,
} = marketplaceSlice.actions

export default marketplaceSlice.reducer
