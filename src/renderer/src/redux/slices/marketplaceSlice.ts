import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'

import type {
  LeaderboardData,
  RankingFilter,
  SearchQuery,
  SkillSearchResult,
  InstallOptions,
  InstallProgress,
  MarketplaceStatus,
} from '../../../../shared/types'

/** Cache TTL: 30 minutes in milliseconds */
const CACHE_TTL_MS = 30 * 60 * 1000

interface MarketplaceState {
  /** Current marketplace operation state (search / install / idle). */
  status: MarketplaceStatus
  /** Live value of the search input. */
  searchQuery: SearchQuery
  /** Results from the most recent `skills find` call. */
  searchResults: SkillSearchResult[]
  /** Skill chosen in the install modal. */
  selectedSkill: SkillSearchResult | null
  /** Skill selected for right-pane webview preview (separate from install modal). */
  previewSkill: SkillSearchResult | null
  /** Live progress for an in-flight install, or null when idle. */
  installProgress: InstallProgress | null
  /** Human-readable error from the last failed operation. */
  error: string | null
  /** Per-filter leaderboard cache. Each filter tracks its own data and loading state. */
  leaderboard: Partial<Record<RankingFilter, LeaderboardData>>
}

const initialState: MarketplaceState = {
  status: 'idle',
  searchQuery: '',
  searchResults: [],
  selectedSkill: null,
  previewSkill: null,
  installProgress: null,
  error: null,
  leaderboard: {},
}

/**
 * Search for skills in the marketplace
 * @param query - Search query string
 * @returns Promise<SkillSearchResult[]> - Array of matching skills
 */
export const searchSkills = createAsyncThunk(
  'marketplace/search',
  async (query: SearchQuery) => {
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
 * Fetch leaderboard data from skills.sh for a ranking filter.
 * Respects per-filter cache TTL: skips fetch if cached data is fresh.
 * @param filter - Ranking filter ('all-time' | 'trending' | 'hot')
 * @returns Skills array and filter, or null if cache is fresh
 */
export const loadLeaderboard = createAsyncThunk(
  'marketplace/loadLeaderboard',
  async (
    filter: RankingFilter,
    { getState },
  ): Promise<{ skills: SkillSearchResult[]; filter: RankingFilter } | null> => {
    const state = (getState() as { marketplace: MarketplaceState }).marketplace
    const cached = state.leaderboard[filter]

    // Skip fetch if cache is fresh
    if (
      cached &&
      cached.status !== 'error' &&
      Date.now() - cached.lastFetched < CACHE_TTL_MS
    ) {
      return null
    }

    const skills = await window.electron.marketplace.leaderboard({ filter })
    return { skills, filter }
  },
)

const marketplaceSlice = createSlice({
  name: 'marketplace',
  initialState,
  reducers: {
    setSearchQuery: (state, action: PayloadAction<SearchQuery>) => {
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
    setPreviewSkill: (
      state,
      action: PayloadAction<SkillSearchResult | null>,
    ) => {
      state.previewSkill = action.payload
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
      .addCase(installSkill.fulfilled, (state, action) => {
        state.installProgress = null
        if (action.payload) {
          state.status = 'idle'
          state.selectedSkill = null
          state.previewSkill = null
        } else {
          state.status = 'error'
          state.error = 'Installation failed'
        }
      })
      .addCase(installSkill.rejected, (state, action) => {
        state.status = 'error'
        state.error = action.error.message || 'Installation failed'
        state.installProgress = null
      })
      // Leaderboard
      .addCase(loadLeaderboard.pending, (state, action) => {
        const filter = action.meta.arg
        const existing = state.leaderboard[filter]
        // Only show loading if no cached data exists yet
        if (!existing || existing.skills.length === 0) {
          state.leaderboard[filter] = {
            skills: [],
            lastFetched: 0,
            filter,
            status: 'loading',
          }
        }
      })
      .addCase(loadLeaderboard.fulfilled, (state, action) => {
        // null means cache was fresh, no update needed
        if (action.payload === null) return
        const { skills, filter } = action.payload
        state.leaderboard[filter] = {
          skills,
          lastFetched: Date.now(),
          filter,
          status: 'idle',
        }
      })
      .addCase(loadLeaderboard.rejected, (state, action) => {
        const filter = action.meta.arg
        const existing = state.leaderboard[filter]
        if (existing) {
          // Keep stale data, just mark status as error
          existing.status = 'error'
          existing.error = action.error.message || 'Failed to load leaderboard'
        } else {
          state.leaderboard[filter] = {
            skills: [],
            lastFetched: 0,
            filter,
            status: 'error',
            error: action.error.message || 'Failed to load leaderboard',
          }
        }
      })
  },
})

export const {
  setSearchQuery,
  selectSkillForInstall,
  setPreviewSkill,
  setInstallProgress,
  cancelOperation,
  clearError,
  clearSearchResults,
} = marketplaceSlice.actions

export default marketplaceSlice.reducer
