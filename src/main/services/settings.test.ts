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
    windowBackgroundBlurRadius: 0,
    hiddenAgentIds: [],
    autoDownloadUpdates: false,
  }

  it('treats two settings with identical primitive fields as unchanged so no redundant save fires', () => {
    // Arrange
    const saved = baseSettings
    const incoming = { ...baseSettings }

    // Act
    const result = areSettingsEqual(saved, incoming)

    // Assert
    expect(result).toBe(true)
  })

  it('detects a changed primitive field so the new value gets persisted', () => {
    // Arrange
    const saved = baseSettings
    const incoming: Settings = { ...baseSettings, defaultSkillTab: 'info' }

    // Act
    const result = areSettingsEqual(saved, incoming)

    // Assert
    expect(result).toBe(false)
  })

  it('treats two settings with no window size on either side as unchanged', () => {
    // Arrange
    const saved = { ...baseSettings, windowSize: undefined }
    const incoming = { ...baseSettings, windowSize: undefined }

    // Act
    const result = areSettingsEqual(saved, incoming)

    // Assert
    expect(result).toBe(true)
  })

  it('treats matching window dimensions as unchanged even when Zod produced a fresh object reference', () => {
    // Arrange: Zod parse produces a fresh object on every call, so the
    // references differ even when the width/height values match.
    const saved = { ...baseSettings, windowSize: { width: 1200, height: 800 } }
    const incoming = {
      ...baseSettings,
      windowSize: { width: 1200, height: 800 },
    }

    // Act
    const result = areSettingsEqual(saved, incoming)

    // Assert
    expect(result).toBe(true)
  })

  it('detects a changed window width so the resized dimensions get persisted', () => {
    // Arrange
    const saved = { ...baseSettings, windowSize: { width: 1200, height: 800 } }
    const incoming = {
      ...baseSettings,
      windowSize: { width: 1201, height: 800 },
    }

    // Act
    const result = areSettingsEqual(saved, incoming)

    // Assert
    expect(result).toBe(false)
  })

  it('detects a changed window height so the resized dimensions get persisted', () => {
    // Arrange
    const saved = { ...baseSettings, windowSize: { width: 1200, height: 800 } }
    const incoming = {
      ...baseSettings,
      windowSize: { width: 1200, height: 801 },
    }

    // Act
    const result = areSettingsEqual(saved, incoming)

    // Assert
    expect(result).toBe(false)
  })

  it('detects a change when one side has a window size and the other has none, in either direction', () => {
    // Arrange
    const withSize = {
      ...baseSettings,
      windowSize: { width: 1200, height: 800 },
    }
    const withoutSize = { ...baseSettings, windowSize: undefined }

    // Act
    const sizeThenNone = areSettingsEqual(withSize, withoutSize)
    const noneThenSize = areSettingsEqual(withoutSize, withSize)

    // Assert
    expect(sizeThenNone).toBe(false)
    expect(noneThenSize).toBe(false)
  })

  it('detects a change when the windowSize key exists on only one side, not falsely matching', () => {
    // Arrange: the asymmetric-shape bug — `Object.keys(a)` alone would skip
    // a key that lives only on `b`, so an absent-vs-defined comparison would
    // wrongly return `true`. Iterating the union of both keys surfaces it.
    const withoutKey = { ...baseSettings }
    const withKey = {
      ...baseSettings,
      windowSize: { width: 1200, height: 800 },
    }

    // Act
    const missingThenPresent = areSettingsEqual(withoutKey, withKey)
    const presentThenMissing = areSettingsEqual(withKey, withoutKey)

    // Assert
    expect(missingThenPresent).toBe(false)
    expect(presentThenMissing).toBe(false)
  })

  it('treats two settings that both omit window size as unchanged', () => {
    // Arrange
    const saved = { ...baseSettings }
    const incoming = { ...baseSettings }

    // Act
    const result = areSettingsEqual(saved, incoming)

    // Assert
    expect(result).toBe(true)
  })

  it('treats identical hidden-agent lists in the same order as unchanged', () => {
    // Arrange
    const saved: Settings = {
      ...baseSettings,
      hiddenAgentIds: ['claude-code', 'cursor'],
    }
    const incoming: Settings = {
      ...baseSettings,
      hiddenAgentIds: ['claude-code', 'cursor'],
    }

    // Act
    const result = areSettingsEqual(saved, incoming)

    // Assert
    expect(result).toBe(true)
  })

  it('treats hidden-agent lists with the same members in different order as unchanged (set semantics)', () => {
    // Arrange: renderer treats hiddenAgentIds as a set; equality must match
    // that semantic so an order-only drift between disk and renderer doesn't
    // trigger a redundant atomic write + settings:changed broadcast.
    const saved: Settings = {
      ...baseSettings,
      hiddenAgentIds: ['claude-code', 'cursor'],
    }
    const incoming: Settings = {
      ...baseSettings,
      hiddenAgentIds: ['cursor', 'claude-code'],
    }

    // Act
    const result = areSettingsEqual(saved, incoming)

    // Assert
    expect(result).toBe(true)
  })

  it('detects a change when the hidden-agent list gains or loses an entry', () => {
    // Arrange
    const saved: Settings = { ...baseSettings, hiddenAgentIds: ['claude-code'] }
    const incoming: Settings = {
      ...baseSettings,
      hiddenAgentIds: ['claude-code', 'cursor'],
    }

    // Act
    const result = areSettingsEqual(saved, incoming)

    // Assert
    expect(result).toBe(false)
  })

  it('detects a change when the hidden-agent list swaps a member for a different one', () => {
    // Arrange
    const saved: Settings = { ...baseSettings, hiddenAgentIds: ['claude-code'] }
    const incoming: Settings = { ...baseSettings, hiddenAgentIds: ['cursor'] }

    // Act
    const result = areSettingsEqual(saved, incoming)

    // Assert
    expect(result).toBe(false)
  })
})
