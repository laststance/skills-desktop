import { describe, expect, it } from 'vitest'

import {
  COLOR_PRESET_CHROMA,
  PERSIST_STATE_VERSION,
  THEME_PRESETS,
} from '../../../shared/constants'
import { WIDGET_REGISTRY } from '../components/dashboard/widgets/registry'

import { migrateState, V2_WIDGET_MIN_SIZES } from './migrations'
import type { ThemeState } from './slices/themeSlice'

/**
 * Legacy v0 theme payloads may carry `presetType` and omit `chroma`; the
 * reducer's `ThemeState` has the post-migration shape. Tests reach into
 * the migration with v0-shaped objects via this cast so we can exercise
 * the `presetType` fallback without satisfying the v1 type contract.
 */
type LegacyTheme = ThemeState & {
  presetType?: 'color' | 'neutral'
}

/**
 * Regression tests for the persisted-state migration chain. Two concerns:
 *  1. v0 → v1 correctness: legacy payloads must produce a valid v1 shape,
 *     including deriving chroma from THEME_PRESETS when the preset name is
 *     a known entry (even if presetType is missing/garbled).
 *  2. Drift guard: if `PERSIST_STATE_VERSION` is bumped without adding a
 *     matching migration branch, `migrateState` must throw for every
 *     version in the gap. Without this guard, users on older storage would
 *     silently skip migration and land with a stale shape the reducers
 *     don't understand.
 *
 * @vitest-environment happy-dom
 */

describe('migrateState — v0 → v1 correctness', () => {
  it('derives chroma from THEME_PRESETS when preset name is known but presetType is missing', () => {
    // Tampered v0 payload: valid preset but no presetType. Pre-fix this
    // landed as { preset: 'cyan', chroma: 0 } — grayscale cyan. Post-fix
    // the preset config wins.
    const state = {
      theme: {
        hue: 195,
        mode: 'dark' as const,
        preset: 'cyan',
      } as unknown as LegacyTheme,
    }
    const result = migrateState(state, 0)
    expect(result.theme).toBeDefined()
    expect(result.theme!.preset).toBe('cyan')
    expect(result.theme!.chroma).toBe(THEME_PRESETS.cyan.chroma)
    expect(result.theme!.hue).toBe(THEME_PRESETS.cyan.hue)
  })

  it('falls back to presetType when preset name is unknown', () => {
    const state = {
      theme: {
        hue: 42,
        mode: 'light' as const,
        preset: 'mono-dark',
        presetType: 'color',
      } as unknown as LegacyTheme,
    }
    const result = migrateState(state, 0)
    expect(result.theme).toBeDefined()
    expect(result.theme!.preset).toBe('neutral-dark')
    // unknown preset ⇒ THEME_PRESETS['neutral-dark'].chroma === 0, so
    // the `||` short-circuits to the presetType branch (0.16 for color).
    expect(result.theme!.chroma).toBe(COLOR_PRESET_CHROMA)
  })

  it('drops malformed theme slot so reducer defaults take over', () => {
    const state = { theme: null as unknown as LegacyTheme }
    const result = migrateState(state, 0)
    expect(result.theme).toBeUndefined()
  })

  it('v1+ input passes through untouched', () => {
    const state = {
      theme: {
        hue: 300,
        chroma: COLOR_PRESET_CHROMA,
        mode: 'dark' as const,
        preset: 'violet' as const,
      },
    }
    const before = { ...state.theme }
    const result = migrateState(state, PERSIST_STATE_VERSION)
    expect(result.theme).toEqual(before)
  })
})

describe('migrateState — v1 → v2 dashboard widget min-size clamp', () => {
  /**
   * Build a minimal `dashboard` envelope so each test only declares the
   * widget(s) it actually exercises. Keeps the test focus on the field
   * under inspection (widget.w / widget.h) instead of restating boilerplate
   * (currentPageId, isEditMode, ...) eight times.
   */
  type WidgetFixture = {
    id: string
    type: string
    x: number
    y: number
    w: number
    h: number
  }
  function makeDashboardState(
    pages: Array<{ id?: string; name?: string; widgets: WidgetFixture[] }>,
  ) {
    const normalized = pages.map((p, i) => ({
      id: p.id ?? `page-${i + 1}`,
      name: p.name ?? 'Home',
      widgets: p.widgets,
    }))
    return {
      dashboard: {
        pages: normalized,
        currentPageId: normalized[0].id,
        isEditMode: false,
        welcomeDismissed: false,
        initialized: true,
      },
    }
  }

  /**
   * Bumping `WIDGET_REGISTRY['quick-actions'].minSize.h` from 2 to 3 (paired
   * with the GRID_ROW_HEIGHT_PX 48 → 64 jump) means persisted layouts on the
   * old floor would silently get re-clamped by react-grid-layout on first
   * render, jolting neighboring widgets. The migration clamps in the store
   * so the post-rehydrate state already satisfies the new floor.
   */
  it('clamps quick-actions widget h: 2 up to 3', () => {
    const state = makeDashboardState([
      {
        widgets: [{ id: 'w1', type: 'quick-actions', x: 0, y: 0, w: 6, h: 2 }],
      },
    ])
    migrateState(state, 1)
    expect(state.dashboard.pages[0].widgets[0].h).toBe(3)
    expect(state.dashboard.pages[0].widgets[0].w).toBe(6)
  })

  it('clamps quick-actions widget w: 2 up to 3', () => {
    // The w-branch lives next to the h-branch and never had its own assertion
    // before. If a future bump moves minSize.w independently of minSize.h, the
    // test that only checks h would silently miss the regression.
    const state = makeDashboardState([
      {
        widgets: [{ id: 'w1', type: 'quick-actions', x: 0, y: 0, w: 2, h: 5 }],
      },
    ])
    migrateState(state, 1)
    expect(state.dashboard.pages[0].widgets[0].w).toBe(3)
    expect(state.dashboard.pages[0].widgets[0].h).toBe(5)
  })

  it('leaves quick-actions widget h: 3 untouched (no over-clamp)', () => {
    const state = makeDashboardState([
      {
        widgets: [{ id: 'w1', type: 'quick-actions', x: 0, y: 0, w: 6, h: 3 }],
      },
    ])
    migrateState(state, 1)
    expect(state.dashboard.pages[0].widgets[0].h).toBe(3)
  })

  it('leaves quick-actions widget h: 5 untouched (clamp is upward-only)', () => {
    const state = makeDashboardState([
      {
        widgets: [{ id: 'w1', type: 'quick-actions', x: 0, y: 0, w: 6, h: 5 }],
      },
    ])
    migrateState(state, 1)
    expect(state.dashboard.pages[0].widgets[0].h).toBe(5)
  })

  it('does not touch widgets whose minSize did not change (e.g., stats)', () => {
    const state = makeDashboardState([
      { widgets: [{ id: 'w1', type: 'stats', x: 0, y: 0, w: 3, h: 2 }] },
    ])
    migrateState(state, 1)
    expect(state.dashboard.pages[0].widgets[0].h).toBe(2)
    expect(state.dashboard.pages[0].widgets[0].w).toBe(3)
  })

  it('handles missing dashboard slice gracefully', () => {
    const state = {
      theme: {
        hue: 0,
        chroma: 0,
        mode: 'dark' as const,
        preset: 'neutral-dark' as const,
      },
    }
    expect(() => migrateState(state, 1)).not.toThrow()
  })

  it('handles malformed dashboard slice gracefully', () => {
    const state = {
      dashboard: 'not-an-object' as unknown,
    }
    expect(() => migrateState(state, 1)).not.toThrow()
  })

  it('handles dashboard with no pages array gracefully', () => {
    const state = { dashboard: {} as unknown }
    expect(() => migrateState(state, 1)).not.toThrow()
  })

  it('survives null page entry without throwing (no total-wipe)', () => {
    // A null entry inside dashboard.pages used to crash on the next
    // dereference. When migrate() throws, the storage middleware calls
    // removeItem(key) and the user loses every persisted slice. The guard
    // skips the bad entry and migrates the rest.
    const state = {
      dashboard: {
        pages: [
          null,
          {
            id: 'page-2',
            name: 'Home',
            widgets: [
              { id: 'w1', type: 'quick-actions', x: 0, y: 0, w: 6, h: 2 },
            ],
          },
        ],
      } as unknown,
    }
    expect(() => migrateState(state, 1)).not.toThrow()
    const dashboard = state.dashboard as {
      pages: Array<{ widgets: Array<{ h: number }> } | null>
    }
    expect(dashboard.pages[1]?.widgets[0].h).toBe(3)
  })

  it('survives null widget entry without throwing (no total-wipe)', () => {
    const state = {
      dashboard: {
        pages: [
          {
            id: 'page-1',
            name: 'Home',
            widgets: [
              null,
              { id: 'w1', type: 'quick-actions', x: 0, y: 0, w: 6, h: 2 },
            ],
          },
        ],
      } as unknown,
    }
    expect(() => migrateState(state, 1)).not.toThrow()
    const dashboard = state.dashboard as {
      pages: Array<{ widgets: Array<{ h: number } | null> }>
    }
    expect(dashboard.pages[0].widgets[1]?.h).toBe(3)
  })

  it('clamps across multiple pages and multiple widgets', () => {
    const state = makeDashboardState([
      {
        widgets: [
          { id: 'w1', type: 'quick-actions', x: 0, y: 0, w: 6, h: 2 },
          { id: 'w2', type: 'stats', x: 0, y: 2, w: 3, h: 2 },
        ],
      },
      {
        name: 'Tools',
        widgets: [{ id: 'w3', type: 'quick-actions', x: 0, y: 0, w: 3, h: 2 }],
      },
    ])
    migrateState(state, 1)
    expect(state.dashboard.pages[0].widgets[0].h).toBe(3)
    expect(state.dashboard.pages[0].widgets[1].h).toBe(2) // stats untouched
    expect(state.dashboard.pages[1].widgets[0].h).toBe(3)
    // Quick Actions w: 3 already at the minimum — stays at 3.
    expect(state.dashboard.pages[1].widgets[0].w).toBe(3)
  })
})

describe('V2_WIDGET_MIN_SIZES drift guard', () => {
  // The map in migrations.ts mirrors `WIDGET_REGISTRY[*].minSize`. If anyone
  // bumps a widget's runtime min in the registry without updating the
  // migration map AND adding a new migration, persisted layouts on the prior
  // floor silently violate the registry constraint after upgrade. This test
  // catches the registry/migration desync at unit-test time, before users
  // see neighboring widgets get shoved by the runtime clamp.
  it('mirror entries match WIDGET_REGISTRY minSize', () => {
    for (const [type, min] of Object.entries(V2_WIDGET_MIN_SIZES)) {
      const registryEntry =
        WIDGET_REGISTRY[type as keyof typeof WIDGET_REGISTRY]
      expect(
        registryEntry,
        `V2_WIDGET_MIN_SIZES has '${type}' but WIDGET_REGISTRY does not`,
      ).toBeDefined()
      expect(
        registryEntry.minSize,
        `WIDGET_REGISTRY['${type}'].minSize is missing — bump migrations or registry`,
      ).toEqual(min)
    }
  })
})

describe('migrateState — drift guard', () => {
  it('handles every version below PERSIST_STATE_VERSION', () => {
    // If PERSIST_STATE_VERSION is bumped without adding a matching
    // migrateVNToV(N+1) branch, the switch's default-case throw fires
    // here. Keep each iteration producing a valid theme so regressions
    // in a specific version's handler surface as a concrete failure.
    for (let v = 0; v < PERSIST_STATE_VERSION; v++) {
      const state = {
        theme: {
          hue: 195,
          mode: 'dark' as const,
          preset: 'cyan',
          presetType: 'color',
        } as unknown as LegacyTheme,
      }
      expect(() => migrateState(state, v)).not.toThrow()
      expect(state.theme).toBeDefined()
    }
  })

  it('throws for an unknown source version', () => {
    // Explicit guard: a negative or out-of-band version (corrupted
    // localStorage) should fail fast with a clear error pointing at the
    // missing migration branch.
    const state = {
      theme: {
        hue: 0,
        chroma: 0,
        mode: 'dark' as const,
        preset: 'neutral-dark' as const,
      },
    }
    expect(() => migrateState(state, -1)).toThrow(/no path from v-1/)
  })
})
