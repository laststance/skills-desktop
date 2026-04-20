import { createSelector } from '@reduxjs/toolkit'

import type { SkillName } from '../../../shared/types'
import { partitionSkillsForDelete } from '../components/skills/bulkDeleteHelpers'

import { selectBookmarkItems } from './slices/bookmarkSlice'
import {
  selectInFlightCliRemoveNames,
  selectInFlightDeleteNames,
  selectSelectedSkillNames,
  selectSkillsItems,
} from './slices/skillsSlice'
import {
  selectBulkConfirm,
  selectSearchQuery,
  selectSelectedAgentId,
  selectSkillTypeFilter,
  selectSortOrder,
} from './slices/uiSlice'

/**
 * Memoized selector for filtered and sorted skills list.
 * Applies agent filter, skill type filter, search query, and name sort.
 * @returns Filtered + sorted skills array
 * @example
 * const filteredSkills = useAppSelector(selectFilteredSkills)
 */
export const selectFilteredSkills = createSelector(
  [
    selectSkillsItems,
    selectSearchQuery,
    selectSelectedAgentId,
    selectSortOrder,
    selectSkillTypeFilter,
  ],
  (skills, searchQuery, selectedAgentId, sortOrder, skillTypeFilter) => {
    let result = skills

    // Filter by selected agent (and optionally by skill type)
    if (selectedAgentId) {
      const checkType = skillTypeFilter !== 'all'
      const wantLocal = skillTypeFilter === 'local'
      result = result.filter((skill) =>
        skill.symlinks.some(
          (s) =>
            s.agentId === selectedAgentId &&
            s.status === 'valid' &&
            (!checkType || s.isLocal === wantLocal),
        ),
      )
    }

    // Filter by search query (name only)
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      result = result.filter((skill) =>
        skill.name.toLowerCase().includes(query),
      )
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
  [selectSelectedSkillNames, selectVisibleSkillNames],
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
 * filter") so the user realizes they have out-of-view selections that the
 * Delete button will NOT act on.
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

/**
 * Memoized Set wrapper around `inFlightCliRemoveNames` — parallel to
 * `selectInFlightDeleteNamesSet` for the CLI-remove flow. SkillItem OR's
 * the two sets to decide row fade, so a CLI spawn fades the row the same
 * as a trash delete.
 * @returns ReadonlySet<SkillName>
 */
export const selectInFlightCliRemoveNamesSet = createSelector(
  [selectInFlightCliRemoveNames],
  (names): ReadonlySet<SkillName> => new Set(names),
)

// Shared empty Set sentinel — returned by every selector that short-circuits
// on the "no in-flight work" idle case. Hoisted above the first selector that
// references it so the binding is initialized before any module-time selector
// evaluation (avoids the TDZ ReferenceError if `createSelector` ever probes
// its transform eagerly, and removes the reader hazard of a forward reference).
const EMPTY_SKILL_NAME_SET: ReadonlySet<SkillName> = new Set()

/**
 * Union of `inFlightDeleteNames` and `inFlightCliRemoveNames` — either kind
 * of removal fades the row identically, so SkillItem only needs one Set. One
 * subscription per row vs two halves the useSyncExternalStore work across
 * virtualized lists during a large batch.
 *
 * Kept as a separate selector (rather than replacing the two underlying ones)
 * because the reducers still read them individually for narrow state clears.
 * @returns ReadonlySet<SkillName>
 * @example
 * const inFlight = useAppSelector(selectAnyInFlightRemovalSet)
 * const isFading = inFlight.has(skill.name)
 */
export const selectAnyInFlightRemovalSet = createSelector(
  [selectInFlightDeleteNames, selectInFlightCliRemoveNames],
  (deleteNames, cliNames): ReadonlySet<SkillName> => {
    // Short-circuit when neither set has entries — avoids one allocation on
    // every unrelated re-render in the common idle case.
    if (deleteNames.length === 0 && cliNames.length === 0) {
      return EMPTY_SKILL_NAME_SET
    }
    const union = new Set<SkillName>(deleteNames)
    for (const name of cliNames) union.add(name)
    return union
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
 * Count of CLI-managed skills inside the pending bulk-delete confirmation.
 * Drives the confirm-dialog warning copy: zero = trash-only language,
 * >0 = append the no-undo warning so the user sees part of the batch is
 * irreversible.
 *
 * Moved from MainContent's useMemo into Redux so the partition only re-runs
 * when `bulkConfirm` or `items` actually changes — not on every component
 * render triggered by unrelated slices.
 * @returns number — CLI-managed count, or 0 when no bulk-delete confirm is open
 */
export const selectBulkCliCount = createSelector(
  [selectBulkConfirm, selectSkillsItems],
  (bulkConfirm, items): number => {
    if (!bulkConfirm || bulkConfirm.kind !== 'delete') return 0
    return partitionSkillsForDelete(bulkConfirm.skillNames, items).cliNames
      .length
  },
)
