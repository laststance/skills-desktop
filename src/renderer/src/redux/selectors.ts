import { createSelector } from '@reduxjs/toolkit'

import { selectBookmarkItems } from './slices/bookmarkSlice'
import { selectSkillsItems } from './slices/skillsSlice'
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
