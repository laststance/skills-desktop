import { describe, it, expect } from 'vitest'

import { AGENT_DEFINITIONS } from './constants'
import {
  DEFAULT_SETTINGS,
  getWindowBackgroundOpacity,
  normalizeWindowBackgroundBlurRadius,
  SettingsSchema,
  WINDOW_BACKGROUND_BLUR_MAX_RADIUS,
  WINDOW_BACKGROUND_BLUR_MIN_RADIUS,
  WINDOW_BACKGROUND_OPACITY_MIN,
  WINDOW_BACKGROUND_OPACITY_MAX,
  WINDOW_SIZE_MIN_DIMENSION,
} from './settings'

/**
 * Schema-level tests for `SettingsSchema`. These are the canary that fires
 * when the source-of-truth schema and the static `DEFAULT_SETTINGS` drift
 * apart, or when a future field migration silently breaks an existing
 * settings.json on disk.
 */
describe('SettingsSchema', () => {
  it('fills in every default field when parsing an empty settings object', () => {
    // Arrange / Act
    const parsed = SettingsSchema.parse({})
    // Assert
    expect(parsed.defaultSkillTab).toBe('files')
    expect(parsed.preferredTerminal).toBe('terminal')
    expect(parsed.windowBackgroundBlurRadius).toBe(
      WINDOW_BACKGROUND_BLUR_MIN_RADIUS,
    )
  })

  it('backfills the preferredTerminal default for a legacy settings.json that predates the field', () => {
    // Simulates a user who upgraded from a pre-feature build — their
    // settings.json on disk has no `preferredTerminal` key. Without a
    // `.default()` they would crash on validation.
    // Arrange / Act
    const parsed = SettingsSchema.parse({ defaultSkillTab: 'info' })
    // Assert
    expect(parsed.preferredTerminal).toBe('terminal')
    expect(parsed.defaultSkillTab).toBe('info')
  })

  it('rejects an unknown preferredTerminal value', () => {
    // Arrange / Act / Assert
    expect(() =>
      SettingsSchema.parse({ preferredTerminal: 'fish-shell' }),
    ).toThrow()
  })

  it('accepts every curated terminal id', () => {
    // Arrange / Act / Assert
    for (const id of [
      'terminal',
      'iterm',
      'warp',
      'ghostty',
      'alacritty',
      'kitty',
      'wezterm',
      'custom',
    ] as const) {
      expect(() =>
        SettingsSchema.parse({ preferredTerminal: id }),
      ).not.toThrow()
    }
  })

  it('rejects a customTerminalAppName that is only whitespace after trimming', () => {
    // Arrange / Act / Assert
    expect(() =>
      SettingsSchema.parse({ customTerminalAppName: '   ' }),
    ).toThrow()
  })

  it('rejects a customTerminalAppName longer than 64 chars', () => {
    // Arrange / Act / Assert
    expect(() =>
      SettingsSchema.parse({ customTerminalAppName: 'a'.repeat(65) }),
    ).toThrow()
  })

  it('accepts a customTerminalAppName at exactly the 64-char limit', () => {
    // Arrange
    const sixtyFour = 'a'.repeat(64)
    // Act
    const parsed = SettingsSchema.parse({ customTerminalAppName: sixtyFour })
    // Assert
    expect(parsed.customTerminalAppName).toBe(sixtyFour)
  })

  /**
   * Drift guard: if anyone edits SettingsSchema and forgets to update
   * DEFAULT_SETTINGS (or vice versa), this test fails. The static defaults
   * are duplicated by design (so they don't cost a Zod parse at boot) but
   * MUST stay in lockstep with the schema.
   */
  it('keeps DEFAULT_SETTINGS in lockstep with what the schema produces from an empty object', () => {
    // Arrange / Act
    const schemaDefaults = SettingsSchema.parse({})
    // Assert
    expect(DEFAULT_SETTINGS).toEqual(schemaDefaults)
  })

  it('defaults autoDownloadUpdates to off so a fresh install keeps manual confirm-via-UI downloads', () => {
    // Arrange / Act
    const parsed = SettingsSchema.parse({})
    // Assert
    expect(parsed.autoDownloadUpdates).toBe(false)
  })

  it('persists opting into background downloads', () => {
    // Arrange / Act
    const parsed = SettingsSchema.parse({
      autoDownloadUpdates: true,
    })
    // Assert
    expect(parsed.autoDownloadUpdates).toBe(true)
  })

  it('rejects a non-boolean autoDownloadUpdates', () => {
    // Arrange / Act / Assert
    expect(() => SettingsSchema.parse({ autoDownloadUpdates: 'yes' })).toThrow()
  })

  it('leaves windowSize unset when none is stored', () => {
    // Arrange / Act
    const parsed = SettingsSchema.parse({})
    // Assert
    expect(parsed.windowSize).toBeUndefined()
  })

  it('accepts a windowSize at the minimum dimension', () => {
    // Arrange / Act
    const parsed = SettingsSchema.parse({
      windowSize: {
        width: WINDOW_SIZE_MIN_DIMENSION,
        height: WINDOW_SIZE_MIN_DIMENSION,
      },
    })
    // Assert
    expect(parsed.windowSize).toEqual({
      width: WINDOW_SIZE_MIN_DIMENSION,
      height: WINDOW_SIZE_MIN_DIMENSION,
    })
  })

  it('rejects a windowSize below the minimum dimension', () => {
    // Arrange / Act / Assert
    expect(() =>
      SettingsSchema.parse({
        windowSize: {
          width: WINDOW_SIZE_MIN_DIMENSION - 1,
          height: WINDOW_SIZE_MIN_DIMENSION,
        },
      }),
    ).toThrow()
    expect(() =>
      SettingsSchema.parse({
        windowSize: {
          width: WINDOW_SIZE_MIN_DIMENSION,
          height: WINDOW_SIZE_MIN_DIMENSION - 1,
        },
      }),
    ).toThrow()
  })

  it('rejects a non-integer windowSize', () => {
    // Arrange / Act / Assert
    expect(() =>
      SettingsSchema.parse({
        windowSize: {
          width: WINDOW_SIZE_MIN_DIMENSION + 0.5,
          height: WINDOW_SIZE_MIN_DIMENSION,
        },
      }),
    ).toThrow()
  })

  it('accepts a windowBackgroundBlurRadius within the bounded range', () => {
    // Arrange / Act
    const parsed = SettingsSchema.parse({
      windowBackgroundBlurRadius: WINDOW_BACKGROUND_BLUR_MAX_RADIUS,
    })
    // Assert
    expect(parsed.windowBackgroundBlurRadius).toBe(
      WINDOW_BACKGROUND_BLUR_MAX_RADIUS,
    )
  })

  it('rejects a windowBackgroundBlurRadius outside the bounded range', () => {
    // Arrange / Act / Assert
    expect(() =>
      SettingsSchema.parse({
        windowBackgroundBlurRadius: WINDOW_BACKGROUND_BLUR_MIN_RADIUS - 1,
      }),
    ).toThrow()
    expect(() =>
      SettingsSchema.parse({
        windowBackgroundBlurRadius: WINDOW_BACKGROUND_BLUR_MAX_RADIUS + 1,
      }),
    ).toThrow()
  })

  it('rejects a non-integer windowBackgroundBlurRadius', () => {
    // Arrange / Act / Assert
    expect(() =>
      SettingsSchema.parse({ windowBackgroundBlurRadius: 12.5 }),
    ).toThrow()
  })

  it('hides no agents by default on a fresh parse', () => {
    // Arrange / Act
    const parsed = SettingsSchema.parse({})
    // Assert
    expect(parsed.hiddenAgentIds).toEqual([])
  })

  it('keeps a hidden agent id that matches an installed agent', () => {
    // Arrange
    const firstAgentId = AGENT_DEFINITIONS[0]!.id
    // Act
    const parsed = SettingsSchema.parse({ hiddenAgentIds: [firstAgentId] })
    // Assert
    expect(parsed.hiddenAgentIds).toEqual([firstAgentId])
  })

  it('drops an unknown hidden agent id instead of rejecting the whole settings file', () => {
    // The schema is forgiving on disk reads — strict z.enum here would
    // throw the WHOLE settings file out (and reset every other field to
    // defaults) when one stale id slips in.
    // Arrange / Act
    const parsed = SettingsSchema.parse({
      hiddenAgentIds: ['bogus-agent'],
    })
    // Assert
    expect(parsed.hiddenAgentIds).toEqual([])
  })

  it('keeps the valid hidden agent ids and drops the stale ones beside them', () => {
    // Regression for the Skills-CLI-removed-an-agent scenario: with
    // strict z.enum the whole array (and everything else in settings.json)
    // would reject. The transform must filter, not throw.
    // Arrange
    const firstAgentId = AGENT_DEFINITIONS[0]!.id
    // Act
    const parsed = SettingsSchema.parse({
      hiddenAgentIds: [firstAgentId, 'removed-agent'],
    })
    // Assert
    expect(parsed.hiddenAgentIds).toEqual([firstAgentId])
  })

  it('does not reset every other settings field when hiddenAgentIds carries a stale id', () => {
    // The blast radius of a strict-enum failure was every field in the
    // file dropping back to defaults. Pin the boundary here so a future
    // refactor can't quietly resurrect that behavior.
    // Arrange / Act
    const parsed = SettingsSchema.parse({
      defaultSkillTab: 'info',
      preferredTerminal: 'iterm',
      hiddenAgentIds: ['removed-agent'],
    })
    // Assert
    expect(parsed.defaultSkillTab).toBe('info')
    expect(parsed.preferredTerminal).toBe('iterm')
    expect(parsed.hiddenAgentIds).toEqual([])
  })

  it('rejects a non-array hiddenAgentIds', () => {
    // Arrange / Act / Assert
    expect(() =>
      SettingsSchema.parse({ hiddenAgentIds: 'claude-code' }),
    ).toThrow()
  })

  it('drops non-string hiddenAgentIds entries instead of rejecting the whole settings file', () => {
    // Regression for the array-element-validation cliff: with the prior
    // `z.array(z.string())` element schema, a single non-string entry
    // (e.g. a hand-edited `123`) would fail BEFORE `.transform()` ran,
    // taking the whole settings parse down with it. Element type is
    // `z.unknown()` so the typeof-string filter inside transform can
    // do its job — same forgiving contract as the stale-id case.
    // Arrange
    const firstAgentId = AGENT_DEFINITIONS[0]!.id
    // Act
    const parsed = SettingsSchema.parse({
      defaultSkillTab: 'info',
      hiddenAgentIds: [firstAgentId, 123, null, { not: 'a string' }],
    })
    // Assert
    expect(parsed.defaultSkillTab).toBe('info')
    expect(parsed.hiddenAgentIds).toEqual([firstAgentId])
  })

  it('collapses duplicate hiddenAgentIds so the settings-equality check stays honest', () => {
    // A hand-edited settings.json containing duplicates would otherwise
    // false-positive the length-then-membership equality check in
    // `areSettingsEqual` (e.g. ['cursor','cursor'] vs ['cursor','claude-code']
    // would compare equal and silently drop the legitimate write). The
    // disk schema deduplicates so the equality contract stays honest.
    // Arrange
    const firstAgentId = AGENT_DEFINITIONS[0]!.id
    // Act
    const parsed = SettingsSchema.parse({
      hiddenAgentIds: [firstAgentId, firstAgentId],
    })
    // Assert
    expect(parsed.hiddenAgentIds).toEqual([firstAgentId])
  })
})

/**
 * Pure helpers shared by the main process and renderer. These keep Electron's
 * native backplate and the real Electron window opacity on the same curve.
 */
describe('window background appearance helpers', () => {
  it('clamps an out-of-range blur radius and floors a fractional one before opacity math', () => {
    // Arrange / Act / Assert
    expect(normalizeWindowBackgroundBlurRadius(-12)).toBe(
      WINDOW_BACKGROUND_BLUR_MIN_RADIUS,
    )
    expect(normalizeWindowBackgroundBlurRadius(12.9)).toBe(12)
    expect(normalizeWindowBackgroundBlurRadius(99)).toBe(
      WINDOW_BACKGROUND_BLUR_MAX_RADIUS,
    )
  })

  it('keeps the app surface fully opaque when blur is disabled', () => {
    // Arrange / Act
    const opacity = getWindowBackgroundOpacity(0)
    // Assert
    expect(opacity).toBe(WINDOW_BACKGROUND_OPACITY_MAX)
  })

  it('drops the app surface to the minimum readable opacity at maximum blur', () => {
    // Arrange / Act
    const opacity = getWindowBackgroundOpacity(
      WINDOW_BACKGROUND_BLUR_MAX_RADIUS,
    )
    // Assert
    expect(opacity).toBe(WINDOW_BACKGROUND_OPACITY_MIN)
  })

  it('gives a mid-slider blur a visibly distinct surface opacity', () => {
    // Arrange / Act
    const opacity = getWindowBackgroundOpacity(24)
    // Assert
    expect(opacity).toBe(0.72)
  })
})
