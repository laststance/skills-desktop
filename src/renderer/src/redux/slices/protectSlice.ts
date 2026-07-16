import type { PayloadAction } from '@reduxjs/toolkit'
import { createSelector, createSlice } from '@reduxjs/toolkit'

import type { RootState } from '@/renderer/src/redux/store'
import type { SkillName } from '@/shared/types'

/**
 * Redux state for the per-skill protection feature.
 * Persisted to localStorage via redux-persist so locked skills survive app restarts.
 * Protection is a fat-finger guard only — it lives in the renderer and can be bypassed
 * by clearing app data. Do not treat it as a security control.
 */
interface ProtectState {
  /** Skill names that the user has locked (insertion order, no duplicates). */
  items: SkillName[]
}

const initialState: ProtectState = {
  items: [],
}

const protectSlice = createSlice({
  name: 'protect',
  initialState,
  reducers: {
    /**
     * Lock a skill by name. Ignores duplicates.
     * @param action.payload - Skill name to protect
     * @example
     * dispatch(addProtection('task'))
     */
    addProtection: (state, action: PayloadAction<SkillName>) => {
      if (!state.items.includes(action.payload)) {
        state.items.push(action.payload)
      }
    },
    /**
     * Unlock a skill by name.
     * @param action.payload - Skill name to unprotect
     * @example
     * dispatch(removeProtection('task'))
     */
    removeProtection: (state, action: PayloadAction<SkillName>) => {
      state.items = state.items.filter((name) => name !== action.payload)
    },
  },
})

export const { addProtection, removeProtection } = protectSlice.actions

/** Redux state shape required by protect selectors (slice tests use a minimal store). */
type ProtectSelectorState = Pick<RootState, 'protect'>

/**
 * Select all protected skill names (internal — used by createSelector below).
 * @returns SkillName[]
 */
const selectProtectedItems = (state: ProtectSelectorState): SkillName[] =>
  state.protect.items

/**
 * Memoized Set of protected skill names. Built once per `items` reference
 * and shared across all callers — O(items) build cost amortized across the
 * full list render, not paid per row. Use this in components that need the
 * whole set (e.g. MainContent bulk-delete partition) without rebuilding a Set
 * on every render.
 */
export const selectProtectedNamesSet = createSelector(
  [selectProtectedItems],
  (items) => new Set(items) as ReadonlySet<SkillName>,
)

/**
 * Check if a skill is protected by name.
 * @param name - Skill name to check
 * @returns boolean
 * @example
 * const isProtected = useAppSelector((state) => selectIsProtected(state, 'task'))
 */
export const selectIsProtected = (
  state: ProtectSelectorState,
  name: SkillName,
): boolean => selectProtectedNamesSet(state).has(name)

export default protectSlice.reducer
