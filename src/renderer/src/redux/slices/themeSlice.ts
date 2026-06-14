import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'

import type { ThemePresetName } from '@/shared/constants'
import { THEME_PRESETS } from '@/shared/constants'

/**
 * User-facing palette mode choice.
 * - 'light' / 'dark' are sticky: the user pinned the palette and we never
 *   auto-flip it regardless of OS appearance changes.
 * - 'system' follows prefers-color-scheme: the listener middleware keeps
 *   state.mode in sync with the OS as long as this preference is active.
 *
 * Persisted alongside `mode` so the resolved value can survive cold starts
 * (read by the pre-hydration bootstrap script) while the preference
 * survives OS theme changes.
 */
export type ModePreference = 'light' | 'dark' | 'system'

/**
 * Shape persisted in localStorage via `@laststance/redux-storage-middleware`.
 * `hue` x `chroma` together project to OKLCH coordinates on `<html>`:
 *   --theme-hue:    state.hue    (angle, ignored when chroma === 0)
 *   --theme-chroma: state.chroma (0 = grayscale ramp, 0.16 = saturated ramp)
 * Mode is tracked independently so users can flip dark/light without losing
 * their color preset. `preset` is the authoritative key; `hue`/`chroma`/`mode`
 * are derived snapshots kept in state so the DOM listener can apply them in
 * one pass without re-looking-up the preset table.
 *
 * `mode` is the resolved palette (what `<html>` actually wears) and
 * `modePreference` is the user's choice. They differ only when the user
 * picked "system" - in which case `mode` mirrors the OS while
 * `modePreference` stays `'system'` so the next OS flip can be honored.
 */
export interface ThemeState {
  /** OKLCH hue angle (0-360). No visual effect when `chroma === 0`. @example 195 */
  hue: number
  /**
   * OKLCH chroma scalar driving the entire token ramp. Only two values are
   * ever persisted: `0` (neutral / shadcn) and `COLOR_PRESET_CHROMA` (color preset).
   */
  chroma: number
  /** Light vs dark palette selector. Applied as `.light` / `.dark` on `<html>`. */
  mode: 'light' | 'dark'
  /**
   * User's explicit mode choice. Persisted so the "Auto" affordance survives
   * reloads and the resolver can re-apply OS appearance after hydration.
   */
  modePreference: ModePreference
  /** Authoritative preset key. Drives ThemeSelector's aria-pressed state. */
  preset: ThemePresetName
}

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
  },
})

export const { setTheme, setModePreference } = themeSlice.actions
export default themeSlice.reducer
