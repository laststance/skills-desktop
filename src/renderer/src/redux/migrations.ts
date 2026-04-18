import {
  COLOR_PRESET_CHROMA,
  PERSIST_STATE_VERSION,
  THEME_PRESETS,
} from '../../../shared/constants'
import type { WidgetType } from '../components/dashboard/types'

import type { ThemeState } from './slices/themeSlice'

/**
 * Shape of state passed to migrations by `@laststance/redux-storage-middleware`.
 * Each slice is optional because legacy payloads may be partial or corrupted.
 * Kept intentionally loose — migrations run before slice reducers validate,
 * so we accept `unknown` inputs but write a valid shape on success.
 *
 * `dashboard` is typed as `unknown` because the v1 → v2 migration walks legacy
 * widget structures that pre-date the current `DashboardState`; importing the
 * v2 type here would force-cast every legacy field. The migration narrows
 * locally before mutating.
 */
export interface MigratableState {
  theme?: ThemeState
  dashboard?: unknown
}

/**
 * Per-widget minimum sizes. **Mirror** of `WIDGET_REGISTRY[*].minSize` in
 * `src/renderer/src/components/dashboard/widgets/registry.ts`. Lives here as a
 * plain map so this module stays free of the widget-component graph (lucide
 * icons, slice imports), preventing a circular import via the renderer
 * bootstrap path.
 *
 * **When you bump a widget's `minSize` in the registry, add the new floor
 * here AND ship a new migration.** Otherwise persisted layouts on the prior
 * floor will silently violate the registry constraint after upgrade.
 */
export const V2_WIDGET_MIN_SIZES = {
  'quick-actions': { w: 3, h: 3 },
} as const satisfies Partial<Record<WidgetType, { w: number; h: number }>>

/**
 * v0 → v1 migration for the theme slice. The old shape carried a
 * `presetType: 'color' | 'neutral'` discriminator; v1 replaces that with a
 * numeric `chroma` scalar so the same OKLCH formula drives both ramps. When
 * a persisted v0 payload names a known preset, we prefer
 * `THEME_PRESETS[preset].chroma` over the `presetType` heuristic — otherwise
 * a tampered payload like `{ preset: 'cyan', presetType: undefined }` would
 * land as `chroma: 0` (grayscale cyan) until the user manually reselects.
 */
function migrateV0ToV1(state: MigratableState): void {
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
 * v1 → v2 migration for the dashboard slice. The Quick Actions widget's
 * `minSize.h` was bumped from 2 to 3 alongside a `GRID_ROW_HEIGHT_PX`
 * increase (48 → 64). Persisted layouts saved before the bump carry the old
 * `h: 2` for Quick Actions; without a clamp, react-grid-layout would silently
 * re-clamp on first render, shoving neighboring widgets and producing a
 * surprise jolt for users who carefully arranged their dashboard.
 *
 * Strategy: walk every persisted widget, look up its floor in
 * `V2_WIDGET_MIN_SIZES`, and clamp `{w,h}` upward in place. Widgets whose
 * type isn't in the map (most of them) are untouched.
 */
function migrateV1ToV2(state: MigratableState): void {
  if (!state.dashboard || typeof state.dashboard !== 'object') return
  const dashboard = state.dashboard as {
    pages?: Array<{
      widgets?: Array<{ type?: string; w?: number; h?: number }>
    } | null>
  }
  if (!Array.isArray(dashboard.pages)) return

  for (const [pageIndex, page] of dashboard.pages.entries()) {
    // A `null` or non-object page entry would crash on the next dereference;
    // when migrate() throws, `@laststance/redux-storage-middleware` calls
    // `storage.removeItem(key)` and the user loses every persisted slice
    // (theme, bookmarks, dashboard) on a single corrupt array element.
    if (!page || typeof page !== 'object') {
      // Dev-only diagnostic so "my dashboard is partially missing widgets"
      // bug reports point at a concrete cause; silent in prod to keep the
      // console clean for users.
      if (import.meta.env.DEV) {
        console.warn(
          `migrateV1ToV2: skipping malformed page at index ${pageIndex}`,
        )
      }
      continue
    }
    if (!Array.isArray(page.widgets)) continue
    for (const widget of page.widgets) {
      // Same defense as the page guard above — a `null` widget would crash on
      // `widget.type` and trigger the same total-wipe path.
      if (!widget || typeof widget !== 'object') {
        if (import.meta.env.DEV) {
          console.warn(
            `migrateV1ToV2: skipping malformed widget on page ${pageIndex}`,
          )
        }
        continue
      }
      if (!widget.type) continue
      // `satisfies` keeps V2_WIDGET_MIN_SIZES literal-typed for the drift
      // test, but the indexer here expects WidgetType (a wider union than
      // the v2 map). Cast to a partial-record at the call site to recover
      // "lookup may miss" semantics — most widget types aren't in v2's map.
      const min = (
        V2_WIDGET_MIN_SIZES as Partial<Record<string, { w: number; h: number }>>
      )[widget.type]
      if (!min) continue
      if (typeof widget.w === 'number' && widget.w < min.w) widget.w = min.w
      if (typeof widget.h === 'number' && widget.h < min.h) widget.h = min.h
    }
  }
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
      case 1:
        migrateV1ToV2(state)
        current = 2
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
