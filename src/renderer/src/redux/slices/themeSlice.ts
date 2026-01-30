import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'

import type { ThemePresetType } from '../../../../shared/constants'

export interface ThemeState {
  /** Current theme hue (0-360, only used for 'color' type) */
  hue: number
  /** Light or dark mode */
  mode: 'light' | 'dark'
  /** Preset name (e.g., 'cyan', 'neutral-dark') */
  preset: string
  /** Preset type: 'color' (OKLCH) or 'neutral' (shadcn default) */
  presetType: ThemePresetType
}

const initialState: ThemeState = {
  hue: 195,
  mode: 'dark',
  preset: 'neutral-dark',
  presetType: 'neutral',
}

export const themeSlice = createSlice({
  name: 'theme',
  initialState,
  reducers: {
    /**
     * Set the complete theme state
     * @param state - Current theme state
     * @param action - Payload with full theme configuration
     */
    setTheme: (state, action: PayloadAction<ThemeState>) => {
      state.hue = action.payload.hue
      state.mode = action.payload.mode
      state.preset = action.payload.preset
      state.presetType = action.payload.presetType
    },

    /**
     * Toggle between light and dark mode
     * Only works for 'color' type themes
     * @param state - Current theme state
     */
    toggleMode: (state) => {
      if (state.presetType === 'color') {
        state.mode = state.mode === 'dark' ? 'light' : 'dark'
      }
    },

    /**
     * Set color theme with hue
     * @param state - Current theme state
     * @param action - Payload with preset name and hue value
     */
    setColorTheme: (
      state,
      action: PayloadAction<{ preset: string; hue: number }>,
    ) => {
      state.preset = action.payload.preset
      state.hue = action.payload.hue
      state.presetType = 'color'
    },

    /**
     * Set neutral theme (shadcn default)
     * @param state - Current theme state
     * @param action - Payload with preset name and mode
     */
    setNeutralTheme: (
      state,
      action: PayloadAction<{ preset: string; mode: 'light' | 'dark' }>,
    ) => {
      state.preset = action.payload.preset
      state.mode = action.payload.mode
      state.presetType = 'neutral'
    },
  },
})

export const { setTheme, toggleMode, setColorTheme, setNeutralTheme } =
  themeSlice.actions
export default themeSlice.reducer
