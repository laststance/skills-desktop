import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'

import type { RootState } from '@/renderer/src/redux/store'
import type {
  AgentId,
  AgentName,
  BookmarkedSkill,
  IsoTimestamp,
  RepositoryId,
  SearchQuery,
  SkillName,
  SourceStats,
  SyncExecuteOptions,
  SyncExecuteResult,
  SyncPreviewOptions,
  SyncPreviewResult,
  ToastId,
  TombstoneId,
} from '@/shared/types'

import {
  clearSelectedOrphanSymlinks,
  deleteSelectedSkills,
  fetchSkills,
  unlinkSelectedFromAgent,
} from './skillsSlice'

/** Bookmark with install status, used for the detail modal */
export type BookmarkForDetail = BookmarkedSkill & { isInstalled: boolean }

export type SortOrder = 'asc' | 'desc'
export type SkillTypeFilter =
  | 'all'
  | 'symlinked'
  | 'local'
  | 'gstack'
  | 'orphan'
export type ExcludableSkillTypeFilter = Exclude<SkillTypeFilter, 'all'>
export type ActiveTab = 'installed' | 'marketplace'
/**
 * Which field the search box matches against.
 * - `'name'` — matches `Skill.name` (default; previous behavior).
 * - `'repo'` — matches `Skill.source` (e.g. `"vercel-labs/skills"`).
 *   Local skills with no `source` are excluded from results in this mode.
 */
export type SearchScope = 'name' | 'repo'

/**
 * Shape used by the sonner-rendered UndoToast for bulk delete/unlink.
 * - `id`: sonner toast id (string | number); stored so we can imperatively dismiss
 *   from the slice when another competing surface claims the notification real estate.
 * - `kind`: drives the button label ("Undo delete" vs "Undo unlink") and whether
 *   `undoLastBulkDelete` is even wired up (unlink is not tombstoned).
 * - `skillNames` / `tombstoneIds`: the batch identity — tombstoneIds is empty for
 *   unlinks, populated for deletes. Parallel arrays are intentional (index-aligned).
 * - `expiresAt`: absolute ISO timestamp; the UndoToast renders a countdown from this.
 * - `summary`: pre-formatted display string ("Deleted 3 skills. 7 symlinks removed.").
 */
interface UndoToastState {
  id: ToastId
  kind: 'delete' | 'unlink'
  skillNames: SkillName[]
  tombstoneIds: TombstoneId[]
  expiresAt: IsoTimestamp
  summary: string
}

/**
 * Snapshot of the active repository include-filter, captured the instant a
 * bulk delete/unlink is confirmed. Carried inside `BulkConfirmState` so the
 * dialog copy can state the scope the user is acting within even if the live
 * `ui` filter changes before they click confirm.
 * - `repositoryIds`: the *visible* included repos (selectedSources ∩ facet
 *   options) — stale ids that no longer match any skill are excluded.
 * - `localHiddenCount`: source-less local skills suppressed by the active
 *   include filter, surfaced as the "N local skills hidden" caveat.
 */
export interface SourceFilterSummary {
  repositoryIds: RepositoryId[]
  localHiddenCount: number
}

/**
 * Pending bulk confirmation payload. Populated by the SelectionToolbar's
 * primary-action handler when the user clicks Delete/Unlink; the
 * `BulkConfirmDialog` in MainContent reads this to render the Radix
 * AlertDialog equivalent of the old `window.confirm` call (which is
 * discouraged in Electron renderers and blocks the event loop).
 * - `kind`: drives copy and which thunk to dispatch on confirm.
 * - `skillNames`: the exact argument to pass to the thunk on confirm.
 * - `agentId` / `agentName`: carried through so the unlink thunk knows which
 *   agent to target, and the dialog copy can mention the agent by name.
 * - `sourceSummary`: repository-filter scope snapshot, or null when no repo
 *   filter is active and no local skills are hidden.
 */
export interface BulkConfirmState {
  kind: 'delete' | 'unlink'
  skillNames: SkillName[]
  agentId: AgentId | null
  agentName: AgentName | null
  sourceSummary: SourceFilterSummary | null
}

interface UiState {
  /** Active main content tab */
  activeTab: ActiveTab
  searchQuery: SearchQuery
  /**
   * Which Skill field `searchQuery` matches against. Toggle in `SearchBox`.
   * Persists across agent changes — scope is a query intent, not list state.
   */
  searchScope: SearchScope
  /**
   * Repository include-filter. Empty = show all repos (and local skills).
   * Non-empty = show only skills whose `source` is in this set, hiding
   * source-less local skills (surfaced via the "N local skills hidden" hint).
   * Built up by ticking repos in the toolbar dropdown or clicking a SourceLink.
   * Orthogonal to the agent filter — both can be active simultaneously.
   */
  selectedSources: RepositoryId[]
  sourceStats: SourceStats | null
  isRefreshing: boolean
  /** Currently selected agent filter (null = global/all-agents view). */
  selectedAgentId: AgentId | null
  /** Sort direction for skill name (A→Z / Z→A) */
  sortOrder: SortOrder
  /** Filter by skill type in agent view (all / symlinked / local / G-Stack / orphan) */
  skillTypeFilter: SkillTypeFilter
  /**
   * Skill types subtracted from the selected agent list. Kept transient like
   * the rest of `ui`; reducer guards below prevent impossible include/exclude
   * combinations from becoming user-visible labels.
   */
  excludedSkillTypeFilters: ExcludableSkillTypeFilter[]
  /** Whether sync operation is in progress */
  isSyncing: boolean
  /** Sync preview result (null when not previewing) */
  syncPreview: SyncPreviewResult | null
  /** Sync execution result for showing per-item diff (null when not displaying) */
  syncResult: SyncExecuteResult | null
  error: string | null
  /** Bookmark selected for detail modal (null when modal closed) */
  selectedBookmarkForDetail: BookmarkForDetail | null
  /**
   * Active undo toast after a bulk delete/unlink. Null when no toast is live.
   * Cleared atomically when any competing surface starts: a new bulk op, a sync
   * preview, an agent change, or a tab change (see extraReducers + reducers).
   */
  undoToast: UndoToastState | null
  /**
   * Pending bulk confirm dialog payload. Null when no dialog is open.
   * Cleared on tab/agent change (same rationale as `undoToast`).
   */
  bulkConfirm: BulkConfirmState | null
  /**
   * When true, skill cards render a checkbox and bulk selection shortcuts
   * (Cmd/Ctrl+A, Esc) are active. Default false so the list is clean for
   * users who never perform bulk operations. Cleared atomically alongside
   * `undoToast` / `bulkConfirm` / selection on any context switch that makes
   * the current selection stale (tab, agent, sync op, competing bulk op).
   */
  bulkSelectMode: boolean
  /**
   * Agent currently targeted by the per-agent Cleanup dialog (right-click
   * menu in `AgentItem` → "Cleanup missing skills..."). Null when no
   * cleanup dialog is open. Distinct from `selectedAgentId` because the
   * user might cleanup an agent that is NOT the currently filtered list
   * (e.g. they're viewing all skills globally, then cleanup just `cursor`).
   * The dialog reads `syncPreview` (which now echoes `forAgent`) to render
   * agent-scoped counts and conflicts.
   */
  cleanupAgentTarget: AgentId | null
  /**
   * Whether the Dashboard Symlink Health cleanup dialog is open. The dialog
   * keeps scan plan and row selection locally; Redux owns only foreground
   * surface coordination with tabs, sync, and bulk operations.
   */
  symlinkCleanupDialogOpen: boolean
}

const initialState: UiState = {
  activeTab: 'installed',
  searchQuery: '',
  searchScope: 'name',
  selectedSources: [],
  sourceStats: null,
  isRefreshing: false,
  selectedAgentId: null,
  sortOrder: 'asc',
  skillTypeFilter: 'all',
  excludedSkillTypeFilters: [],
  isSyncing: false,
  syncPreview: null,
  syncResult: null,
  error: null,
  selectedBookmarkForDetail: null,
  undoToast: null,
  bulkConfirm: null,
  bulkSelectMode: false,
  cleanupAgentTarget: null,
  symlinkCleanupDialogOpen: false,
}

/**
 * Fetch source directory statistics
 */
export const fetchSourceStats = createAsyncThunk(
  'ui/fetchSourceStats',
  async () => {
    return window.electron.source.getStats()
  },
)

/**
 * Preview sync: detect conflicts and count operations without executing.
 * When `options.agentId` is provided, narrows the preview to that single
 * agent — drives the per-agent Cleanup dialog opened from `AgentItem`'s
 * right-click menu. Without options, runs the global sync preview as
 * before.
 * @param options - When `agentId` is set, restricts the preview to that
 *   agent. Optional; omit for the global preview.
 * @returns SyncPreviewResult — includes `forAgent` echo when scoped.
 * @example
 * dispatch(fetchSyncPreview())                     // global
 * dispatch(fetchSyncPreview({ agentId: 'cursor' })) // per-agent cleanup
 */
export const fetchSyncPreview = createAsyncThunk(
  'ui/fetchSyncPreview',
  async (options?: SyncPreviewOptions) => {
    return window.electron.sync.preview(options)
  },
)

/**
 * Execute sync with conflict resolution choices
 * @param options - replaceConflicts paths
 * @returns SyncExecuteResult
 */
export const executeSyncAction = createAsyncThunk(
  'ui/executeSyncAction',
  async (options: SyncExecuteOptions) => {
    return window.electron.sync.execute(options)
  },
)

/**
 * Return exclude types that can actually change the current include population.
 * The UI uses this to disable impossible rows; reducers use it as the source of
 * truth so accidental dispatches cannot create contradictory labels.
 * @param skillTypeFilter - The active positive include mode.
 * @returns Exclude filters that can subtract at least one possible row.
 * @example
 * getAvailableExcludeTypes('local') // => ['gstack']
 */
export function getAvailableExcludeTypes(
  skillTypeFilter: SkillTypeFilter,
): ExcludableSkillTypeFilter[] {
  switch (skillTypeFilter) {
    case 'all':
      return ['symlinked', 'local', 'gstack', 'orphan']
    case 'symlinked':
      return ['gstack', 'orphan']
    case 'local':
      return ['gstack']
    case 'gstack':
      return ['symlinked', 'local', 'orphan']
    case 'orphan':
      return ['gstack']
  }
}

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    setActiveTab: (state, action: PayloadAction<ActiveTab>) => {
      state.activeTab = action.payload
      // Tab switch is a hard context change; any surviving undo toast from the
      // previous tab is stale (user moved away from the list that owned it).
      state.undoToast = null
      // Same reasoning for an open bulk confirm — the ticked rows belong to
      // the previous tab's list.
      state.bulkConfirm = null
      // The bulk-select affordance is list-scoped; leaving the list exits mode.
      state.bulkSelectMode = false
      // The Dashboard cleanup dialog belongs to the current dashboard context.
      state.symlinkCleanupDialogOpen = false
    },
    setSearchQuery: (state, action: PayloadAction<SearchQuery>) => {
      state.searchQuery = action.payload
    },
    /**
     * Toggle which Skill field the search query matches.
     * Does not clear `searchQuery` or `selectedSources` — the user is
     * narrowing intent, not abandoning the in-progress search.
     */
    setSearchScope: (state, action: PayloadAction<SearchScope>) => {
      state.searchScope = action.payload
    },
    /**
     * Toggle one repository in the include-filter (single-id additive writer).
     * Dispatched per-checkbox in the toolbar dropdown and when the user clicks
     * a SourceLink's repo text. Adds the id if absent, removes it if already
     * ticked — mirrors `toggleExcludedSkillTypeFilter`, minus the availability
     * guard since repo ids are free-form (not a fixed enum).
     */
    toggleSource: (state, action: PayloadAction<RepositoryId>) => {
      const currentIndex = state.selectedSources.indexOf(action.payload)
      // Already ticked → untick (drop from the include set).
      if (currentIndex >= 0) {
        state.selectedSources.splice(currentIndex, 1)
        return
      }
      // Not yet present → add to the include set.
      state.selectedSources.push(action.payload)
    },
    /**
     * Replace the entire include-filter in one shot (bulk writer). Wired to the
     * dropdown's "Select all repos" action, which passes every facet repo id.
     * Distinct from `toggleSource`: that mutates a single id additively, this
     * overwrites the whole set.
     */
    setSelectedSources: (state, action: PayloadAction<RepositoryId[]>) => {
      state.selectedSources = action.payload
    },
    /**
     * Clear the include-filter back to "show all repos". Wired to the
     * dropdown's "Show all repos" action and each FilterPill's "Clear" button.
     * Does not touch `searchScope` or `searchQuery`.
     */
    clearSelectedSources: (state) => {
      state.selectedSources = []
    },
    selectAgent: (state, action: PayloadAction<AgentId | null>) => {
      state.selectedAgentId = action.payload
      state.skillTypeFilter = 'all'
      state.excludedSkillTypeFilters = []
      // Agent change swaps the entire list out; an undo referencing names the
      // user can no longer see would be misleading. Dismiss the toast.
      state.undoToast = null
      // The pending confirm may target a different agent; abandon it.
      state.bulkConfirm = null
      // Selection is agent-scoped in skillsSlice; mode should follow.
      state.bulkSelectMode = false
      // Agent switches replace the symlink graph under review; close the dialog.
      state.symlinkCleanupDialogOpen = false
    },
    toggleSortOrder: (state) => {
      state.sortOrder = state.sortOrder === 'asc' ? 'desc' : 'asc'
    },
    setSkillTypeFilter: (state, action: PayloadAction<SkillTypeFilter>) => {
      state.skillTypeFilter = action.payload
      const available = new Set(getAvailableExcludeTypes(action.payload))
      state.excludedSkillTypeFilters = state.excludedSkillTypeFilters.filter(
        (value) => available.has(value),
      )
    },
    toggleExcludedSkillTypeFilter: (
      state,
      action: PayloadAction<ExcludableSkillTypeFilter>,
    ) => {
      const available = getAvailableExcludeTypes(state.skillTypeFilter)
      if (!available.includes(action.payload)) return

      const currentIndex = state.excludedSkillTypeFilters.indexOf(
        action.payload,
      )
      if (currentIndex >= 0) {
        state.excludedSkillTypeFilters.splice(currentIndex, 1)
        return
      }
      state.excludedSkillTypeFilters.push(action.payload)
    },
    clearExcludedSkillTypeFilters: (state) => {
      state.excludedSkillTypeFilters = []
    },
    setSyncPreview: (
      state,
      action: PayloadAction<SyncPreviewResult | null>,
    ) => {
      state.syncPreview = action.payload
    },
    clearSyncResult: (state) => {
      state.syncResult = null
    },
    setSelectedBookmarkForDetail: (
      state,
      action: PayloadAction<BookmarkForDetail>,
    ) => {
      state.selectedBookmarkForDetail = action.payload
    },
    clearSelectedBookmarkForDetail: (state) => {
      state.selectedBookmarkForDetail = null
    },
    /**
     * Show the undo toast for the most recently completed bulk operation.
     * Fired by MainContent after deleteSelectedSkills/unlinkSelectedFromAgent
     * resolves, once the sonner `toast.custom(...)` id is known.
     */
    setUndoToast: (state, action: PayloadAction<UndoToastState>) => {
      state.undoToast = action.payload
    },
    /**
     * Dismiss the active undo toast without triggering a restore. Called from
     * the UndoToast's onTimeout callback (15s elapsed) or when the user clicks
     * the explicit close affordance.
     */
    clearUndoToast: (state) => {
      state.undoToast = null
    },
    /**
     * Open the bulk confirm dialog with the pending-action payload. The actual
     * thunk dispatch (deleteSelectedSkills / unlinkSelectedFromAgent) happens
     * in MainContent's onConfirm handler after the user approves the prompt.
     */
    setBulkConfirm: (state, action: PayloadAction<BulkConfirmState>) => {
      state.bulkConfirm = action.payload
    },
    /**
     * Close the bulk confirm dialog (user cancelled or confirmed; MainContent
     * clears the state immediately so the dialog unmounts before the async
     * thunk begins — avoids a visible flicker).
     */
    clearBulkConfirm: (state) => {
      state.bulkConfirm = null
    },
    /**
     * Enter bulk-select mode. Reveals checkboxes on skill cards and activates
     * Cmd/Ctrl+A and Esc keyboard shortcuts. Does not touch selection state —
     * the user starts with an empty tick set and explicitly builds it up.
     * @example dispatch(enterBulkSelectMode())
     */
    enterBulkSelectMode: (state) => {
      state.bulkSelectMode = true
    },
    /**
     * Exit bulk-select mode. Hides checkboxes and deactivates the shortcuts.
     * The caller (MainContent) is responsible for also dispatching
     * `clearSelection()` from skillsSlice — we intentionally do not
     * cross-dispatch across slices here, keeping each slice self-contained.
     * @example
     *   dispatch(exitBulkSelectMode())
     *   dispatch(clearSelection())
     */
    exitBulkSelectMode: (state) => {
      state.bulkSelectMode = false
    },
    /**
     * Open the per-agent Cleanup dialog targeting `agentId`. Called from
     * AgentItem's right-click "Cleanup missing skills..." menu item. The
     * caller is expected to dispatch `fetchSyncPreview({ agentId })`
     * immediately afterwards so `syncPreview` has scoped counts when the
     * dialog renders.
     */
    setCleanupAgentTarget: (state, action: PayloadAction<AgentId>) => {
      state.cleanupAgentTarget = action.payload
      // One cleanup surface at a time: per-agent missing-skill cleanup wins.
      state.symlinkCleanupDialogOpen = false
    },
    /**
     * Close the per-agent Cleanup dialog. Also clears any stale
     * `syncPreview` to keep the global sync confirm dialog from latching
     * onto a per-agent preview if the user pivots back to it.
     */
    clearCleanupAgentTarget: (state) => {
      state.cleanupAgentTarget = null
      state.syncPreview = null
    },
    /**
     * Open the Dashboard Symlink Health cleanup dialog. The component performs
     * the awaited scan on open so Redux does not store stale filesystem plans.
     */
    openSymlinkCleanupDialog: (state) => {
      state.symlinkCleanupDialogOpen = true
    },
    /**
     * Close the Dashboard Symlink Health cleanup dialog. Local plan and row
     * selection reset inside the dialog component on this close edge.
     */
    closeSymlinkCleanupDialog: (state) => {
      state.symlinkCleanupDialogOpen = false
    },
  },
  extraReducers: (builder) => {
    builder
      // ── Source stats refresh — drives the spinner on the Refresh button ──
      // `isRefreshing` is the source of truth for `selectIsRefreshing`, which
      // SourceCard and QuickActionsWidget read to disable the button and spin
      // the icon. Without these three handlers it would stay `false` forever.
      .addCase(fetchSourceStats.pending, (state) => {
        state.isRefreshing = true
      })
      .addCase(fetchSourceStats.fulfilled, (state, action) => {
        state.sourceStats = action.payload
        state.isRefreshing = false
      })
      .addCase(fetchSourceStats.rejected, (state) => {
        state.isRefreshing = false
      })
      .addCase(fetchSyncPreview.pending, (state) => {
        state.isSyncing = true
        // Close result dialog when starting a new sync preview (prevents overlapping dialogs)
        state.syncResult = null
        // A fresh sync attempt takes notification precedence; any pending undo is stale.
        state.undoToast = null
        // Close an open bulk confirm — sync conflict dialog will render on top.
        state.bulkConfirm = null
        // Sync preview supersedes bulk affordance; user's attention shifts.
        state.bulkSelectMode = false
        // Sync is another filesystem plan; do not overlap with symlink cleanup.
        state.symlinkCleanupDialogOpen = false
      })
      .addCase(fetchSyncPreview.fulfilled, (state, action) => {
        state.syncPreview = action.payload
        // Preview phase complete — stop syncing so UI buttons are enabled.
        // executeSyncAction handles its own loading state via isExecuting (component-local).
        state.isSyncing = false
      })
      .addCase(fetchSyncPreview.rejected, (state, action) => {
        state.isSyncing = false
        state.error = action.error.message ?? 'Failed to fetch sync preview'
      })
      .addCase(executeSyncAction.fulfilled, (state, action) => {
        state.isSyncing = false
        state.syncPreview = null
        // Store result for SyncResultDialog to display per-item diff
        state.syncResult = action.payload
      })
      .addCase(executeSyncAction.rejected, (state, action) => {
        state.isSyncing = false
        state.syncResult = null
        state.error = action.error.message ?? 'Sync failed'
      })
      // ── Bulk delete/unlink: clear stale undo toast atomically ──────────
      // A new bulk operation supersedes any in-flight undo affordance. The
      // fresh fulfilled outcome will dispatch `setUndoToast` from MainContent.
      .addCase(deleteSelectedSkills.pending, (state) => {
        state.undoToast = null
        state.bulkConfirm = null
        // Bulk op committed — leaving mode ON would strand a checkbox column
        // over a fresh post-delete list the user is now observing for result.
        state.bulkSelectMode = false
      })
      .addCase(clearSelectedOrphanSymlinks.pending, (state) => {
        state.undoToast = null
        state.bulkConfirm = null
        state.bulkSelectMode = false
      })
      .addCase(unlinkSelectedFromAgent.pending, (state) => {
        state.undoToast = null
        state.bulkConfirm = null
        state.bulkSelectMode = false
      })
      // ── Prune stale repo filter ids when the skill inventory reloads ─────
      // After a refetch (delete, sync, manual refresh) a previously-ticked repo
      // may no longer back any skill. Drop those ids from `selectedSources` so
      // trigger counts, pills, and the bulk-confirm snapshot never reference a
      // repo the user can no longer see. Prune against the RAW payload sources
      // (the full inventory across all agents), not the agent/type-gated facet
      // — an id valid under a different agent must survive an agent switch.
      .addCase(fetchSkills.fulfilled, (state, action) => {
        const survivingSources = new Set(
          action.payload
            .map((skill) => skill.source)
            .filter((source): source is RepositoryId => Boolean(source)),
        )
        state.selectedSources = state.selectedSources.filter((id) =>
          survivingSources.has(id),
        )
      })
  },
})

export const {
  setActiveTab,
  setSearchQuery,
  setSearchScope,
  toggleSource,
  setSelectedSources,
  clearSelectedSources,
  selectAgent,
  toggleSortOrder,
  setSkillTypeFilter,
  toggleExcludedSkillTypeFilter,
  clearExcludedSkillTypeFilters,
  setSyncPreview,
  clearSyncResult,
  setSelectedBookmarkForDetail,
  clearSelectedBookmarkForDetail,
  setUndoToast,
  clearUndoToast,
  setBulkConfirm,
  clearBulkConfirm,
  enterBulkSelectMode,
  exitBulkSelectMode,
  setCleanupAgentTarget,
  clearCleanupAgentTarget,
  openSymlinkCleanupDialog,
  closeSymlinkCleanupDialog,
} = uiSlice.actions
export default uiSlice.reducer

// --- Named selectors ---
export const selectSearchQuery = (state: RootState): SearchQuery =>
  state.ui.searchQuery
export const selectSearchScope = (state: RootState): SearchScope =>
  state.ui.searchScope
export const selectSelectedSources = (state: RootState): RepositoryId[] =>
  state.ui.selectedSources
export const selectSelectedAgentId = (state: RootState): AgentId | null =>
  state.ui.selectedAgentId
export const selectIsRefreshing = (state: RootState): boolean =>
  state.ui.isRefreshing
export const selectIsSyncing = (state: RootState): boolean => state.ui.isSyncing
export const selectSyncPreview = (state: RootState): SyncPreviewResult | null =>
  state.ui.syncPreview
export const selectSyncResult = (state: RootState): SyncExecuteResult | null =>
  state.ui.syncResult
export const selectSortOrder = (state: RootState): SortOrder =>
  state.ui.sortOrder
export const selectSkillTypeFilter = (state: RootState): SkillTypeFilter =>
  state.ui.skillTypeFilter
export const selectExcludedSkillTypeFilters = (
  state: RootState,
): ExcludableSkillTypeFilter[] => state.ui.excludedSkillTypeFilters
export const selectSelectedBookmarkForDetail = (
  state: RootState,
): BookmarkForDetail | null => state.ui.selectedBookmarkForDetail
export const selectBulkConfirm = (state: RootState): BulkConfirmState | null =>
  state.ui.bulkConfirm
export const selectBulkSelectMode = (state: RootState): boolean =>
  state.ui.bulkSelectMode
/**
 * Currently-targeted agent for the per-agent Cleanup dialog. Null when
 * the dialog is closed. Components subscribe to this to mount/unmount
 * `CleanupAgentDialog`.
 * @example
 * const cleanupTarget = useAppSelector(selectCleanupAgentTarget)
 * // 'cursor' | null
 */
export const selectCleanupAgentTarget = (state: RootState): AgentId | null =>
  state.ui.cleanupAgentTarget
/**
 * Whether the Dashboard Symlink Health cleanup dialog should be mounted open.
 * @param state - Root Redux state.
 * @returns True while the cleanup dialog owns the foreground surface.
 * @example
 * const open = useAppSelector(selectSymlinkCleanupDialogOpen)
 */
export const selectSymlinkCleanupDialogOpen = (state: RootState): boolean =>
  state.ui.symlinkCleanupDialogOpen
