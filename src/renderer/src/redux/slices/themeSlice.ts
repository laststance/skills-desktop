import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'

import type { ThemePresetName } from '../../../../shared/constants'
import { THEME_PRESETS } from '../../../../shared/constants'

/**
 * Shape persisted in localStorage via `@laststance/redux-storage-middleware`.
 * `hue` × `chroma` together project to OKLCH coordinates on `<html>`:
 *   --theme-hue:    state.hue    (angle, ignored when chroma === 0)
 *   --theme-chroma: state.chroma (0 = grayscale ramp, 0.16 = saturated ramp)
 * Mode is tracked independently so users can flip dark/light without losing
 * their color preset. `preset` is the authoritative key; `hue`/`chroma`/`mode`
 * are derived snapshots kept in state so the DOM listener can apply them in
 * one pass without re-looking-up the preset table.
 */
export interface ThemeState {
  /** OKLCH hue angle (0–360). No visual effect when `chroma === 0`. @example 195 */
  hue: number
  /**
   * OKLCH chroma scalar driving the entire token ramp. Only two values are
   * ever persisted: `0` (neutral / shadcn) and `COLOR_PRESET_CHROMA` (color preset).
   */
  chroma: number
  /** Light vs dark palette selector. Applied as `.light` / `.dark` on `<html>`. */
  mode: 'light' | 'dark'
  /** Authoritative preset key. Drives ThemeSelector's aria-pressed state. */
  preset: ThemePresetName
}

const initialState: ThemeState = {
  hue: 0,
  chroma: 0,
  mode: 'dark',
  preset: 'neutral-dark',
}

export const themeSlice = createSlice({
  name: 'theme',
  initialState,
  reducers: {
    /**
     * Select a preset by name. Pulls `hue`, `chroma`, and (for neutral
     * presets) `mode` from the central `THEME_PRESETS` table so every call
     * site stays in sync. Color presets keep the user's current `mode`
     * so switching between e.g. cyan → rose doesn't silently dark-flip.
     * @example
     * dispatch(setTheme('rose'))          // rose hue, current mode
     * dispatch(setTheme('neutral-light')) // chroma=0, mode forced to light
     */
    setTheme: (state, action: PayloadAction<ThemePresetName>) => {
      const preset = action.payload
      const config = THEME_PRESETS[preset]
      // Guard against stale preset keys (e.g. a persisted name that no longer
      // exists after a refactor). Without this, `config.hue` crashes the app
      // on first dispatch. Fall back to neutral-dark, the default safe state.
      if (!config) {
        const fallback = THEME_PRESETS['neutral-dark']
        state.preset = 'neutral-dark'
        state.hue = fallback.hue
        state.chroma = fallback.chroma
        state.mode = fallback.mode
        return
      }
      state.preset = preset
      state.hue = config.hue
      state.chroma = config.chroma
      if ('mode' in config) {
        state.mode = config.mode
      }
    },

    /**
     * Flip between dark and light. When the active preset is one of the
     * neutral variants, also swap its preset key so `neutral-dark` ↔
     * `neutral-light` stays consistent with the new mode.
     */
    toggleMode: (state) => {
      const next = state.mode === 'dark' ? 'light' : 'dark'
      state.mode = next
      if (state.preset === 'neutral-dark' || state.preset === 'neutral-light') {
        state.preset = `neutral-${next}`
      }
    },
  },
})

export const { setTheme, toggleMode } = themeSlice.actions
export default themeSlice.reducer
