import { describe, expect, it } from 'vitest'

import { WIDGET_REGISTRY } from '@/renderer/src/components/dashboard/widgets/registry'
import { COLOR_PRESET_CHROMA, PERSIST_STATE_VERSION } from '@/shared/constants'

import {
  migrateState,
  V2_WIDGET_MIN_SIZES,
  V4_WIDGET_MIN_SIZES,
} from './migrations'
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
  it('keeps a known preset in full color when the legacy presetType is missing', () => {
    // Arrange — tampered v0 payload: valid preset but no presetType. Pre-fix
    // this landed as { preset: 'cyan', chroma: 0 } — grayscale cyan. Post-fix
    // the preset config wins.
    const state = {
      theme: {
        hue: 195,
        mode: 'dark' as const,
        preset: 'cyan',
      } as unknown as LegacyTheme,
    }

    // Act
    const result = migrateState(state, 0)

    // Assert
    expect(result.theme).toBeDefined()
    expect(result.theme!.preset).toBe('cyan')
    expect(result.theme!.chroma).toBe(0.16)
    expect(result.theme!.hue).toBe(195)
  })

  it('rescues an unknown preset name to neutral-dark while honoring its legacy color presetType', () => {
    // Arrange
    const state = {
      theme: {
        hue: 42,
        mode: 'light' as const,
        preset: 'mono-dark',
        presetType: 'color',
      } as unknown as LegacyTheme,
    }

    // Act
    const result = migrateState(state, 0)

    // Assert
    expect(result.theme).toBeDefined()
    expect(result.theme!.preset).toBe('neutral-dark')
    // unknown preset ⇒ THEME_PRESETS['neutral-dark'].chroma === 0, so
    // the `||` short-circuits to the presetType branch (0.16 for color).
    expect(result.theme!.chroma).toBe(0.16)
  })

  it('drops a malformed theme slot so reducer defaults take over', () => {
    // Arrange
    const state = { theme: null as unknown as LegacyTheme }

    // Act
    const result = migrateState(state, 0)

    // Assert
    expect(result.theme).toBeUndefined()
  })

  it('leaves an already-current theme untouched when the stored version is up to date', () => {
    // Arrange
    const state = {
      theme: {
        hue: 300,
        chroma: COLOR_PRESET_CHROMA,
        mode: 'dark' as const,
        modePreference: 'dark' as const,
        preset: 'violet' as const,
      },
    }
    const before = { ...state.theme }

    // Act
    const result = migrateState(state, PERSIST_STATE_VERSION)

    // Assert
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
  it('grows an undersized Quick Actions widget up to its new height floor', () => {
    // Arrange
    const state = makeDashboardState([
      {
        widgets: [{ id: 'w1', type: 'quick-actions', x: 0, y: 0, w: 6, h: 2 }],
      },
    ])

    // Act
    migrateState(state, 1)

    // Assert
    expect(state.dashboard.pages[0].widgets[0].h).toBe(3)
    expect(state.dashboard.pages[0].widgets[0].w).toBe(6)
  })

  it('grows an undersized Quick Actions widget up to its new width floor', () => {
    // Arrange — the w-branch lives next to the h-branch and never had its own
    // assertion before. If a future bump moves minSize.w independently of
    // minSize.h, the test that only checks h would silently miss the regression.
    const state = makeDashboardState([
      {
        widgets: [{ id: 'w1', type: 'quick-actions', x: 0, y: 0, w: 2, h: 5 }],
      },
    ])

    // Act
    migrateState(state, 1)

    // Assert
    expect(state.dashboard.pages[0].widgets[0].w).toBe(3)
    expect(state.dashboard.pages[0].widgets[0].h).toBe(5)
  })

  it('leaves a Quick Actions widget already at the height floor unchanged', () => {
    // Arrange
    const state = makeDashboardState([
      {
        widgets: [{ id: 'w1', type: 'quick-actions', x: 0, y: 0, w: 6, h: 3 }],
      },
    ])

    // Act
    migrateState(state, 1)

    // Assert
    expect(state.dashboard.pages[0].widgets[0].h).toBe(3)
  })

  it('does not shrink a Quick Actions widget taller than the floor (clamp is upward-only)', () => {
    // Arrange
    const state = makeDashboardState([
      {
        widgets: [{ id: 'w1', type: 'quick-actions', x: 0, y: 0, w: 6, h: 5 }],
      },
    ])

    // Act
    migrateState(state, 1)

    // Assert
    expect(state.dashboard.pages[0].widgets[0].h).toBe(5)
  })

  it('leaves widgets whose minSize did not change untouched (e.g., stats)', () => {
    // Arrange
    const state = makeDashboardState([
      { widgets: [{ id: 'w1', type: 'stats', x: 0, y: 0, w: 3, h: 2 }] },
    ])

    // Act
    migrateState(state, 1)

    // Assert
    expect(state.dashboard.pages[0].widgets[0].h).toBe(2)
    expect(state.dashboard.pages[0].widgets[0].w).toBe(3)
  })

  it('does not throw when the dashboard slice is missing', () => {
    // Arrange
    const state = {
      theme: {
        hue: 0,
        chroma: 0,
        mode: 'dark' as const,
        modePreference: 'dark' as const,
        preset: 'neutral-dark' as const,
      },
    }

    // Act & Assert
    expect(() => migrateState(state, 1)).not.toThrow()
  })

  it('does not throw when the dashboard slice is malformed', () => {
    // Arrange
    const state = {
      dashboard: 'not-an-object' as unknown,
    }

    // Act & Assert
    expect(() => migrateState(state, 1)).not.toThrow()
  })

  it('does not throw when the dashboard has no pages array', () => {
    // Arrange
    const state = { dashboard: {} as unknown }

    // Act & Assert
    expect(() => migrateState(state, 1)).not.toThrow()
  })

  it('skips a null page entry and still clamps the surviving page (no total-wipe)', () => {
    // Arrange — a null entry inside dashboard.pages used to crash on the next
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

    // Act
    expect(() => migrateState(state, 1)).not.toThrow()

    // Assert
    const dashboard = state.dashboard as {
      pages: Array<{ widgets: Array<{ h: number }> } | null>
    }
    expect(dashboard.pages[1]?.widgets[0].h).toBe(3)
  })

  it('skips a null widget entry and still clamps the surviving widget (no total-wipe)', () => {
    // Arrange
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

    // Act
    expect(() => migrateState(state, 1)).not.toThrow()

    // Assert
    const dashboard = state.dashboard as {
      pages: Array<{ widgets: Array<{ h: number } | null> }>
    }
    expect(dashboard.pages[0].widgets[1]?.h).toBe(3)
  })

  it('clamps every undersized widget across multiple pages while leaving others alone', () => {
    // Arrange
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

    // Act
    migrateState(state, 1)

    // Assert
    expect(state.dashboard.pages[0].widgets[0].h).toBe(3)
    expect(state.dashboard.pages[0].widgets[1].h).toBe(2) // stats untouched
    expect(state.dashboard.pages[1].widgets[0].h).toBe(3)
    // Quick Actions w: 3 already at the minimum — stays at 3.
    expect(state.dashboard.pages[1].widgets[0].w).toBe(3)
  })
})

describe('migrateState — v2 → v3 theme modePreference seeding', () => {
  it('seeds modePreference from dark mode and keeps mode intact', () => {
    // Arrange
    const state = {
      theme: {
        hue: 195,
        chroma: COLOR_PRESET_CHROMA,
        mode: 'dark' as const,
        preset: 'cyan' as const,
      } as unknown as ThemeState,
    }

    // Act
    const result = migrateState(state, 2)

    // Assert
    expect(result.theme!.mode).toBe('dark')
    expect(result.theme!.modePreference).toBe('dark')
    expect(result.theme!.preset).toBe('cyan')
    expect(result.theme!.hue).toBe(195)
  })

  it('seeds modePreference from light mode and keeps mode intact', () => {
    // Arrange
    const state = {
      theme: {
        hue: 0,
        chroma: 0,
        mode: 'light' as const,
        preset: 'neutral-light' as const,
      } as unknown as ThemeState,
    }

    // Act
    const result = migrateState(state, 2)

    // Assert
    expect(result.theme!.mode).toBe('light')
    expect(result.theme!.modePreference).toBe('light')
    expect(result.theme!.preset).toBe('neutral-light')
  })

  it('drops a null theme so reducer defaults take over', () => {
    // Arrange — tampered storage with theme set to null.
    const state = { theme: null as unknown as ThemeState }

    // Act
    const result = migrateState(state, 2)

    // Assert
    expect(result.theme).toBeUndefined()
  })

  it('falls back both mode and modePreference to dark when mode is invalid', () => {
    // Arrange — a tampered payload with an out-of-band mode value should not
    // produce a desynced (mode='dark', modePreference='light') state. Both
    // fields normalize to the same safe default.
    const state = {
      theme: {
        hue: 195,
        chroma: COLOR_PRESET_CHROMA,
        mode: 'twilight' as unknown as 'dark',
        preset: 'cyan' as const,
      } as unknown as ThemeState,
    }

    // Act
    const result = migrateState(state, 2)

    // Assert
    expect(result.theme!.mode).toBe('dark')
    expect(result.theme!.modePreference).toBe('dark')
  })

  it('does not introduce system preference for legacy users', () => {
    // Arrange — the whole point of the migration's defensive seeding is to
    // never surprise an existing user with auto-OS-tracking behavior they
    // never opted into.
    const state = {
      theme: {
        hue: 0,
        chroma: 0,
        mode: 'dark' as const,
        preset: 'neutral-dark' as const,
      } as unknown as ThemeState,
    }

    // Act
    const result = migrateState(state, 2)

    // Assert
    expect(result.theme!.modePreference).not.toBe('system')
  })

  it('chains v0 → v1 → v2 → v3 in one call, producing a v3 shape', () => {
    // Arrange — a fully legacy v0 payload (presetType discriminator, no
    // chroma, no modePreference) should land on the current schema after
    // a single migrateState() invocation. Catches regressions where the
    // chain breaks at an intermediate version.
    const state = {
      theme: {
        hue: 195,
        mode: 'dark' as const,
        preset: 'cyan',
        presetType: 'color',
      } as unknown as LegacyTheme,
    }

    // Act
    const result = migrateState(state, 0)

    // Assert
    expect(result.theme!.preset).toBe('cyan')
    expect(result.theme!.chroma).toBe(0.16)
    expect(result.theme!.mode).toBe('dark')
    expect(result.theme!.modePreference).toBe('dark')
  })
})

describe('migrateState — v3 → v4 dashboard health min-size clamp', () => {
  /**
   * Same envelope builder as the v1 → v2 block, scoped locally so this
   * describe stays self-contained (DAMP) — each test declares only the
   * widget it exercises instead of restating the dashboard boilerplate.
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
   * PR #185 added a "Scan issues" action row to the Symlink Health widget,
   * which clipped against the card's bottom edge at the old h: 2. The fix grew
   * `WIDGET_REGISTRY['health'].minSize.h` to 3; this migration rewrites layouts
   * persisted on the old floor so react-grid-layout doesn't re-clamp (and shove
   * neighbors) on first render.
   */
  it('grows an undersized Symlink Health widget up to its new height floor', () => {
    // Arrange
    const state = makeDashboardState([
      { widgets: [{ id: 'w1', type: 'health', x: 3, y: 3, w: 3, h: 2 }] },
    ])

    // Act
    migrateState(state, 3)

    // Assert
    expect(state.dashboard.pages[0].widgets[0].h).toBe(3)
    expect(state.dashboard.pages[0].widgets[0].w).toBe(3)
  })

  it('leaves a Symlink Health widget already at the height floor unchanged', () => {
    // Arrange
    const state = makeDashboardState([
      { widgets: [{ id: 'w1', type: 'health', x: 3, y: 3, w: 3, h: 3 }] },
    ])

    // Act
    migrateState(state, 3)

    // Assert
    expect(state.dashboard.pages[0].widgets[0].h).toBe(3)
  })

  it('does not shrink a Symlink Health widget taller than the floor (clamp is upward-only)', () => {
    // Arrange
    const state = makeDashboardState([
      { widgets: [{ id: 'w1', type: 'health', x: 3, y: 3, w: 3, h: 4 }] },
    ])

    // Act
    migrateState(state, 3)

    // Assert
    expect(state.dashboard.pages[0].widgets[0].h).toBe(4)
  })

  it('leaves widgets outside the v4 floor map untouched (e.g., stats)', () => {
    // Arrange — stats shares health's old { w: 3, h: 2 } footprint but is absent
    // from V4_WIDGET_MIN_SIZES, so the v3 → v4 clamp must leave it alone.
    const state = makeDashboardState([
      { widgets: [{ id: 'w1', type: 'stats', x: 0, y: 3, w: 3, h: 2 }] },
    ])

    // Act
    migrateState(state, 3)

    // Assert
    expect(state.dashboard.pages[0].widgets[0].h).toBe(2)
    expect(state.dashboard.pages[0].widgets[0].w).toBe(3)
  })

  it('does not throw when the dashboard slice is missing', () => {
    // Arrange
    const state = {
      theme: {
        hue: 0,
        chroma: 0,
        mode: 'dark' as const,
        modePreference: 'dark' as const,
        preset: 'neutral-dark' as const,
      },
    }

    // Act & Assert
    expect(() => migrateState(state, 3)).not.toThrow()
  })

  it('clamps the Symlink Health widget when migrating across the full v1 → v4 chain', () => {
    // Arrange — guards that `case 3` is actually wired into the switch: a layout
    // persisted way back at v1 must still pick up the v4 health floor in a
    // single migrateState() call (v1 → v2 leaves health alone, v2 → v3 is
    // theme-only, v3 → v4 clamps it).
    const state = makeDashboardState([
      { widgets: [{ id: 'w1', type: 'health', x: 3, y: 3, w: 3, h: 2 }] },
    ])

    // Act
    migrateState(state, 1)

    // Assert
    expect(state.dashboard.pages[0].widgets[0].h).toBe(3)
  })
})

describe('V2_WIDGET_MIN_SIZES drift guard', () => {
  // The map in migrations.ts mirrors `WIDGET_REGISTRY[*].minSize`. If anyone
  // bumps a widget's runtime min in the registry without updating the
  // migration map AND adding a new migration, persisted layouts on the prior
  // floor silently violate the registry constraint after upgrade. This test
  // catches the registry/migration desync at unit-test time, before users
  // see neighboring widgets get shoved by the runtime clamp.
  //
  // Note: this guard is intentionally one-way. It iterates only entries
  // present in `V2_WIDGET_MIN_SIZES`, so a future bump of
  // `WIDGET_REGISTRY[type].minSize` for a widget *not* in the v2 map will
  // not fail this test. That is correct for a frozen v2 floor — the right
  // response to a future registry bump is to add `V3_WIDGET_MIN_SIZES`
  // alongside a `migrateV2ToV3`, not to retroactively expand v2's scope.
  it('stays in sync with the live registry so persisted v2 layouts never violate runtime minimums', () => {
    // Act & Assert — every frozen v2 floor entry must still match the
    // registry's current minSize; a desync fails here before users see
    // neighbors shoved by the runtime clamp.
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

describe('V4_WIDGET_MIN_SIZES drift guard', () => {
  // Mirrors the V2 guard: `V4_WIDGET_MIN_SIZES` must stay in sync with
  // `WIDGET_REGISTRY[*].minSize`. If someone changes the health widget's
  // runtime min again without updating this map AND shipping a migration,
  // persisted layouts on the prior floor silently violate the registry
  // constraint after upgrade. One-way by design (see the V2 guard note): a
  // future bump of a widget NOT in the v4 map is the trigger to add a V5 floor
  // + migrateV4ToV5, not to retroactively widen v4's scope.
  it('stays in sync with the live registry so persisted v4 layouts never violate runtime minimums', () => {
    // Act & Assert — every frozen v4 floor entry must still match the
    // registry's current minSize; a desync fails here before users see
    // neighbors shoved by the runtime clamp.
    for (const [type, min] of Object.entries(V4_WIDGET_MIN_SIZES)) {
      const registryEntry =
        WIDGET_REGISTRY[type as keyof typeof WIDGET_REGISTRY]
      expect(
        registryEntry,
        `V4_WIDGET_MIN_SIZES has '${type}' but WIDGET_REGISTRY does not`,
      ).toBeDefined()
      expect(
        registryEntry.minSize,
        `WIDGET_REGISTRY['${type}'].minSize is missing — bump migrations or registry`,
      ).toEqual(min)
    }
  })
})

describe('migrateState — drift guard', () => {
  it('migrates from every supported version without throwing when a new schema version ships', () => {
    // Act & Assert — if PERSIST_STATE_VERSION is bumped without adding a
    // matching migrateVNToV(N+1) branch, the switch's default-case throw fires
    // here. Keep each iteration producing a valid theme so regressions in a
    // specific version's handler surface as a concrete failure.
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

  it('fails fast with a clear error for a corrupted out-of-band source version', () => {
    // Arrange — a negative or out-of-band version (corrupted localStorage)
    // should fail fast with a clear error pointing at the missing branch.
    const state = {
      theme: {
        hue: 0,
        chroma: 0,
        mode: 'dark' as const,
        modePreference: 'dark' as const,
        preset: 'neutral-dark' as const,
      },
    }

    // Act & Assert
    expect(() => migrateState(state, -1)).toThrow(/no path from v-1/)
  })
})
