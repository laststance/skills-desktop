import { COLOR_PRESET_CHROMA, THEME_PRESETS } from '../../../shared/constants'

import type { ThemeState } from './slices/themeSlice'

/**
 * Shape of state passed to migrations by `@laststance/redux-storage-middleware`.
 * Each slice is optional because legacy payloads may be partial or corrupted.
 * Kept intentionally loose — migrations run before slice reducers validate,
 * so we accept `unknown` inputs but write a valid `ThemeState` on success.
 */
export interface MigratableState {
  theme?: ThemeState
}

/**
 * v0 → v1 migration for the theme slice. The old shape carried a
 * `presetType: 'color' | 'neutral'` discriminator and a hard-coded HSL
 * palette under `.theme-neutral`; v1 replaces that with a numeric
 * `chroma` scalar so the same OKLCH formula drives both ramps. For users
 * already on disk we translate `presetType` to a chroma value and drop
 * the field. The legacy `THEME_HUES` export was removed in favor of a
 * unified `THEME_PRESETS` table, but every old preset name
 * (e.g. `cyan`, `neutral-dark`) remains valid so no preset-key rename is
 * required. Unknown preset strings (e.g. from a later rename) fall back
 * to `neutral-dark`.
 *
 * This function lives in its own module so `store.test.ts` can exercise
 * it without booting the full storage-middleware pipeline.
 */
export function migrateState<T extends MigratableState>(
  state: T,
  oldVersion: number,
): T {
  if (oldVersion >= 1) return state
  // Null, undefined, or non-object theme slot: drop it so the reducer's
  // initial state takes over. Prevents downstream `state.theme.hue` reads
  // from crashing when legacy storage was tampered with or half-written.
  if (!state.theme || typeof state.theme !== 'object') {
    delete state.theme
    return state
  }
  const legacy = state.theme as {
    hue?: number
    mode?: 'light' | 'dark'
    preset?: string
    presetType?: 'color' | 'neutral'
  }
  const presetIsValid =
    typeof legacy.preset === 'string' && legacy.preset in THEME_PRESETS
  state.theme = {
    hue: typeof legacy.hue === 'number' ? legacy.hue : 0,
    chroma: legacy.presetType === 'color' ? COLOR_PRESET_CHROMA : 0,
    mode:
      legacy.mode === 'light' || legacy.mode === 'dark' ? legacy.mode : 'dark',
    preset: presetIsValid
      ? (legacy.preset as ThemeState['preset'])
      : 'neutral-dark',
  } as ThemeState
  return state
}
