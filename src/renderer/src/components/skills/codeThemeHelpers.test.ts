import { describe, expect, it } from 'vitest'

import { resolveCodeTheme } from './codeThemeHelpers'

/**
 * Unit tests for `resolveCodeTheme` — the forgiving bridge from a persisted
 * `codeThemeId` to the Shiki `{ light, dark }` pair the code preview renders.
 * The resolver is the safety net for a `settings.json` carrying a theme id
 * that a future build removed: it must degrade to the default instead of
 * breaking the preview.
 */
describe('resolveCodeTheme', () => {
  it('maps each curated theme id to its Shiki light/dark pair', () => {
    // Arrange / Act / Assert — every curated id resolves to its named pair.
    expect(resolveCodeTheme('github')).toEqual({
      light: 'github-light',
      dark: 'github-dark',
    })
    expect(resolveCodeTheme('vs')).toEqual({
      light: 'light-plus',
      dark: 'dark-plus',
    })
    expect(resolveCodeTheme('vitesse')).toEqual({
      light: 'vitesse-light',
      dark: 'vitesse-dark',
    })
    expect(resolveCodeTheme('one')).toEqual({
      light: 'one-light',
      dark: 'one-dark-pro',
    })
    expect(resolveCodeTheme('catppuccin')).toEqual({
      light: 'catppuccin-latte',
      dark: 'catppuccin-mocha',
    })
  })

  it('resolves the Visual Studio id whose Shiki theme names differ from the id', () => {
    // Regression guard for the one pair where id ('vs') ≠ Shiki theme names
    // ('light-plus' / 'dark-plus'): an accidental id===theme assumption would
    // silently break only this entry.
    // Arrange / Act
    const resolved = resolveCodeTheme('vs')
    // Assert
    expect(resolved.light).toBe('light-plus')
    expect(resolved.dark).toBe('dark-plus')
  })

  it('falls back to the default GitHub pair for an unknown (stale) theme id', () => {
    // A settings.json left over from a build that has since removed a theme
    // must not break the preview — it degrades to the default pair.
    // Arrange / Act
    const resolved = resolveCodeTheme('a-theme-that-was-removed')
    // Assert
    expect(resolved).toEqual({ light: 'github-light', dark: 'github-dark' })
  })
})
