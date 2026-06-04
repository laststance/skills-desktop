import { createSelector } from '@reduxjs/toolkit'
import { match } from 'ts-pattern'

import { formatRepositoryFacetLabel } from '@/renderer/src/utils/formatRepositoryFacetLabel'
import { isGStackManagedForAgent } from '@/renderer/src/utils/gstackSkill'
import { SOURCE_FILTER_MAX_VISIBLE_REPOS } from '@/shared/constants'
import type {
  AgentId,
  RepositoryId,
  Skill,
  SkillName,
  SymlinkInfo,
} from '@/shared/types'

import { selectBookmarkItems } from './slices/bookmarkSlice'
import {
  selectInFlightDeleteNames,
  selectSelectedSkillNames,
  selectSkillsItems,
} from './slices/skillsSlice'
import {
  selectExcludedSkillTypeFilters,
  selectSearchQuery,
  selectSearchScope,
  selectSelectedAgentId,
  selectSelectedSources,
  selectSkillTypeFilter,
  selectSortOrder,
} from './slices/uiSlice'
import type {
  ExcludableSkillTypeFilter,
  SkillTypeFilter,
} from './slices/uiSlice'

interface RepoFacetOption {
  source: RepositoryId
  count: number
}

/**
 * Detect whether one scanner slot belongs to the active agent list.
 * @param slot - Symlink slot emitted by the skill scanner.
 * @param selectedAgentId - Agent currently selected in the Installed view.
 * @returns True for occupied slots that should appear in that agent.
 * @example
 * isSelectedAgentSlot(skill.symlinks[0], 'cursor')
 */
function isSelectedAgentSlot(
  slot: SymlinkInfo,
  selectedAgentId: AgentId,
): boolean {
  return (
    slot.agentId === selectedAgentId &&
    (slot.status === 'valid' ||
      slot.status === 'broken' ||
      slot.status === 'inaccessible')
  )
}

/**
 * Check whether a skill belongs to one installed type for the selected agent.
 * Include and exclude filtering both call this helper so G-Stack, orphan, local,
 * and symlinked semantics cannot drift apart.
 * @param skill - Installed skill row from the scanner.
 * @param selectedAgentId - Active agent list owner; null means no agent type match.
 * @param skillTypeFilter - Positive type to test.
 * @returns True when the row matches the requested type for the selected agent.
 * @example
 * matchesSkillTypeFilter(skill, 'cursor', 'local')
 */
function matchesSkillTypeFilter(
  skill: Skill,
  selectedAgentId: AgentId | null,
  skillTypeFilter: SkillTypeFilter,
): boolean {
  if (selectedAgentId === null) return false

  const hasSelectedAgentSlot = (slot: SymlinkInfo): boolean =>
    isSelectedAgentSlot(slot, selectedAgentId)

  return match(skillTypeFilter)
    .with('all', () => skill.symlinks.some(hasSelectedAgentSlot))
    .with('symlinked', () =>
      skill.symlinks.some(
        (slot) => hasSelectedAgentSlot(slot) && slot.isLocal === false,
      ),
    )
    .with('local', () =>
      skill.symlinks.some(
        (slot) => hasSelectedAgentSlot(slot) && slot.isLocal === true,
      ),
    )
    .with('gstack', () => isGStackManagedForAgent(skill, selectedAgentId))
    .with(
      'orphan',
      () =>
        skill.isOrphan === true && skill.symlinks.some(hasSelectedAgentSlot),
    )
    .exhaustive()
}

/**
 * Apply the shared first-pass Installed population gate.
 * Source view returns source-directory skills; agent view returns the selected
 * include type minus any active excludes before repo/search/sort run.
 * @param skills - Raw skill scanner rows from Redux.
 * @param selectedAgentId - Active agent, or null for source view.
 * @param skillTypeFilter - Positive include mode.
 * @param excludedSkillTypeFilters - Negative type filters to subtract.
 * @returns Skills eligible for downstream repo/search/sort filters.
 * @example
 * applyAgentAndTypeFilters(skills, 'cursor', 'all', ['local'])
 */
function applyAgentAndTypeFilters(
  skills: Skill[],
  selectedAgentId: AgentId | null,
  skillTypeFilter: SkillTypeFilter,
  excludedSkillTypeFilters: ExcludableSkillTypeFilter[],
): Skill[] {
  if (selectedAgentId === null) {
    return skills.filter((skill) => skill.isSource)
  }

  let result = skills.filter((skill) =>
    matchesSkillTypeFilter(skill, selectedAgentId, skillTypeFilter),
  )
  if (excludedSkillTypeFilters.length === 0) return result

  const excludedTypes = new Set<ExcludableSkillTypeFilter>(
    excludedSkillTypeFilters,
  )
  result = result.filter((skill) => {
    for (const excludedType of excludedTypes) {
      if (matchesSkillTypeFilter(skill, selectedAgentId, excludedType)) {
        return false
      }
    }
    return true
  })
  return result
}

/**
 * Memoized selector for filtered and sorted skills list.
 * Applies (in order): agent/type include, type excludes, source-repo include
 * filter, scope-aware search query, and name sort.
 *
 * Search scope rules:
 * - `'name'` — case-insensitive substring match against `skill.name` (the
 *   original behavior; preserved when no toggle is wired).
 * - `'repo'` — case-insensitive substring match against `skill.source`. Skills
 *   with no `source` (Local-only skills) are excluded in this mode because
 *   they have no repo string to match.
 *
 * The source-repo include filter (`selectedSources`) keeps only skills whose
 * `source` is in the ticked set; an empty set is a no-op (all repos shown).
 * Source-less Local skills drop out whenever the set is non-empty. Applied
 * independently of the search scope so users can stack "in repos X/Y" with
 * "name containing Z".
 *
 * @returns Filtered + sorted skills array
 * @example
 * const filteredSkills = useAppSelector(selectFilteredSkills)
 */
export const selectFilteredSkills = createSelector(
  [
    selectSkillsItems,
    selectSearchQuery,
    selectSearchScope,
    selectSelectedAgentId,
    selectSelectedSources,
    selectSortOrder,
    selectSkillTypeFilter,
    selectExcludedSkillTypeFilters,
  ],
  (
    skills,
    searchQuery,
    searchScope,
    selectedAgentId,
    selectedSources,
    sortOrder,
    skillTypeFilter,
    excludedSkillTypeFilters,
  ) => {
    let result = applyAgentAndTypeFilters(
      skills,
      selectedAgentId,
      skillTypeFilter,
      excludedSkillTypeFilters,
    )

    // Source-repo include filter — keep only ticked repos. An empty set is a
    // no-op. Local skills (source undefined) can never be in the set, so they
    // drop out implicitly whenever the filter is active.
    if (selectedSources.length > 0) {
      const includedSources = new Set(selectedSources)
      result = result.filter(
        (skill) =>
          skill.source !== undefined && includedSources.has(skill.source),
      )
    }

    // Scope-aware search. ts-pattern + .exhaustive() makes adding a new
    // SearchScope a compile-time failure here, not a silent fall-through to
    // the name branch (the failure mode of the previous if/else).
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      result = match(searchScope)
        .with('repo', () =>
          // Local skills have no `source`; in repo mode they cannot match.
          result.filter((skill) =>
            skill.source ? skill.source.toLowerCase().includes(query) : false,
          ),
        )
        .with('name', () =>
          result.filter((skill) => skill.name.toLowerCase().includes(query)),
        )
        .exhaustive()
    }

    // Sort by name
    const sorted = [...result].sort((a, b) => {
      const cmp = a.name.localeCompare(b.name)
      return sortOrder === 'asc' ? cmp : -cmp
    })

    return sorted
  },
)

/**
 * Exact repo choices for the Installed toolbar. It shares the agent/type gates
 * with `selectFilteredSkills`, but intentionally ignores the active source
 * include filter and text query so users can recover from an over-narrowed
 * filter.
 * @returns Sorted source options with matching row counts.
 * @example
 * const repoOptions = useAppSelector(selectRepoFacetOptions)
 */
export const selectRepoFacetOptions = createSelector(
  [
    selectSkillsItems,
    selectSelectedAgentId,
    selectSkillTypeFilter,
    selectExcludedSkillTypeFilters,
  ],
  (
    skills,
    selectedAgentId,
    skillTypeFilter,
    excludedSkillTypeFilters,
  ): RepoFacetOption[] => {
    const sourceCounts = new Map<RepositoryId, number>()
    const visibleByAgentAndType = applyAgentAndTypeFilters(
      skills,
      selectedAgentId,
      skillTypeFilter,
      excludedSkillTypeFilters,
    )
    for (const skill of visibleByAgentAndType) {
      if (!skill.source) continue
      sourceCounts.set(skill.source, (sourceCounts.get(skill.source) ?? 0) + 1)
    }
    return [...sourceCounts.entries()]
      .sort(([sourceA], [sourceB]) => sourceA.localeCompare(sourceB))
      .map(([source, count]) => ({ source, count }))
  },
)

export interface SourceFilterRow {
  source: RepositoryId
  count: number
  /** True when this repo is in `selectedSources` (drives the checkbox tick). */
  checked: boolean
}

/**
 * Everything the toolbar's source-repo filter UI needs, derived once so the
 * trigger, dropdown, pills, hint, and bulk-confirm snapshot read from one
 * consistent shape (no per-component recomputation or drift).
 * - `selectedSources`: active include set (already pruned of dead ids at fetch
 *   time); drives pills, the trigger count, and checkbox ticks.
 * - `validRepoIds`: ticked ids that still back ≥1 visible row — snapshotted
 *   into the bulk-confirm dialog so it states only scope the user can see.
 * - `dropdownRows`: facet repos ∪ ticked repos, alpha-sorted; a ticked repo
 *   narrowed to 0 rows by the type filter still renders (count 0, checked) so
 *   the user can untick it.
 * - `triggerLabel` / `triggerAriaLabel`: compact button text vs spelled SR copy.
 * - `isSelectAllDisabled`: every facet repo already ticked (nothing to add).
 * - `hasNoRepositories`: facet is empty → dropdown shows an empty state.
 * - `localHiddenCount`: source-less Local skills suppressed by an active
 *   include filter (drives the "N local skills hidden" hint); 0 when inactive.
 *   Ignores the search query.
 */
interface SourceFilterViewModel {
  selectedSources: RepositoryId[]
  validRepoIds: RepositoryId[]
  dropdownRows: SourceFilterRow[]
  triggerLabel: string
  triggerAriaLabel: string
  isSelectAllDisabled: boolean
  hasNoRepositories: boolean
  localHiddenCount: number
}

/**
 * Build the spelled aria-label for the source-repo filter trigger, naming up
 * to `SOURCE_FILTER_MAX_VISIBLE_REPOS` repos then summarizing the remainder so
 * screen-reader users hear the active scope without an unbounded list.
 * @param selectedSources - The active repository include-filter.
 * @returns
 * - `[]` → "Filter by source repository"
 * - 1 → "Filtering by source repository owner/repo"
 * - ≤cap → "Filtering by N source repositories: a, b, c"
 * - >cap → "Filtering by N source repositories: a, b, c, and M more"
 * @example
 * formatSourceFilterAriaLabel([]) // => "Filter by source repository"
 */
function formatSourceFilterAriaLabel(selectedSources: RepositoryId[]): string {
  if (selectedSources.length === 0) return 'Filter by source repository'
  if (selectedSources.length === 1) {
    return `Filtering by source repository ${selectedSources[0]}`
  }
  const spelled = selectedSources
    .slice(0, SOURCE_FILTER_MAX_VISIBLE_REPOS)
    .join(', ')
  const remainder = selectedSources.length - SOURCE_FILTER_MAX_VISIBLE_REPOS
  const suffix = remainder > 0 ? `, and ${remainder} more` : ''
  return `Filtering by ${selectedSources.length} source repositories: ${spelled}${suffix}`
}

/**
 * Consolidated view-model for the Installed toolbar's source-repo include
 * filter. Folds the active selection, the (agent/type-gated) facet options,
 * and the hidden-local count into one memoized shape — see
 * `SourceFilterViewModel` for field semantics. Recomputes the agent/type
 * population internally for `localHiddenCount` rather than coupling
 * `selectRepoFacetOptions` to that concern.
 * @returns SourceFilterViewModel
 * @example
 * const sourceFilter = useAppSelector(selectSourceFilterViewModel)
 * // sourceFilter.triggerLabel === '2 repos'
 */
export const selectSourceFilterViewModel = createSelector(
  [
    selectSkillsItems,
    selectSelectedAgentId,
    selectSkillTypeFilter,
    selectExcludedSkillTypeFilters,
    selectSelectedSources,
    selectRepoFacetOptions,
  ],
  (
    skills,
    selectedAgentId,
    skillTypeFilter,
    excludedSkillTypeFilters,
    selectedSources,
    facetOptions,
  ): SourceFilterViewModel => {
    const facetSourceSet = new Set(facetOptions.map((option) => option.source))
    const countBySource = new Map<RepositoryId, number>(
      facetOptions.map((option): [RepositoryId, number] => [
        option.source,
        option.count,
      ]),
    )
    const selectedSet = new Set(selectedSources)

    // Dropdown render set = facet repos ∪ ticked repos. A repo the user ticked
    // then narrowed to 0 rows via the type filter must still render (checked)
    // so they can untick it — otherwise the include filter is stuck on.
    const dropdownSourceSet = new Set<RepositoryId>([
      ...facetSourceSet,
      ...selectedSources,
    ])
    const dropdownRows: SourceFilterRow[] = [...dropdownSourceSet]
      .sort((a, b) => a.localeCompare(b))
      .map((source) => ({
        source,
        count: countBySource.get(source) ?? 0,
        checked: selectedSet.has(source),
      }))

    // Ticked ids that still back ≥1 facet row. Snapshotted into the
    // bulk-confirm dialog so it reflects only the scope the user can see.
    const validRepoIds = selectedSources.filter((id) => facetSourceSet.has(id))

    // Count source-less Local skills suppressed by an active include filter.
    // Uses the SAME agent/type gate as the facet (ignores the search query) so
    // it answers "how many local skills did the repo filter hide?".
    let localHiddenCount = 0
    if (selectedSources.length > 0) {
      const population = applyAgentAndTypeFilters(
        skills,
        selectedAgentId,
        skillTypeFilter,
        excludedSkillTypeFilters,
      )
      for (const skill of population) {
        if (!skill.source) localHiddenCount += 1
      }
    }

    // Trigger text: compact for the button (CSS truncates further). 2-3 cases
    // → plain branches per the ts-pattern threshold.
    let triggerLabel: string
    if (selectedSources.length === 0) {
      triggerLabel = 'All repos'
    } else if (selectedSources.length === 1) {
      triggerLabel = formatRepositoryFacetLabel(selectedSources[0])
    } else {
      triggerLabel = `${selectedSources.length} repos`
    }

    return {
      selectedSources,
      validRepoIds,
      dropdownRows,
      triggerLabel,
      triggerAriaLabel: formatSourceFilterAriaLabel(selectedSources),
      // "Select all" is pointless once every facet repo is ticked; the empty
      // facet case is handled by `hasNoRepositories` in the component.
      isSelectAllDisabled:
        facetOptions.length > 0 &&
        facetOptions.every((option) => selectedSet.has(option.source)),
      hasNoRepositories: facetOptions.length === 0,
      localHiddenCount,
    }
  },
)

/**
 * Memoized selector for bookmarks enriched with install status.
 * Compares bookmark names against installed skills to derive isInstalled flag.
 * @returns Array of bookmarks with isInstalled boolean
 * @example
 * const bookmarks = useAppSelector(selectBookmarksWithInstallStatus)
 * // [{ name: 'task', repo: '...', isInstalled: true }, ...]
 */
export const selectBookmarksWithInstallStatus = createSelector(
  [selectBookmarkItems, selectSkillsItems],
  (bookmarks, installedSkills) => {
    const installedNames = new Set(installedSkills.map((s) => s.name))
    return bookmarks.map((b) => ({
      ...b,
      isInstalled: installedNames.has(b.name),
    }))
  },
)

/**
 * Ordered array of skill names the user can currently see (after filter + sort).
 * Used for Cmd/Ctrl+A "select all visible" and for computing a shift-click range.
 * @returns SkillName[] in display order
 * @example
 * // Selection range between two user-clicked rows:
 * const visibleNames = useAppSelector(selectVisibleSkillNames)
 * dispatch(selectRange(computeRangeSelection(anchor, target, visibleNames)))
 */
export const selectVisibleSkillNames = createSelector(
  [selectFilteredSkills],
  (filteredSkills): SkillName[] => filteredSkills.map((skill) => skill.name),
)

/**
 * Detect whether a visible agent-view row can use the reviewed bulk Unlink path.
 * @param skill - Visible skill row.
 * @param selectedAgentId - Active agent filter; null means global delete flow.
 * @returns True when bulk action can safely include this row.
 * @example
 * isBulkSelectableSkill(validSkill, 'cursor') // => true
 */
function isBulkSelectableSkill(
  skill: Skill,
  selectedAgentId: AgentId | null,
): boolean {
  if (selectedAgentId === null) return true

  return skill.symlinks.some(
    (symlink) =>
      symlink.agentId === selectedAgentId &&
      symlink.status === 'valid' &&
      !symlink.isLocal,
  )
}

/**
 * Ordered visible names that can safely flow through the current bulk action.
 * Agent-view local/broken/inaccessible rows stay visible but are excluded
 * because reviewed bulk Unlink only removes symlink slots.
 * @returns Skill names eligible for Select all, Shift range, and primary action.
 * @example
 * const names = useAppSelector(selectBulkSelectableVisibleSkillNames)
 */
export const selectBulkSelectableVisibleSkillNames = createSelector(
  [selectFilteredSkills, selectSelectedAgentId],
  (filteredSkills, selectedAgentId): SkillName[] =>
    filteredSkills
      .filter((skill) => isBulkSelectableSkill(skill, selectedAgentId))
      .map((skill) => skill.name),
)

/**
 * Count of items currently ticked in `selectedSkillNames`. Separate from
 * `selectedSkillNames.length` at callsites so components can subscribe to the
 * scalar without re-rendering on any selection mutation (toolbar shows
 * "3 selected" — it only needs the count).
 * @returns number — total ticked names (NOT intersected with visible list)
 * @example
 * const count = useAppSelector(selectSelectedCount) // 3
 */
export const selectSelectedCount = createSelector(
  [selectSelectedSkillNames],
  (selectedNames): number => selectedNames.length,
)

/**
 * Intersection of `selectedSkillNames` with the currently visible (filtered)
 * list. A user can tick 10 items, then narrow the list to 3 via search — the
 * toolbar's "Delete" button should operate on the visible-and-selected subset
 * (the 3 visible ones), not on the full 10-item selection.
 * @returns SkillName[] that are both ticked AND visible, preserving visible order.
 * @example
 * // selectedSkillNames = ['task', 'theme', 'browser']
 * // visible after search = ['task', 'browser']
 * // => ['task', 'browser']
 */
export const selectSelectedVisibleNames = createSelector(
  [selectSelectedSkillNames, selectBulkSelectableVisibleSkillNames],
  (selectedNames, visibleNames): SkillName[] => {
    const selectedSet = new Set(selectedNames)
    return visibleNames.filter((name) => selectedSet.has(name))
  },
)

/**
 * Count of selected-and-visible names — what the toolbar's action buttons
 * should advertise. Separates the scalar from the array so a toolbar
 * subscribing only to the count does not re-render on in-flight array changes.
 * @returns number
 */
export const selectSelectedVisibleCount = createSelector(
  [selectSelectedVisibleNames],
  (visibleSelected): number => visibleSelected.length,
)

/**
 * The hidden-selected count shown in the toolbar as a badge ("+2 hidden by
 * filter") so the user realizes they have out-of-view selections. Visible
 * but ineligible rows are counted separately by `selectVisibleIneligibleSelectedCount`.
 * @returns number — selected names that are NOT in the visible list
 */
export const selectHiddenSelectedCount = createSelector(
  [selectSelectedSkillNames, selectVisibleSkillNames],
  (selectedNames, visibleNames): number => {
    const visibleSet = new Set(visibleNames)
    let hidden = 0
    for (const name of selectedNames) {
      if (!visibleSet.has(name)) hidden += 1
    }
    return hidden
  },
)

/**
 * Count selected rows that are visible but excluded from the current bulk action.
 * @returns number — visible selected rows that cannot use Delete/Unlink safely.
 * @example
 * // broken agent-view row selected on screen => 1 not eligible
 */
export const selectVisibleIneligibleSelectedCount = createSelector(
  [
    selectSelectedSkillNames,
    selectVisibleSkillNames,
    selectBulkSelectableVisibleSkillNames,
  ],
  (selectedNames, visibleNames, eligibleVisibleNames): number => {
    const selectedSet = new Set(selectedNames)
    const eligibleSet = new Set(eligibleVisibleNames)
    let visibleIneligible = 0
    for (const name of visibleNames) {
      if (selectedSet.has(name) && !eligibleSet.has(name)) {
        visibleIneligible += 1
      }
    }
    return visibleIneligible
  },
)

/**
 * Memoized Set wrapper around `inFlightDeleteNames` so SkillItem's O(1)
 * `.has(name)` lookup does not trigger a Set-rebuild on every row render.
 * Without this, every row would create a fresh Set — the rebuild is cheap per
 * call but pathological across virtualized rows during a large batch.
 * @returns ReadonlySet<SkillName>
 * @example
 * const inFlight = useAppSelector(selectInFlightDeleteNamesSet)
 * const isFading = inFlight.has(skill.name)
 */
export const selectInFlightDeleteNamesSet = createSelector(
  [selectInFlightDeleteNames],
  (names): ReadonlySet<SkillName> => new Set(names),
)

// Shared empty Set sentinel — returned by `selectAnyInFlightRemovalSet` when
// no bulk delete is in flight, avoiding an allocation on every idle render.
const EMPTY_SKILL_NAME_SET: ReadonlySet<SkillName> = new Set()

/**
 * Set of skill names currently in flight for a bulk delete. SkillItem
 * subscribes to fade rows that the user just dispatched a delete on. Kept
 * as a memoized Set so per-row `.has(name)` lookups stay O(1) without each
 * row rebuilding the Set every render.
 * @returns ReadonlySet<SkillName>
 * @example
 * const inFlight = useAppSelector(selectAnyInFlightRemovalSet)
 * const isFading = inFlight.has(skill.name)
 */
export const selectAnyInFlightRemovalSet = createSelector(
  [selectInFlightDeleteNames],
  (deleteNames): ReadonlySet<SkillName> => {
    if (deleteNames.length === 0) {
      return EMPTY_SKILL_NAME_SET
    }
    return new Set<SkillName>(deleteNames)
  },
)

/**
 * Memoized Set wrapper around `selectedSkillNames` — used by the checkbox in
 * SkillItem to determine its ticked state without scanning the array per row.
 * @returns ReadonlySet<SkillName>
 */
export const selectSelectedSkillNamesSet = createSelector(
  [selectSelectedSkillNames],
  (names): ReadonlySet<SkillName> => new Set(names),
)

/**
 * The full `Skill` objects for the currently ticked names. Resolves
 * `selectedSkillNames` against `state.skills.items`, dropping any name with no
 * live skill (e.g. removed by a concurrent refresh). Feeds the bulk copy modal,
 * which needs each skill's `path` as the copy source.
 * @returns Skill[] in `items` order
 */
export const selectSelectedSkillObjects = createSelector(
  [selectSkillsItems, selectSelectedSkillNamesSet],
  (items, selectedNames): Skill[] =>
    items.filter((skill) => selectedNames.has(skill.name)),
)
