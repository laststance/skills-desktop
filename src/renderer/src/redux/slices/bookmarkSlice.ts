import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'

import type { BookmarkedSkill } from '../../../../shared/types'
import type { RootState } from '../store'

interface BookmarkState {
  items: BookmarkedSkill[]
}

const initialState: BookmarkState = {
  items: [],
}

const bookmarkSlice = createSlice({
  name: 'bookmarks',
  initialState,
  reducers: {
    /**
     * Add a skill to bookmarks. Ignores duplicates by name.
     * @param action.payload - Skill info without bookmarkedAt (auto-set)
     * @example
     * dispatch(addBookmark({ name: 'task', repo: 'vercel-labs/skills', url: 'https://skills.sh/task' }))
     */
    addBookmark: (
      state,
      action: PayloadAction<Omit<BookmarkedSkill, 'bookmarkedAt'>>,
    ) => {
      const exists = state.items.some((b) => b.name === action.payload.name)
      if (!exists) {
        state.items.push({
          ...action.payload,
          bookmarkedAt: new Date().toISOString(),
        })
      }
    },
    /**
     * Remove a bookmark by skill name.
     * @param action.payload - Skill name to remove
     * @example
     * dispatch(removeBookmark('task'))
     */
    removeBookmark: (state, action: PayloadAction<string>) => {
      state.items = state.items.filter((b) => b.name !== action.payload)
    },
  },
})

export const { addBookmark, removeBookmark } = bookmarkSlice.actions

/** Redux state shape required by bookmark selectors (slice tests use a minimal store). */
type BookmarkSelectorState = Pick<RootState, 'bookmarks'>

/**
 * Select all bookmarked skills.
 * @returns BookmarkedSkill[]
 */
export const selectBookmarkItems = (
  state: BookmarkSelectorState,
): BookmarkedSkill[] => state.bookmarks.items

/**
 * Check if a skill is bookmarked by name.
 * @param name - Skill name to check
 * @returns boolean
 * @example
 * const isBookmarked = useAppSelector((state) => selectIsBookmarked(state, 'task'))
 */
export const selectIsBookmarked = (
  state: BookmarkSelectorState,
  name: string,
): boolean => state.bookmarks.items.some((b) => b.name === name)

export default bookmarkSlice.reducer
