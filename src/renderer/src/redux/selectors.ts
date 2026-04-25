import { createSelector } from '@reduxjs/toolkit'

import type { SkillName } from '../../../shared/types'

import { selectBookmarkItems } from './slices/bookmarkSlice'
import {
  selectInFlightDeleteNames,
  selectSelectedSkillNames,
  selectSkillsItems,
} from './slices/skillsSlice'
import {
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
