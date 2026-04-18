import {
  COLOR_PRESET_CHROMA,
  PERSIST_STATE_VERSION,
  THEME_PRESETS,
} from '../../../shared/constants'

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
 * `presetType: 'color' | 'neutral'` discriminator; v1 replaces that with a
 * numeric `chroma` scalar so the same OKLCH formula drives both ramps. When
 * a persisted v0 payload names a known preset, we prefer
 * `THEME_PRESETS[preset].chroma` over the `presetType` heuristic — otherwise
 * a tampered payload like `{ preset: 'cyan', presetType: undefined }` would
 * land as `chroma: 0` (grayscale cyan) until the user manually reselects.
 */
function migrateV0ToV1<T extends MigratableState>(state: T): void {
  // Null, undefined, or non-object theme slot: drop it so the reducer's
  // initial state takes over. Prevents downstream `state.theme.hue` reads
  // from crashing when legacy storage was tampered with or half-written.
  if (!state.theme || typeof state.theme !== 'object') {
    delete state.theme
    return
  }
  const legacy = state.theme as {
    hue?: number
    mode?: 'light' | 'dark'
    preset?: string
    presetType?: 'color' | 'neutral'
  }
  const presetIsValid =
    typeof legacy.preset === 'string' && legacy.preset in THEME_PRESETS
  const resolvedPreset: ThemeState['preset'] = presetIsValid
    ? (legacy.preset as ThemeState['preset'])
    : 'neutral-dark'
  const presetConfig = THEME_PRESETS[resolvedPreset]
  state.theme = {
    hue: presetConfig.hue,
    chroma:
      presetConfig.chroma ||
      (legacy.presetType === 'color' ? COLOR_PRESET_CHROMA : 0),
    mode:
      legacy.mode === 'light' || legacy.mode === 'dark' ? legacy.mode : 'dark',
    preset: resolvedPreset,
  } as ThemeState
}

/**
 * Chain migrations up to `PERSIST_STATE_VERSION`. Each `case` must advance
 * `current` to the next schema version; unknown sources throw so bumping
 * `PERSIST_STATE_VERSION` without adding a migration fails loudly in tests
 * instead of silently persisting a stale shape.
 *
 * This function lives in its own module so `store.test.ts` and
 * `migrations.test.ts` can exercise it without booting the full
 * storage-middleware pipeline.
 */
export function migrateState<T extends MigratableState>(
  state: T,
  oldVersion: number,
): T {
  let current = oldVersion
  while (current < PERSIST_STATE_VERSION) {
    switch (current) {
      case 0:
        migrateV0ToV1(state)
        current = 1
        break
      default:
        throw new Error(
          `migrateState: no path from v${current} to v${PERSIST_STATE_VERSION}. ` +
            `Add a migrateV${current}ToV${current + 1} branch.`,
        )
    }
  }
  return state
}
