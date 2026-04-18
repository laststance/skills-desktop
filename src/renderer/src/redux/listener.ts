import { ACTION_HYDRATE_COMPLETE } from '@laststance/redux-storage-middleware'
import { createListenerMiddleware, isAnyOf } from '@reduxjs/toolkit'

import { clearSelection } from './slices/skillsSlice'
import { setTheme, toggleMode } from './slices/themeSlice'
import type { ThemeState } from './slices/themeSlice'
import { fetchSyncPreview, selectAgent, setActiveTab } from './slices/uiSlice'

export const listenerMiddleware = createListenerMiddleware()

// Type for state accessed in listeners (avoids circular RootState import)
interface ListenerState {
  theme: ThemeState
}

/**
 * Project the current `ThemeState` onto `<html>` as CSS custom properties
 * plus a `.light` / `.dark` class. This is the only place that mutates the
 * DOM for theme purposes — Redux state stays authoritative and the CSS in
 * `globals.css` consumes `--theme-hue` / `--theme-chroma` directly.
 *
 * Neutral presets persist `chroma: 0`, which collapses every OKLCH token to
 * the grayscale axis and makes the `--theme-hue` angle irrelevant (so we
 * still set it for consistency; no visual change).
 */
function applyThemeToDOM(state: ThemeState): void {
  const { hue, chroma, mode } = state
  const root = document.documentElement
  root.style.setProperty('--theme-hue', String(hue))
  root.style.setProperty('--theme-chroma', String(chroma))
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
  matcher: isAnyOf(setTheme, toggleMode),
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
