import { describe, expect, it } from 'vitest'

import {
  COLOR_PRESET_CHROMA,
  PERSIST_STATE_VERSION,
  THEME_PRESETS,
} from '../../../shared/constants'

import { migrateState } from './migrations'
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
