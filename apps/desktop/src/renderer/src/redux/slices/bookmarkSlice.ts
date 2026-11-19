import type { PayloadAction } from '@reduxjs/toolkit'
import { createSelector, createSlice } from '@reduxjs/toolkit'

import type { RootState } from '@/renderer/src/redux/store'
import type { BookmarkedSkill, SkillName } from '@/shared/types'
import { toIsoTimestamp } from '@/shared/types'

import {
  ALL_CATEGORIES,
  UNCATEGORIZED,
  STARTER_CATEGORIES,
  categoryNameError,
  type BookmarkCategory,
} from '../bookmarkCategories'

/**
 * Payload for the `addBookmark` action — every BookmarkedSkill field
 * except `bookmarkedAt`, which the reducer stamps with `new Date().toISOString()`.
 * Named so callers (BookmarkButton, install handlers) reference one shape
 * instead of repeating `Omit<BookmarkedSkill, 'bookmarkedAt'>` inline.
 * @example { name: 'task', repo: 'vercel-labs/skills', url: 'https://skills.sh/task' }
 */
type AddBookmarkPayload = Omit<BookmarkedSkill, 'bookmarkedAt' | 'categoryId'>

/**
 * Redux state for the Bookmarks feature.
 * Persisted to localStorage via redux-persist so entries survive app restarts.
 */
interface BookmarkState {
  /** Bookmark entries in insertion order (newest pushed to end). */
  items: BookmarkedSkill[]
  categories: BookmarkCategory[]
}

const initialState: BookmarkState = {
  items: [],
  categories: STARTER_CATEGORIES,
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
    addBookmark: (state, action: PayloadAction<AddBookmarkPayload>) => {
      const exists = state.items.some((b) => b.name === action.payload.name)
      if (!exists) {
        state.items.push({
          ...action.payload,
          bookmarkedAt: toIsoTimestamp(new Date().toISOString()),
        })
      }
    },
    /** Commit a name and color together. Creating from a bookmark also assigns its category. */
    saveBookmarkCategory: (
      state,
      {
        payload,
      }: PayloadAction<{ category: BookmarkCategory; createFor?: SkillName }>,
    ) => {
      const { category, createFor } = payload
      const current = state.categories.find((item) => item.id === category.id)
      if (categoryNameError(category.name, state.categories, current?.id))
        return
      const saved = { ...category, name: category.name.trim() }
      if (createFor !== undefined) {
        const bookmark = state.items.find((item) => item.name === createFor)
        if (!bookmark || current) return
        state.categories.push(saved)
        bookmark.categoryId = saved.id
      } else if (current) {
        Object.assign(current, saved)
      }
    },
    /** Only saved skills can receive a category. Clearing is a single bookmark edit. */
    assignBookmarkCategory: (
      state,
      { payload }: PayloadAction<{ name: SkillName; categoryId?: string }>,
    ) => {
      const bookmark = state.items.find((item) => item.name === payload.name)
      if (!bookmark) return
      if (payload.categoryId === undefined) delete bookmark.categoryId
      else if (state.categories.some((item) => item.id === payload.categoryId))
        bookmark.categoryId = payload.categoryId
    },
    /** Delete the definition and release its assignments in the same dispatch. */
    deleteBookmarkCategory: (state, { payload }: PayloadAction<string>) => {
      state.categories = state.categories.filter(
        (category) => category.id !== payload,
      )
      for (const bookmark of state.items) {
        if (bookmark.categoryId === payload) delete bookmark.categoryId
      }
    },
    /**
     * Remove a bookmark by skill name.
     * @param action.payload - Skill name to remove
     * @example
     * dispatch(removeBookmark('task'))
     */
    removeBookmark: (state, action: PayloadAction<SkillName>) => {
      state.items = state.items.filter((b) => b.name !== action.payload)
    },
  },
})

export const {
  addBookmark,
  removeBookmark,
  assignBookmarkCategory,
  saveBookmarkCategory,
  deleteBookmarkCategory,
} = bookmarkSlice.actions

/** Redux state shape required by bookmark selectors (slice tests use a minimal store). */
type BookmarkSelectorState = Pick<RootState, 'bookmarks'>

/**
 * Select all bookmarked skills.
 * @returns BookmarkedSkill[]
 */
export const selectBookmarkItems = (
  state: BookmarkSelectorState,
): BookmarkedSkill[] => state.bookmarks.items

/** Monitors bookmarks by their existing name key across the four supported surfaces. */
const selectBookmarksByName = createSelector(
  [selectBookmarkItems],
  (items) => new Map(items.map((item) => [item.name, item])),
)

export const selectBookmarkCategories = (
  state: BookmarkSelectorState,
): BookmarkCategory[] => state.bookmarks.categories
const selectCategoryById = createSelector(
  [selectBookmarkCategories],
  (categories) =>
    new Map(categories.map((category) => [category.id, category])),
)

/** Resolve an assignment against the live registry; a deleted or unknown ID is unclassified.
 * @example selectCategoryForSkill(state, skill.name)?.name
 */
export function selectCategoryForSkill(
  state: BookmarkSelectorState,
  name: SkillName,
): BookmarkCategory | undefined {
  const id = selectBookmarksByName(state).get(name)?.categoryId
  return id === undefined ? undefined : selectCategoryById(state).get(id)
}

const selectAssignedNames = createSelector(
  [
    selectBookmarkItems,
    selectCategoryById,
    (_state: BookmarkSelectorState, filter: string) => filter,
  ],
  (items, byId, filter) =>
    new Set(
      items
        .filter(
          (item) =>
            (byId.get(item.categoryId ?? '')?.id ?? UNCATEGORIZED) === filter,
        )
        .map((item) => item.name),
    ),
)

/** A category limits results to saved names. All reuses the existing list without reading bookmark state.
 * @example selectCategoryMemberNames(state, 'security')?.has(skill.name)
 */
export function selectCategoryMemberNames(
  state: BookmarkSelectorState,
  filter: string = ALL_CATEGORIES,
): ReadonlySet<SkillName> | undefined {
  return filter === ALL_CATEGORIES
    ? undefined
    : selectAssignedNames(state, filter)
}

/**
 * Check if a skill is bookmarked by name.
 * @param name - Skill name to check
 * @returns boolean
 * @example
 * const isBookmarked = useAppSelector((state) => selectIsBookmarked(state, 'task'))
 */
export const selectIsBookmarked = (
  state: BookmarkSelectorState,
  name: SkillName,
): boolean => selectBookmarksByName(state).has(name)

export default bookmarkSlice.reducer
