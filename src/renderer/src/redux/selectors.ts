import { createSelector } from '@reduxjs/toolkit'

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
