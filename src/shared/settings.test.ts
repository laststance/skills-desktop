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
  it('parsing an empty object fills in every default field', () => {
    const parsed = SettingsSchema.parse({})
    expect(parsed.defaultSkillTab).toBe('files')
    expect(parsed.preferredTerminal).toBe('terminal')
    expect(parsed.windowBackgroundBlurRadius).toBe(
      WINDOW_BACKGROUND_BLUR_MIN_RADIUS,
    )
  })

  it('legacy settings.json with only defaultSkillTab gets preferredTerminal default', () => {
    // Simulates a user who upgraded from a pre-feature build — their
    // settings.json on disk has no `preferredTerminal` key. Without a
    // `.default()` they would crash on validation.
    const parsed = SettingsSchema.parse({ defaultSkillTab: 'info' })
    expect(parsed.preferredTerminal).toBe('terminal')
    expect(parsed.defaultSkillTab).toBe('info')
  })

  it('rejects an unknown preferredTerminal value', () => {
    expect(() =>
      SettingsSchema.parse({ preferredTerminal: 'fish-shell' }),
    ).toThrow()
  })

  it('accepts every curated terminal id', () => {
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

  it('trims customTerminalAppName and rejects empty post-trim', () => {
    expect(() =>
      SettingsSchema.parse({ customTerminalAppName: '   ' }),
    ).toThrow()
  })

  it('rejects customTerminalAppName longer than 64 chars', () => {
    expect(() =>
      SettingsSchema.parse({ customTerminalAppName: 'a'.repeat(65) }),
    ).toThrow()
  })

  it('accepts customTerminalAppName at exactly 64 chars', () => {
    const sixtyFour = 'a'.repeat(64)
    const parsed = SettingsSchema.parse({ customTerminalAppName: sixtyFour })
    expect(parsed.customTerminalAppName).toBe(sixtyFour)
  })

  /**
   * Drift guard: if anyone edits SettingsSchema and forgets to update
   * DEFAULT_SETTINGS (or vice versa), this test fails. The static defaults
   * are duplicated by design (so they don't cost a Zod parse at boot) but
   * MUST stay in lockstep with the schema.
   */
  it('DEFAULT_SETTINGS matches SettingsSchema.parse({})', () => {
    expect(DEFAULT_SETTINGS).toEqual(SettingsSchema.parse({}))
  })

  it('windowSize is optional and defaults to undefined', () => {
    const parsed = SettingsSchema.parse({})
    expect(parsed.windowSize).toBeUndefined()
  })

  it('accepts a windowSize at the minimum dimension', () => {
    const parsed = SettingsSchema.parse({
      windowSize: {
        width: WINDOW_SIZE_MIN_DIMENSION,
        height: WINDOW_SIZE_MIN_DIMENSION,
      },
    })
    expect(parsed.windowSize).toEqual({
      width: WINDOW_SIZE_MIN_DIMENSION,
      height: WINDOW_SIZE_MIN_DIMENSION,
    })
  })

  it('rejects a windowSize below the minimum dimension', () => {
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
    const parsed = SettingsSchema.parse({
      windowBackgroundBlurRadius: WINDOW_BACKGROUND_BLUR_MAX_RADIUS,
    })
    expect(parsed.windowBackgroundBlurRadius).toBe(
      WINDOW_BACKGROUND_BLUR_MAX_RADIUS,
    )
  })

  it('rejects a windowBackgroundBlurRadius outside the bounded range', () => {
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
    expect(() =>
      SettingsSchema.parse({ windowBackgroundBlurRadius: 12.5 }),
    ).toThrow()
  })

  it('hiddenAgentIds defaults to an empty array on a fresh parse', () => {
    const parsed = SettingsSchema.parse({})
    expect(parsed.hiddenAgentIds).toEqual([])
  })

  it('accepts an installed agent id in hiddenAgentIds', () => {
    const firstAgentId = AGENT_DEFINITIONS[0]!.id
    const parsed = SettingsSchema.parse({ hiddenAgentIds: [firstAgentId] })
    expect(parsed.hiddenAgentIds).toEqual([firstAgentId])
  })

  it('drops unknown agent ids from hiddenAgentIds without rejecting the file', () => {
    // The schema is forgiving on disk reads — strict z.enum here would
    // throw the WHOLE settings file out (and reset every other field to
    // defaults) when one stale id slips in.
    const parsed = SettingsSchema.parse({
      hiddenAgentIds: ['bogus-agent'],
    })
    expect(parsed.hiddenAgentIds).toEqual([])
  })

  it('preserves valid hiddenAgentIds while dropping stale ids alongside', () => {
    // Regression for the `/cli-upgrade`-removed-an-agent scenario: with
    // strict z.enum the whole array (and everything else in settings.json)
    // would reject. The transform must filter, not throw.
    const firstAgentId = AGENT_DEFINITIONS[0]!.id
    const parsed = SettingsSchema.parse({
      hiddenAgentIds: [firstAgentId, 'removed-agent'],
    })
    expect(parsed.hiddenAgentIds).toEqual([firstAgentId])
  })

  it('preserves all other settings fields when hiddenAgentIds contains stale ids', () => {
    // The blast radius of a strict-enum failure was every field in the
    // file dropping back to defaults. Pin the boundary here so a future
    // refactor can't quietly resurrect that behavior.
    const parsed = SettingsSchema.parse({
      defaultSkillTab: 'info',
      preferredTerminal: 'iterm',
      hiddenAgentIds: ['removed-agent'],
    })
    expect(parsed.defaultSkillTab).toBe('info')
    expect(parsed.preferredTerminal).toBe('iterm')
    expect(parsed.hiddenAgentIds).toEqual([])
  })

  it('rejects a non-array hiddenAgentIds', () => {
    expect(() =>
      SettingsSchema.parse({ hiddenAgentIds: 'claude-code' }),
    ).toThrow()
  })

  it('drops non-string elements without rejecting the file', () => {
    // Regression for the array-element-validation cliff: with the prior
    // `z.array(z.string())` element schema, a single non-string entry
    // (e.g. a hand-edited `123`) would fail BEFORE `.transform()` ran,
    // taking the whole settings parse down with it. Element type is
    // `z.unknown()` so the typeof-string filter inside transform can
    // do its job — same forgiving contract as the stale-id case.
    const firstAgentId = AGENT_DEFINITIONS[0]!.id
    const parsed = SettingsSchema.parse({
      defaultSkillTab: 'info',
      hiddenAgentIds: [firstAgentId, 123, null, { not: 'a string' }],
    })
    expect(parsed.defaultSkillTab).toBe('info')
    expect(parsed.hiddenAgentIds).toEqual([firstAgentId])
  })

  it('deduplicates hiddenAgentIds on parse', () => {
    // A hand-edited settings.json containing duplicates would otherwise
    // false-positive the length-then-membership equality check in
    // `areSettingsEqual` (e.g. ['cursor','cursor'] vs ['cursor','claude-code']
    // would compare equal and silently drop the legitimate write). The
    // disk schema deduplicates so the equality contract stays honest.
    const firstAgentId = AGENT_DEFINITIONS[0]!.id
    const parsed = SettingsSchema.parse({
      hiddenAgentIds: [firstAgentId, firstAgentId],
    })
    expect(parsed.hiddenAgentIds).toEqual([firstAgentId])
  })
})

/**
 * Pure helpers shared by the main process and renderer. These keep Electron's
 * native backplate and the real Electron window opacity on the same curve.
 */
describe('window background appearance helpers', () => {
  it('clamps blur radius values before opacity math', () => {
    expect(normalizeWindowBackgroundBlurRadius(-12)).toBe(
      WINDOW_BACKGROUND_BLUR_MIN_RADIUS,
    )
    expect(normalizeWindowBackgroundBlurRadius(12.9)).toBe(12)
    expect(normalizeWindowBackgroundBlurRadius(99)).toBe(
      WINDOW_BACKGROUND_BLUR_MAX_RADIUS,
    )
  })

  it('maps disabled blur to an opaque app surface', () => {
    expect(getWindowBackgroundOpacity(0)).toBe(WINDOW_BACKGROUND_OPACITY_MAX)
  })

  it('maps maximum blur to the minimum readable surface opacity', () => {
    expect(getWindowBackgroundOpacity(WINDOW_BACKGROUND_BLUR_MAX_RADIUS)).toBe(
      WINDOW_BACKGROUND_OPACITY_MIN,
    )
  })

  it('maps mid slider values to visibly different opacity', () => {
    expect(getWindowBackgroundOpacity(24)).toBe(0.72)
  })
})
