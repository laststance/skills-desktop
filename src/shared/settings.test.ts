import { describe, test, expect } from 'vitest'

import { AGENT_DEFINITIONS } from './constants'
import {
  CODE_FONT_SIZE_MAX_PX,
  CODE_FONT_SIZE_MIN_PX,
  DEFAULT_SETTINGS,
  MARKDOWN_FONT_SIZE_MAX_PX,
  MARKDOWN_FONT_SIZE_MIN_PX,
  SettingsSchema,
  WINDOW_SIZE_MIN_DIMENSION,
} from './settings'

/**
 * Schema-level tests for `SettingsSchema`. These are the canary that fires
 * when the source-of-truth schema and the static `DEFAULT_SETTINGS` drift
 * apart, or when a future field migration silently breaks an existing
 * settings.json on disk.
 */
describe('SettingsSchema', () => {
  test('restores the shared background percentage in Entire mode and starts each section opaque', () => {
    // Arrange
    const savedSettings = { windowBackgroundOpacityPercent: 90 }
    // Act
    const settings = SettingsSchema.parse(savedSettings)
    // Assert
    expect(settings).toMatchObject({
      windowBackgroundOpacityPercent: 90,
      windowOpacityMode: 'entire',
      leftSectionOpacityPercent: 100,
      centerSectionOpacityPercent: 100,
      rightSectionOpacityPercent: 100,
    })
  })

  test('restores independent section percentages without changing the saved Entire intensity', () => {
    // Arrange
    const persistedSettings = {
      windowBackgroundOpacityPercent: 90,
      windowOpacityMode: 'section',
      leftSectionOpacityPercent: 85,
      centerSectionOpacityPercent: 95,
      rightSectionOpacityPercent: 100,
    }
    // Act
    const settings = SettingsSchema.parse(persistedSettings)
    // Assert
    expect(settings).toMatchObject({
      windowBackgroundOpacityPercent: 90,
      windowOpacityMode: 'section',
      leftSectionOpacityPercent: 85,
      centerSectionOpacityPercent: 95,
      rightSectionOpacityPercent: 100,
    })
  })

  test.each([
    { leftSectionOpacityPercent: -1 },
    { centerSectionOpacityPercent: 101 },
    { rightSectionOpacityPercent: 65.5 },
    { windowOpacityMode: 'invalid' },
  ])(
    'rejects an unsupported saved opacity setting: %j',
    (persistedSettings) => {
      // Arrange / Act
      const result = SettingsSchema.safeParse(persistedSettings)
      // Assert
      expect(result.success).toBe(false)
    },
  )
  test('fills in every default field when parsing an empty settings object', () => {
    // Arrange / Act
    const parsed = SettingsSchema.parse({})
    // Assert
    expect(parsed.defaultSkillTab).toBe('files')
    expect(parsed.preferredTerminal).toBe('terminal')
    expect(parsed.windowBackgroundOpacityPercent).toBe(100)
  })

  test('backfills the preferredTerminal default for a legacy settings.json that predates the field', () => {
    // Simulates a user who upgraded from a pre-feature build — their
    // settings.json on disk has no `preferredTerminal` key. Without a
    // `.default()` they would crash on validation.
    // Arrange / Act
    const parsed = SettingsSchema.parse({ defaultSkillTab: 'info' })
    // Assert
    expect(parsed.preferredTerminal).toBe('terminal')
    expect(parsed.defaultSkillTab).toBe('info')
  })

  test('rejects an unknown preferredTerminal value', () => {
    // Arrange / Act / Assert
    expect(() =>
      SettingsSchema.parse({ preferredTerminal: 'fish-shell' }),
    ).toThrow()
  })

  test('accepts every curated terminal id', () => {
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

  test('rejects a customTerminalAppName that is only whitespace after trimming', () => {
    // Arrange / Act / Assert
    expect(() =>
      SettingsSchema.parse({ customTerminalAppName: '   ' }),
    ).toThrow()
  })

  test('rejects a customTerminalAppName longer than 64 chars', () => {
    // Arrange / Act / Assert
    expect(() =>
      SettingsSchema.parse({ customTerminalAppName: 'a'.repeat(65) }),
    ).toThrow()
  })

  test('accepts a customTerminalAppName at exactly the 64-char limit', () => {
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
  test('keeps DEFAULT_SETTINGS in lockstep with what the schema produces from an empty object', () => {
    // Arrange / Act
    const schemaDefaults = SettingsSchema.parse({})
    // Assert
    expect(DEFAULT_SETTINGS).toEqual(schemaDefaults)
  })

  test('defaults autoDownloadUpdates to off so a fresh install keeps manual confirm-via-UI downloads', () => {
    // Arrange / Act
    const parsed = SettingsSchema.parse({})
    // Assert
    expect(parsed.autoDownloadUpdates).toBe(false)
  })

  test('defaults the Installed search count display to the tab badge', () => {
    // Arrange / Act
    const parsed = SettingsSchema.parse({})
    // Assert
    expect(parsed.installedSearchCountDisplay).toBe('tab')
  })

  test('persists moving the Installed search count into the toolbar', () => {
    // Arrange / Act
    const parsed = SettingsSchema.parse({
      installedSearchCountDisplay: 'inline',
    })
    // Assert
    expect(parsed.installedSearchCountDisplay).toBe('inline')
  })

  test('rejects an unknown Installed search count display placement', () => {
    // Arrange / Act / Assert
    expect(() =>
      SettingsSchema.parse({ installedSearchCountDisplay: 'marketplace' }),
    ).toThrow()
  })

  test('persists opting into background downloads', () => {
    // Arrange / Act
    const parsed = SettingsSchema.parse({
      autoDownloadUpdates: true,
    })
    // Assert
    expect(parsed.autoDownloadUpdates).toBe(true)
  })

  test('rejects a non-boolean autoDownloadUpdates', () => {
    // Arrange / Act / Assert
    expect(() => SettingsSchema.parse({ autoDownloadUpdates: 'yes' })).toThrow()
  })

  test('leaves windowSize unset when none is stored', () => {
    // Arrange / Act
    const parsed = SettingsSchema.parse({})
    // Assert
    expect(parsed.windowSize).toBeUndefined()
  })

  test('accepts a windowSize at the minimum dimension', () => {
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

  test('rejects a windowSize below the minimum dimension', () => {
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

  test('rejects a non-integer windowSize', () => {
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

  test.each([0, 1, 45, 85, 90, 100])(
    'accepts a readable background percentage of %i',
    (percent) => {
      // Arrange / Act
      const settings = SettingsSchema.parse({
        windowBackgroundOpacityPercent: percent,
      })
      // Assert
      expect(settings.windowBackgroundOpacityPercent).toBe(percent)
    },
  )

  test.each([-1, 101, 85.5, '85', null, Number.NaN])(
    'rejects an invalid background percentage: %j',
    (percent) => {
      // Arrange / Act
      const result = SettingsSchema.safeParse({
        windowBackgroundOpacityPercent: percent,
      })
      // Assert
      expect(result.success).toBe(false)
    },
  )

  test('defaults the Markdown reading font size to the prior 14px preview base', () => {
    // Arrange / Act
    const parsed = SettingsSchema.parse({})
    // Assert
    expect(parsed.markdownFontSizePx).toBe(14)
  })

  test('accepts a Markdown reading font size at the bounded min and max', () => {
    // Arrange / Act
    const atMin = SettingsSchema.parse({
      markdownFontSizePx: MARKDOWN_FONT_SIZE_MIN_PX,
    })
    const atMax = SettingsSchema.parse({
      markdownFontSizePx: MARKDOWN_FONT_SIZE_MAX_PX,
    })
    // Assert
    expect(atMin.markdownFontSizePx).toBe(12)
    expect(atMax.markdownFontSizePx).toBe(22)
  })

  test('rejects a Markdown reading font size outside the bounded range', () => {
    // Arrange / Act / Assert
    expect(() =>
      SettingsSchema.parse({
        markdownFontSizePx: MARKDOWN_FONT_SIZE_MIN_PX - 1,
      }),
    ).toThrow()
    expect(() =>
      SettingsSchema.parse({
        markdownFontSizePx: MARKDOWN_FONT_SIZE_MAX_PX + 1,
      }),
    ).toThrow()
  })

  test('rejects a non-integer Markdown reading font size', () => {
    // Arrange / Act / Assert
    expect(() => SettingsSchema.parse({ markdownFontSizePx: 14.5 })).toThrow()
  })

  test('defaults the code preview font size to the prior 13px preview base', () => {
    // Arrange / Act
    const parsed = SettingsSchema.parse({})
    // Assert
    expect(parsed.codeFontSizePx).toBe(13)
  })

  test('accepts a code preview font size at the bounded min and max', () => {
    // Arrange / Act
    const atMin = SettingsSchema.parse({
      codeFontSizePx: CODE_FONT_SIZE_MIN_PX,
    })
    const atMax = SettingsSchema.parse({
      codeFontSizePx: CODE_FONT_SIZE_MAX_PX,
    })
    // Assert
    expect(atMin.codeFontSizePx).toBe(11)
    expect(atMax.codeFontSizePx).toBe(20)
  })

  test('rejects a code preview font size outside the bounded range', () => {
    // Arrange / Act / Assert
    expect(() =>
      SettingsSchema.parse({ codeFontSizePx: CODE_FONT_SIZE_MIN_PX - 1 }),
    ).toThrow()
    expect(() =>
      SettingsSchema.parse({ codeFontSizePx: CODE_FONT_SIZE_MAX_PX + 1 }),
    ).toThrow()
  })

  test('rejects a non-integer code preview font size', () => {
    // Arrange / Act / Assert
    expect(() => SettingsSchema.parse({ codeFontSizePx: 13.5 })).toThrow()
  })

  test('defaults the code theme to the GitHub pair on a fresh parse', () => {
    // Arrange / Act
    const parsed = SettingsSchema.parse({})
    // Assert
    expect(parsed.codeThemeId).toBe('github')
  })

  test('persists choosing a curated code theme', () => {
    // Arrange / Act
    const parsed = SettingsSchema.parse({ codeThemeId: 'vitesse' })
    // Assert
    expect(parsed.codeThemeId).toBe('vitesse')
  })

  test('rejects an unknown code theme id', () => {
    // Arrange / Act / Assert
    expect(() => SettingsSchema.parse({ codeThemeId: 'dracula' })).toThrow()
  })

  test('hides no agents by default on a fresh parse', () => {
    // Arrange / Act
    const parsed = SettingsSchema.parse({})
    // Assert
    expect(parsed.hiddenAgentIds).toEqual([])
  })

  test('keeps a hidden agent id that matches an installed agent', () => {
    // Arrange
    const firstAgentId = AGENT_DEFINITIONS[0].id
    // Act
    const parsed = SettingsSchema.parse({ hiddenAgentIds: [firstAgentId] })
    // Assert
    expect(parsed.hiddenAgentIds).toEqual([firstAgentId])
  })

  test('drops an unknown hidden agent id instead of rejecting the whole settings file', () => {
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

  test('keeps the valid hidden agent ids and drops the stale ones beside them', () => {
    // Regression for the Skills-CLI-removed-an-agent scenario: with
    // strict z.enum the whole array (and everything else in settings.json)
    // would reject. The transform must filter, not throw.
    // Arrange
    const firstAgentId = AGENT_DEFINITIONS[0].id
    // Act
    const parsed = SettingsSchema.parse({
      hiddenAgentIds: [firstAgentId, 'removed-agent'],
    })
    // Assert
    expect(parsed.hiddenAgentIds).toEqual([firstAgentId])
  })

  test('does not reset every other settings field when hiddenAgentIds carries a stale id', () => {
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

  test('rejects a non-array hiddenAgentIds', () => {
    // Arrange / Act / Assert
    expect(() =>
      SettingsSchema.parse({ hiddenAgentIds: 'claude-code' }),
    ).toThrow()
  })

  test('drops non-string hiddenAgentIds entries instead of rejecting the whole settings file', () => {
    // Regression for the array-element-validation cliff: with the prior
    // `z.array(z.string())` element schema, a single non-string entry
    // (e.g. a hand-edited `123`) would fail BEFORE `.transform()` ran,
    // taking the whole settings parse down with it. Element type is
    // `z.unknown()` so the typeof-string filter inside transform can
    // do its job — same forgiving contract as the stale-id case.
    // Arrange
    const firstAgentId = AGENT_DEFINITIONS[0].id
    // Act
    const parsed = SettingsSchema.parse({
      defaultSkillTab: 'info',
      hiddenAgentIds: [firstAgentId, 123, null, { not: 'a string' }],
    })
    // Assert
    expect(parsed.defaultSkillTab).toBe('info')
    expect(parsed.hiddenAgentIds).toEqual([firstAgentId])
  })

  test('collapses duplicate hiddenAgentIds so the settings-equality check stays honest', () => {
    // A hand-edited settings.json containing duplicates would otherwise
    // false-positive the length-then-membership equality check in
    // `areSettingsEqual` (e.g. ['cursor','cursor'] vs ['cursor','claude-code']
    // would compare equal and silently drop the legitimate write). The
    // disk schema deduplicates so the equality contract stays honest.
    // Arrange
    const firstAgentId = AGENT_DEFINITIONS[0].id
    // Act
    const parsed = SettingsSchema.parse({
      hiddenAgentIds: [firstAgentId, firstAgentId],
    })
    // Assert
    expect(parsed.hiddenAgentIds).toEqual([firstAgentId])
  })
})
