import { describe, it, expect } from 'vitest'

import type { Settings } from '@/shared/settings'

import { areSettingsEqual } from './settings'

/**
 * Unit tests for the `areSettingsEqual` no-op guard. The motivation is
 * that Zod's `SettingsSchema.parse` always returns a fresh object — so a
 * naive `===` comparison on `windowSize` would always say "changed",
 * causing `saveSettings` to write `settings.json` and broadcast
 * `settings:changed` on every "Use current window size" click even when
 * the saved dimensions are identical.
 */
describe('areSettingsEqual', () => {
  const baseSettings: Settings = {
    defaultSkillTab: 'files',
    preferredTerminal: 'terminal',
  }

  it('returns true for identical primitive-only settings', () => {
    expect(areSettingsEqual(baseSettings, { ...baseSettings })).toBe(true)
  })

  it('returns false when any primitive field differs', () => {
    expect(
      areSettingsEqual(baseSettings, {
        ...baseSettings,
        defaultSkillTab: 'info',
      }),
    ).toBe(false)
  })

  it('returns true when both windowSize values are undefined', () => {
    expect(
      areSettingsEqual(
        { ...baseSettings, windowSize: undefined },
        { ...baseSettings, windowSize: undefined },
      ),
    ).toBe(true)
  })

  it('returns true when windowSize objects describe identical dimensions despite different references', () => {
    // The bug this guards against: Zod parse produces a fresh object on
    // every call, so the references are different even when values match.
    expect(
      areSettingsEqual(
        { ...baseSettings, windowSize: { width: 1200, height: 800 } },
        { ...baseSettings, windowSize: { width: 1200, height: 800 } },
      ),
    ).toBe(true)
  })

  it('returns false when only windowSize.width differs', () => {
    expect(
      areSettingsEqual(
        { ...baseSettings, windowSize: { width: 1200, height: 800 } },
        { ...baseSettings, windowSize: { width: 1201, height: 800 } },
      ),
    ).toBe(false)
  })

  it('returns false when only windowSize.height differs', () => {
    expect(
      areSettingsEqual(
        { ...baseSettings, windowSize: { width: 1200, height: 800 } },
        { ...baseSettings, windowSize: { width: 1200, height: 801 } },
      ),
    ).toBe(false)
  })

  it('returns false when one side has undefined windowSize and the other has a value', () => {
    expect(
      areSettingsEqual(
        { ...baseSettings, windowSize: { width: 1200, height: 800 } },
        { ...baseSettings, windowSize: undefined },
      ),
    ).toBe(false)
    expect(
      areSettingsEqual(
        { ...baseSettings, windowSize: undefined },
        { ...baseSettings, windowSize: { width: 1200, height: 800 } },
      ),
    ).toBe(false)
  })
})
