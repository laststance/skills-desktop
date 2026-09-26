import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'

import type { ThemePresetName } from '@/shared/constants'
import { THEME_PRESETS } from '@/shared/constants'
import type { ModePreference, ThemeState } from '@/shared/theme'

/**
 * {@link ThemeState} and {@link ModePreference} live in `shared/` because the
 * `theme:changed` broadcast carries them across the IPC boundary. Re-exported
 * here so existing slice consumers keep one import site.
 */
export type { ModePreference, ThemeState } from '@/shared/theme'

const initialState: ThemeState = {
  hue: 0,
  chroma: 0,
  mode: 'dark',
  modePreference: 'dark',
  preset: 'neutral-dark',
}

/**
 * Resolve a `ModePreference` to the concrete light / dark value that the
 * `<html>` class should wear. Only `'system'` requires a runtime lookup;
 * the other two are pass-through.
 *
 * Module-internal (no consumers outside this file). Headless / SSR
 * environments without `matchMedia` get a `'dark'` fallback so the
 * reducer stays total.
 *
 * @example resolveMode('system') // 'dark' when the OS is in Dark Mode
 */
function resolveMode(preference: ModePreference): 'light' | 'dark' {
  if (preference === 'light' || preference === 'dark') return preference
  if (
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function'
  ) {
    return 'dark'
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

/**
 * Swap a neutral preset's family suffix to match the given target mode.
 * Returns the partner preset key if one exists (e.g. zinc-dark -> zinc-light),
 * or `null` when the preset is a color preset (no baked mode) or the
 * partner key is missing from THEME_PRESETS.
 *
 * Color presets are mode-agnostic, so the caller should keep them as-is
 * when switching modes; this function returns null to signal that.
 *
 * @example partnerForMode('zinc-dark', 'light') // 'zinc-light'
 * @example partnerForMode('cyan', 'light')      // null (color preset)
 */
function partnerForMode(
  preset: ThemePresetName,
  target: 'light' | 'dark',
): ThemePresetName | null {
  const config = THEME_PRESETS[preset]
  if (!config || !('mode' in config)) return null
  const lastDashIndex = preset.lastIndexOf('-')
  /* v8 ignore next -- unreachable: passing line 103 means the preset has a 'mode' property, and every mode-bearing preset in THEME_PRESETS has the form '*-dark'|'*-light' (color presets lacking 'mode' already returned above), so lastIndexOf('-') is always >= 0 here; only adding a mode preset without a dash could fire this */
  if (lastDashIndex < 0) return null
  const family = preset.slice(0, lastDashIndex)
  const partnerKey = `${family}-${target}` as ThemePresetName
  /* v8 ignore next -- the `: null` arm is unreachable: every mode-bearing family in THEME_PRESETS ships both a `-dark` and a `-light` variant, so a partnerKey built from a valid preset is always present; only adding a mode preset without its partner variant could fire this */
  return partnerKey in THEME_PRESETS ? partnerKey : null
}

const themeSlice = createSlice({
  name: 'theme',
  initialState,
  reducers: {
    /**
     * Select a preset by name. Pulls `hue`, `chroma`, and (for neutral
     * presets) `mode` from the central `THEME_PRESETS` table so every call
     * site stays in sync. Color presets keep the user's current `mode`
     * so switching between e.g. cyan -> rose doesn't silently dark-flip.
     *
     * `modePreference` is intentionally NOT touched here: a user who is on
     * "Auto" and picks Zinc should still follow the OS next time it flips.
     * The neutral preset key encodes the *currently resolved* mode, which
     * the listener will swap to its partner if the OS later flips.
     *
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
     * Set the user's explicit mode preference (light / dark / system).
     * Resolves to a concrete light / dark, applies it to `state.mode`, and
     * swaps neutral presets to their partner key if the resolved mode no
     * longer matches the active preset's baked mode.
     *
     * Color presets stay untouched because they have no baked mode; only
     * `state.mode` changes for them. Neutral presets must swap their key
     * (e.g. zinc-dark -> zinc-light) so the dropdown's selected swatch
     * stays consistent with the rendered palette.
     *
     * @example
     * dispatch(setModePreference('light'))  // pin Light regardless of OS
     * dispatch(setModePreference('system')) // follow OS appearance
     */
    setModePreference: (state, action: PayloadAction<ModePreference>) => {
      state.modePreference = action.payload
      const resolved = resolveMode(action.payload)
      state.mode = resolved
      const partner = partnerForMode(state.preset, resolved)
      if (partner) state.preset = partner
    },

    /**
     * Adopt a resolved {@link ThemeState} broadcast by another window.
     *
     * Exists because the Settings window is a second BrowserWindow with its
     * own renderer process and its own store: it reads the persisted theme
     * once at boot, so a Dark -> Light switch in the main window used to
     * leave it stranded in the old palette until reopened.
     *
     * A whole-object replace, deliberately - the same idempotent shape as
     * `setSettings`. Re-deriving from `preset` instead would re-run
     * `resolveMode` against the RECEIVER's `matchMedia`, and a distinct
     * action is what keeps the broadcast from echoing: the listener that
     * emits `theme:broadcast` matches only the two user-driven actions, so
     * adopting a broadcast never re-broadcasts.
     *
     * @example
     * dispatch(syncTheme({ hue: 0, chroma: 0, mode: 'light', modePreference: 'light', preset: 'neutral-light' }))
     */
    syncTheme: (_state, action: PayloadAction<ThemeState>) => action.payload,
  },
})

export const { setTheme, setModePreference, syncTheme } = themeSlice.actions
export default themeSlice.reducer
