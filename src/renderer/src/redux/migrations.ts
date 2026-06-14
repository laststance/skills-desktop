import type {
  WidgetSize,
  WidgetType,
} from '@/renderer/src/components/dashboard/types'
import {
  COLOR_PRESET_CHROMA,
  PERSIST_STATE_VERSION,
  THEME_PRESETS,
} from '@/shared/constants'

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
} as const satisfies Partial<Record<WidgetType, WidgetSize>>

/**
 * v4 floor — the Symlink Health widget's `minSize.h` grew 2 → 3 after its
 * "Scan issues" action row clipped against the card's bottom edge at h=2.
 * **Mirror** of `WIDGET_REGISTRY['health'].minSize`, kept here for the
 * same reason as {@link V2_WIDGET_MIN_SIZES} — this module must stay free of
 * the widget-component graph. Same contract: bump the registry, add the floor
 * here, AND ship a migration.
 */
export const V4_WIDGET_MIN_SIZES = {
  health: { w: 2, h: 3 },
} as const satisfies Partial<Record<WidgetType, WidgetSize>>

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
 * Walk every persisted dashboard widget and clamp `{w,h}` upward to a per-type
 * floor — the shared engine behind the v1 → v2 and v3 → v4 dashboard
 * migrations. Both raised a widget's registry `minSize`, so layouts persisted
 * on the old floor must be rewritten in storage; otherwise react-grid-layout
 * re-clamps them mid-render and shoves the user's arranged neighbors. Mutates
 * `state.dashboard` in place and no-ops when the slice is missing or malformed
 * (a thrown migration makes the storage middleware wipe every persisted slice).
 *
 * @param state - migratable persisted state; `dashboard` may be any shape.
 * @param floors - per-widget-type minimum `{w,h}`; types absent are untouched.
 * @param migrationName - label used in the dev-only malformed-entry warnings.
 * @returns nothing — `state.dashboard` is mutated in place.
 * @example
 * // health persisted at h:2 is raised to the v4 floor h:3
 * clampPersistedWidgetSizes(state, V4_WIDGET_MIN_SIZES, 'migrateV3ToV4')
 */
function clampPersistedWidgetSizes(
  state: MigratableState,
  floors: Partial<Record<string, WidgetSize>>,
  migrationName: string,
): void {
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
      /* v8 ignore next -- DEV-only console.warn; vitest always runs with import.meta.env.DEV=true, so the prod (false) branch is unreachable in this lane */
      if (import.meta.env.DEV) {
        console.warn(
          `${migrationName}: skipping malformed page at index ${pageIndex}`,
        )
      }
      continue
    }
    if (!Array.isArray(page.widgets)) continue
    for (const widget of page.widgets) {
      // Same defense as the page guard above — a `null` widget would crash on
      // `widget.type` and trigger the same total-wipe path.
      if (!widget || typeof widget !== 'object') {
        /* v8 ignore next -- DEV-only console.warn; vitest always runs with import.meta.env.DEV=true, so the prod (false) branch is unreachable in this lane */
        if (import.meta.env.DEV) {
          console.warn(
            `${migrationName}: skipping malformed widget on page ${pageIndex}`,
          )
        }
        continue
      }
      if (!widget.type) continue
      // `floors` is already string-keyed, so indexing with `widget.type`
      // (string) needs no cast — the lookup is `{ w, h } | undefined` and the
      // guard below recovers "type not in this version's floor map" semantics.
      const min = floors[widget.type]
      if (!min) continue
      if (typeof widget.w === 'number' && widget.w < min.w) widget.w = min.w
      if (typeof widget.h === 'number' && widget.h < min.h) widget.h = min.h
    }
  }
}

/**
 * v1 → v2 migration for the dashboard slice. The Quick Actions widget's
 * `minSize.h` was bumped from 2 to 3 alongside a `GRID_ROW_HEIGHT_PX`
 * increase (48 → 64). Persisted layouts saved before the bump carry the old
 * `h: 2` for Quick Actions; without a clamp, react-grid-layout would silently
 * re-clamp on first render, shoving neighboring widgets and producing a
 * surprise jolt for users who carefully arranged their dashboard. Delegates to
 * {@link clampPersistedWidgetSizes} with the v2 floors.
 */
function migrateV1ToV2(state: MigratableState): void {
  clampPersistedWidgetSizes(state, V2_WIDGET_MIN_SIZES, 'migrateV1ToV2')
}

/**
 * v2 → v3 migration for the theme slice. v3 introduces `modePreference`
 * (the user's *choice* of light / dark / system) alongside the existing
 * `mode` (the *resolved* value applied to <html>). v2 users only had
 * `mode`, so seed `modePreference` from it — they explicitly picked
 * light or dark before, and silently upgrading them to "system" would
 * make their app start auto-flipping with the OS without notice.
 *
 * `mode` itself is also normalized: anything other than 'light' / 'dark'
 * (tampered storage, future variants) collapses to 'dark' so both fields
 * agree on a sane default.
 */
function migrateV2ToV3(state: MigratableState): void {
  // Null, undefined, or non-object theme slot: drop it so the reducer's
  // initial state takes over. Matches the v0 → v1 defensive style.
  if (!state.theme || typeof state.theme !== 'object') {
    delete state.theme
    return
  }
  const legacy = state.theme as { mode?: 'light' | 'dark' }
  const resolved: 'light' | 'dark' =
    legacy.mode === 'light' || legacy.mode === 'dark' ? legacy.mode : 'dark'
  state.theme = {
    ...(state.theme as ThemeState),
    mode: resolved,
    modePreference: resolved,
  }
}

/**
 * v3 → v4 migration for the dashboard slice. The Symlink Health widget's
 * `minSize.h` grew 2 → 3 so its "Scan issues" action row stops clipping
 * against the card's bottom edge. Layouts persisted at the old
 * `h: 2` are clamped up to the v4 floor; react-grid-layout's default vertical
 * compactor then reflows any widget the taller card now overlaps on first
 * render (and re-persists the result via `onLayoutChange`), so only the size
 * needs rewriting here. Delegates to {@link clampPersistedWidgetSizes}.
 */
function migrateV3ToV4(state: MigratableState): void {
  clampPersistedWidgetSizes(state, V4_WIDGET_MIN_SIZES, 'migrateV3ToV4')
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
      case 2:
        migrateV2ToV3(state)
        current = 3
        break
      case 3:
        migrateV3ToV4(state)
        current = 4
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
