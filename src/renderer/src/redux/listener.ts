import { ACTION_HYDRATE_COMPLETE } from '@laststance/redux-storage-middleware'
import { createListenerMiddleware, isAnyOf } from '@reduxjs/toolkit'

import {
  setTheme,
  setColorTheme,
  setNeutralTheme,
  toggleMode,
} from './slices/themeSlice'
import type { ThemeState } from './slices/themeSlice'

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
