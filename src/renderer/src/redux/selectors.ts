import { createSelector } from '@reduxjs/toolkit'

import { selectBookmarkItems } from './slices/bookmarkSlice'
import { selectSkillsItems } from './slices/skillsSlice'
import { selectSearchQuery, selectSelectedAgentId } from './slices/uiSlice'

/**
 * Memoized selector for filtered skills list.
 * Combines skills items, search query, and selected agent filter.
 * Only recomputes when one of the inputs changes.
 * @returns Filtered skills array
 * @example
 * const filteredSkills = useAppSelector(selectFilteredSkills)
 */
export const selectFilteredSkills = createSelector(
  [selectSkillsItems, selectSearchQuery, selectSelectedAgentId],
  (skills, searchQuery, selectedAgentId) => {
    let result = skills

    // Filter by selected agent
    if (selectedAgentId) {
      result = result.filter((skill) =>
        skill.symlinks.some(
          (symlink) =>
            symlink.agentId === selectedAgentId && symlink.status === 'valid',
        ),
      )
    }

    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      result = result.filter(
        (skill) =>
          skill.name.toLowerCase().includes(query) ||
          skill.description.toLowerCase().includes(query),
      )
    }

    return result
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
