import { ACTION_HYDRATE_COMPLETE } from '@laststance/redux-storage-middleware'
import { createListenerMiddleware, isAnyOf } from '@reduxjs/toolkit'

import { clearSelection } from './slices/skillsSlice'
import {
  setTheme,
  setColorTheme,
  setNeutralTheme,
  toggleMode,
} from './slices/themeSlice'
import type { ThemeState } from './slices/themeSlice'
import { fetchSyncPreview, selectAgent, setActiveTab } from './slices/uiSlice'

export const listenerMiddleware = createListenerMiddleware()

// Type for state accessed in listeners (avoids circular RootState import)
interface ListenerState {
  theme: ThemeState
}

/**
 * Apply theme to DOM based on current theme state
 * Uses classList.toggle for cleaner class management
 * @param state - Current theme state from Redux
 */
function applyThemeToDOM(state: ThemeState): void {
  const { hue, mode, presetType } = state
  const root = document.documentElement

  // Apply theme type class
  root.classList.toggle('theme-color', presetType === 'color')
  root.classList.toggle('theme-neutral', presetType === 'neutral')

  // Apply hue for color themes
  if (presetType === 'color') {
    root.style.setProperty('--theme-hue', String(hue))
  }

  // Apply dark/light mode
  root.classList.toggle('dark', mode === 'dark')
  root.classList.toggle('light', mode === 'light')
}

/**
 * Theme initialization listener
 * Applies persisted theme from localStorage after hydration completes
 * This ensures the correct theme is shown after storage-middleware loads state
 */
listenerMiddleware.startListening({
  type: ACTION_HYDRATE_COMPLETE,
  effect: (_action, listenerApi) => {
    const state = listenerApi.getState() as ListenerState
    applyThemeToDOM(state.theme)
  },
})

/**
 * Theme switching side effect
 * Listens to all theme-related actions and applies CSS changes
 */
listenerMiddleware.startListening({
  matcher: isAnyOf(setTheme, setColorTheme, setNeutralTheme, toggleMode),
  effect: (_action, listenerApi) => {
    const state = listenerApi.getState() as ListenerState
    applyThemeToDOM(state.theme)
  },
})

/**
 * Cross-slice atomic clear: dispatches `clearSelection` from skillsSlice on any
 * context switch that uiSlice already clears its own ephemeral state for
 * (bulkSelectMode, undoToast, bulkConfirm). Without this bridge the selection
 * survives across tab/agent changes, enabling the "action-over-hidden-state"
 * anti-pattern: SelectionToolbar renders on selection count alone and its
 * Delete/Unlink button commits against invisible ticks the user can no longer
 * audit. Living in listener.ts keeps both slices self-contained (one-way
 * consumer; no circular imports).
 *
 * Note: `deleteSelectedSkills.pending` and `unlinkSelectedFromAgent.pending`
 * are intentionally NOT in this matcher. Those thunks rely on the `.fulfilled`
 * reducers in skillsSlice to narrow `selectedSkillNames` to only the items
 * that actually succeeded, so failed rows stay ticked for retry. A blanket
 * clear on `.pending` would wipe the selection before the reconciliation can
 * run. uiSlice already clears `bulkSelectMode` on those same pending actions,
 * so the toolbar still hides during the in-flight op.
 */
listenerMiddleware.startListening({
  matcher: isAnyOf(setActiveTab, selectAgent, fetchSyncPreview.pending),
  effect: (_action, listenerApi) => {
    listenerApi.dispatch(clearSelection())
  },
})
