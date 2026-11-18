import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'

import type {
  LeaderboardData,
  RankingFilter,
  SearchQuery,
  SkillSearchResult,
  InstallIntent,
  InstallOptions,
  InstallProgress,
  MarketplaceStatus,
} from '@/shared/types'
import { toSearchQuery, toUnixTimestampMs } from '@/shared/types'

/** Cache TTL: 30 minutes in milliseconds */
const CACHE_TTL_MS = 30 * 60 * 1000

/**
 * Per-filter leaderboard cache. Indexed by `RankingFilter`; each entry
 * carries its own `lastFetched` timestamp and `status` so the three tabs
 * (`all-time` / `trending` / `hot`) load and expire independently.
 * `Partial<>` because a tab is `undefined` until the user has visited it.
 * @example { 'all-time': { skills: [...], lastFetched: 1713045600000, filter: 'all-time', status: 'idle' } }
 */
type LeaderboardCache = Partial<Record<RankingFilter, LeaderboardData>>

interface MarketplaceState {
  /** Installation status, independent of concurrent searches. */
  status: MarketplaceStatus
  /** A pending search owns its request ID until superseded, cleared, or settled. */
  search:
    | { status: 'idle' }
    | { status: 'pending'; requestId: string }
    | { status: 'error' }
  /** Debounced query committed when its search starts. */
  searchQuery: SearchQuery
  /** Results from the most recent `skills find` call. */
  searchResults: SkillSearchResult[]
  /** Skill chosen in the install modal — name + repo only (see InstallIntent). */
  selectedSkill: InstallIntent | null
  /** Skill selected for right-pane webview preview (separate from install modal). */
  previewSkill: SkillSearchResult | null
  /** Live progress for an in-flight install, or null when idle. */
  installProgress: InstallProgress | null
  /** Human-readable error from the last failed installation. */
  error: string | null
  /** Per-filter leaderboard cache. Each filter tracks its own data and loading state. */
  leaderboard: LeaderboardCache
}

const initialState: MarketplaceState = {
  status: 'idle',
  search: { status: 'idle' },
  searchQuery: toSearchQuery(''),
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
 *
 * The `condition` gate runs before `pending` and aborts the thunk (dispatching
 * nothing) when a fetch for this filter is already in flight or the cached data
 * is still within its TTL. That bounds the work to one network call per filter
 * even when several widgets mount at once — Trending and What's New both render
 * `LeaderboardWidget`, so each fires this on mount.
 * @param filter - Ranking filter ('all-time' | 'trending' | 'hot')
 * @returns Skills array and the filter they belong to.
 * @example
 * dispatch(loadLeaderboard('trending')) // => { skills: [...], filter: 'trending' }
 */
export const loadLeaderboard = createAsyncThunk(
  'marketplace/loadLeaderboard',
  async (
    filter: RankingFilter,
  ): Promise<{ skills: SkillSearchResult[]; filter: RankingFilter }> => {
    const skills = await window.electron.marketplace.leaderboard({ filter })
    return { skills, filter }
  },
  {
    // Runs synchronously before `pending`; returning false aborts the thunk and
    // (with dispatchConditionRejection:false) dispatches no actions at all.
    condition: (filter: RankingFilter, { getState }) => {
      const cached = (getState() as { marketplace: MarketplaceState })
        .marketplace.leaderboard[filter]
      // A fetch for this filter is already running — let it win, don't refetch.
      if (cached?.status === 'loading') {
        return false
      }
      // Cached data is still fresh — skip the network entirely.
      if (
        cached &&
        cached.status !== 'error' &&
        Date.now() - cached.lastFetched < CACHE_TTL_MS
      ) {
        return false
      }
      return true
    },
    dispatchConditionRejection: false,
  },
)

const marketplaceSlice = createSlice({
  name: 'marketplace',
  initialState,
  reducers: {
    selectSkillForInstall: (
      state,
      action: PayloadAction<InstallIntent | null>,
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
      state.search = { status: 'idle' }
      state.status = 'idle'
      state.installProgress = null
    },
    clearError: (state) => {
      if (state.search.status === 'error') state.search = { status: 'idle' }
      state.error = null
      state.status = 'idle'
    },
    clearSearchResults: (state) => {
      state.searchResults = []
      state.searchQuery = toSearchQuery('')
      state.search = { status: 'idle' }
    },
  },
  extraReducers: (builder) => {
    builder
      // Search
      .addCase(searchSkills.pending, (state, action) => {
        state.searchQuery = action.meta.arg
        state.search = { status: 'pending', requestId: action.meta.requestId }
      })
      .addCase(searchSkills.fulfilled, (state, action) => {
        // A cleared and retyped query can have two CLI children running with the same text.
        if (
          state.search.status !== 'pending' ||
          state.search.requestId !== action.meta.requestId
        )
          return
        state.search = { status: 'idle' }
        state.searchResults = action.payload
      })
      .addCase(searchSkills.rejected, (state, action) => {
        // A late failure must also leave the current results and any installation error alone.
        if (
          state.search.status !== 'pending' ||
          state.search.requestId !== action.meta.requestId
        )
          return
        state.search = { status: 'error' }
        state.searchResults = []
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
        // Mark loading but keep any already-loaded skills on screen, so a
        // background refresh of a populated tab doesn't flash an empty skeleton.
        state.leaderboard[filter] = {
          skills: existing?.skills ?? [],
          lastFetched: toUnixTimestampMs(existing?.lastFetched ?? 0),
          filter,
          status: 'loading',
        }
      })
      .addCase(loadLeaderboard.fulfilled, (state, action) => {
        const { skills, filter } = action.payload
        state.leaderboard[filter] = {
          skills,
          lastFetched: toUnixTimestampMs(Date.now()),
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
            lastFetched: toUnixTimestampMs(0),
            filter,
            status: 'error',
            error: action.error.message || 'Failed to load leaderboard',
          }
        }
      })
  },
})

export const {
  selectSkillForInstall,
  setPreviewSkill,
  setInstallProgress,
  cancelOperation,
  clearError,
  clearSearchResults,
} = marketplaceSlice.actions

export default marketplaceSlice.reducer
