import { describe, expect, it } from 'vitest'

import { THEME_PRESETS } from '@/shared/constants'

import type { MigratableState } from './migrations'

/**
 * Regression tests for the full theme migration chain. Every user upgrading
 * from a pre-chroma release runs this path exactly once, and a silent
 * failure corrupts localStorage for that user forever. These tests pin the
 * end-state contract so future theme refactors cannot regress it.
 *
 * Each `migrate(state, 0)` call walks v0 → v1 → v2 → v3, so the expected
 * shape below is the post-chain (v3) shape including `modePreference`,
 * which v2 → v3 seeds from `state.mode`.
 */
async function migrate(
  state: Record<string, unknown> | null | undefined,
  oldVersion: number,
) {
  const { migrateState } = await import('./migrations')
  return migrateState(state as MigratableState, oldVersion)
}

describe('migrateState (v0 → v3 theme chain)', () => {
  it('upgrades a legacy color preset (cyan dark) into the full current theme shape', async () => {
    // Arrange
    const state = {
      theme: {
        hue: 195,
        mode: 'dark',
        preset: 'cyan',
        presetType: 'color',
      },
    }

    // Act
    const result = await migrate(state, 0)

    // Assert
    expect(result.theme).toEqual({
      hue: 195,
      chroma: 0.16,
      mode: 'dark',
      modePreference: 'dark',
      preset: 'cyan',
    })
  })

  it('upgrades a legacy neutral preset (neutral-light) into the full current theme shape', async () => {
    // Arrange
    const state = {
      theme: {
        hue: 0,
        mode: 'light',
        preset: 'neutral-light',
        presetType: 'neutral',
      },
    }

    // Act
    const result = await migrate(state, 0)

    // Assert
    expect(result.theme).toEqual({
      hue: 0,
      chroma: 0,
      mode: 'light',
      modePreference: 'light',
      preset: 'neutral-light',
    })
  })

  it('rescues a preset name that was renamed away to neutral-dark', async () => {
    // Arrange — simulates a user whose persisted state has a preset name that
    // was later removed or renamed (plan proposed `mono-dark` which was never
    // shipped; this guards against that class of drift).
    const state = {
      theme: {
        hue: 0,
        mode: 'dark',
        preset: 'mono-dark',
        presetType: 'neutral',
      },
    }

    // Act
    const result = await migrate(state, 0)

    // Assert
    expect(result.theme?.preset).toBe('neutral-dark')
  })

  it('rescues a missing preset field to neutral-dark', async () => {
    // Arrange
    const state = {
      theme: { hue: 0, mode: 'dark', presetType: 'neutral' },
    }

    // Act
    const result = await migrate(state, 0)

    // Assert
    expect(result.theme?.preset).toBe('neutral-dark')
  })

  it('drops a null theme slot so the reducer initial state takes over', async () => {
    // Arrange
    const state = { theme: null }

    // Act
    const result = await migrate(state, 0)

    // Assert
    expect(result.theme).toBeUndefined()
  })

  it('drops a non-object theme slot from tampered storage', async () => {
    // Arrange
    const state = { theme: 'garbage' }

    // Act
    const result = await migrate(state as never, 0)

    // Assert
    expect(result.theme).toBeUndefined()
  })

  it('leaves an undefined theme slot alone instead of fabricating one', async () => {
    // Arrange
    const state = {}

    // Act
    const result = await migrate(state, 0)

    // Assert
    expect(result.theme).toBeUndefined()
  })

  it('preserves a tampered current-schema theme when the stored version already matches', async () => {
    // Arrange — storage-middleware guarantees migrate is only called when
    // versions differ, but if someone tampered with the stored `version` field
    // we must not overwrite a valid current-schema state with legacy defaults.
    const { PERSIST_STATE_VERSION } = await import('@/shared/constants')
    const currentState = {
      theme: {
        hue: 195,
        chroma: 0.18,
        mode: 'dark',
        modePreference: 'dark',
        preset: 'cyan',
      },
    }

    // Act
    const result = await migrate(currentState, PERSIST_STATE_VERSION)

    // Assert
    expect(result.theme).toEqual(currentState.theme)
  })

  it('repairs a non-numeric hue to a safe 0', async () => {
    // Arrange
    const state = {
      theme: {
        hue: 'not-a-number',
        mode: 'dark',
        preset: 'neutral-dark',
        presetType: 'neutral',
      },
    }

    // Act
    const result = await migrate(state as never, 0)

    // Assert
    expect(result.theme?.hue).toBe(0)
  })

  it('repairs an invalid mode to dark', async () => {
    // Arrange
    const state = {
      theme: {
        hue: 0,
        mode: 'purple',
        preset: 'neutral-dark',
        presetType: 'neutral',
      },
    }

    // Act
    const result = await migrate(state as never, 0)

    // Assert
    expect(result.theme?.mode).toBe('dark')
  })

  it('paints a legacy color preset with full chroma', async () => {
    // Arrange
    const state = {
      theme: {
        hue: 300,
        mode: 'dark',
        preset: 'violet',
        presetType: 'color',
      },
    }

    // Act
    const result = await migrate(state, 0)

    // Assert
    expect(result.theme?.chroma).toBe(0.16)
  })

  it('leaves a legacy neutral preset (or missing presetType) grayscale', async () => {
    // Arrange
    const state = {
      theme: { hue: 0, mode: 'dark', preset: 'neutral-dark' },
    }

    // Act
    const result = await migrate(state, 0)

    // Assert
    expect(result.theme?.chroma).toBe(0)
  })

  it('keeps every shipped preset name selectable after migration', async () => {
    // Act & Assert — regression guard: if a future refactor removes a preset
    // key from THEME_PRESETS, this test catches it before shipping.
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
