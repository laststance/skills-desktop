import { describe, it, expect } from 'vitest'

import { DEFAULT_SETTINGS, SettingsSchema } from './settings'

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
})
