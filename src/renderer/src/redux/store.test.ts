import { describe, expect, it } from 'vitest'

import { COLOR_PRESET_CHROMA, THEME_PRESETS } from '../../../shared/constants'

import type { MigratableState } from './migrations'

/**
 * Regression tests for the v0 → v1 theme migration in migrations.ts. Every
 * user upgrading from a pre-chroma release runs this path exactly once, and
 * a silent failure corrupts localStorage for that user forever. These tests
 * pin the contract so future theme refactors cannot regress it.
 */
async function migrate(
  state: Record<string, unknown> | null | undefined,
  oldVersion: number,
) {
  const { migrateState } = await import('./migrations')
  return migrateState(state as MigratableState, oldVersion)
}

describe('migrateState (v0 → v1 theme)', () => {
  it('migrates a valid color preset (cyan dark) to v1 shape', async () => {
    const state = {
      theme: {
        hue: 195,
        mode: 'dark',
        preset: 'cyan',
        presetType: 'color',
      },
    }
    const result = await migrate(state, 0)
    expect(result.theme).toEqual({
      hue: 195,
      chroma: COLOR_PRESET_CHROMA,
      mode: 'dark',
      preset: 'cyan',
    })
  })

  it('migrates a valid neutral preset (neutral-light) to v1 shape', async () => {
    const state = {
      theme: {
        hue: 0,
        mode: 'light',
        preset: 'neutral-light',
        presetType: 'neutral',
      },
    }
    const result = await migrate(state, 0)
    expect(result.theme).toEqual({
      hue: 0,
      chroma: 0,
      mode: 'light',
      preset: 'neutral-light',
    })
  })

  it('falls back to neutral-dark when preset is an unknown string', async () => {
    // Simulates a user whose persisted state has a preset name that was
    // later removed or renamed (plan proposed `mono-dark` which was never
    // shipped; this guards against that class of drift).
    const state = {
      theme: {
        hue: 0,
        mode: 'dark',
        preset: 'mono-dark',
        presetType: 'neutral',
      },
    }
    const result = await migrate(state, 0)
    expect(result.theme?.preset).toBe('neutral-dark')
  })

  it('falls back to neutral-dark when preset field is missing', async () => {
    const state = {
      theme: { hue: 0, mode: 'dark', presetType: 'neutral' },
    }
    const result = await migrate(state, 0)
    expect(result.theme?.preset).toBe('neutral-dark')
  })

  it('drops a null theme slot so the reducer initial state takes over', async () => {
    const state = { theme: null }
    const result = await migrate(state, 0)
    expect(result.theme).toBeUndefined()
  })

  it('drops a non-object theme slot (tampered storage)', async () => {
    const state = { theme: 'garbage' }
    const result = await migrate(state as never, 0)
    expect(result.theme).toBeUndefined()
  })

  it('handles an undefined theme slot as a no-op', async () => {
    const state = {}
    const result = await migrate(state, 0)
    expect(result.theme).toBeUndefined()
  })

  it('skips migration entirely when oldVersion >= 1', async () => {
    // Storage-middleware guarantees migrate is only called when versions
    // differ, but if someone tampered with the stored `version` field we
    // must not overwrite a valid v1 state with legacy defaults.
    const v1State = {
      theme: {
        hue: 195,
        chroma: 0.18,
        mode: 'dark',
        preset: 'cyan',
      },
    }
    const result = await migrate(v1State, 1)
    expect(result.theme).toEqual(v1State.theme)
  })

  it('coerces non-numeric hue to 0', async () => {
    const state = {
      theme: {
        hue: 'not-a-number',
        mode: 'dark',
        preset: 'neutral-dark',
        presetType: 'neutral',
      },
    }
    const result = await migrate(state as never, 0)
    expect(result.theme?.hue).toBe(0)
  })

  it('coerces an invalid mode to dark', async () => {
    const state = {
      theme: {
        hue: 0,
        mode: 'purple',
        preset: 'neutral-dark',
        presetType: 'neutral',
      },
    }
    const result = await migrate(state as never, 0)
    expect(result.theme?.mode).toBe('dark')
  })

  it('translates presetType=color to COLOR_PRESET_CHROMA', async () => {
    const state = {
      theme: {
        hue: 300,
        mode: 'dark',
        preset: 'violet',
        presetType: 'color',
      },
    }
    const result = await migrate(state, 0)
    expect(result.theme?.chroma).toBe(COLOR_PRESET_CHROMA)
  })

  it('translates presetType=neutral (or missing) to chroma=0', async () => {
    const state = {
      theme: { hue: 0, mode: 'dark', preset: 'neutral-dark' },
    }
    const result = await migrate(state, 0)
    expect(result.theme?.chroma).toBe(0)
  })

  it('every preset name in THEME_PRESETS survives migration unchanged', async () => {
    // Regression guard: if a future refactor removes a preset key from
    // THEME_PRESETS, this test catches it before shipping.
    for (const name of Object.keys(THEME_PRESETS)) {
      const config = THEME_PRESETS[name as keyof typeof THEME_PRESETS]
      const state = {
        theme: {
          hue: config.hue,
          mode: 'mode' in config ? config.mode : 'dark',
          preset: name,
          presetType: config.chroma === 0 ? 'neutral' : 'color',
        },
      }
      const result = await migrate(state, 0)
      expect(result.theme?.preset).toBe(name)
    }
  })
})
