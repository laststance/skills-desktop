import { describe, it, expect } from 'vitest'

import { buildOpenArgs } from './folder'

/**
 * Pure-function unit tests for `buildOpenArgs` — covers every branch of the
 * curated × custom matrix without spawning processes or touching the filesystem.
 * Integration tests (mocked spawn / realpath) live in `folder.integration.test.ts`.
 */
describe('Open in Terminal: choosing which app launches', () => {
  it('opens the Terminal app when the user picked the "terminal" preset', () => {
    // Arrange
    const preferredTerminal = 'terminal'

    // Act
    const openArgs = buildOpenArgs(preferredTerminal, undefined, '/x')

    // Assert
    expect(openArgs).toEqual(['-a', 'Terminal', '/x'])
  })

  it('opens iTerm when the user picked the "iterm" preset', () => {
    // Arrange
    const preferredTerminal = 'iterm'

    // Act
    const openArgs = buildOpenArgs(preferredTerminal, undefined, '/x')

    // Assert
    expect(openArgs).toEqual(['-a', 'iTerm', '/x'])
  })

  it('opens Warp when the user picked the "warp" preset', () => {
    // Arrange
    const preferredTerminal = 'warp'

    // Act
    const openArgs = buildOpenArgs(preferredTerminal, undefined, '/x')

    // Assert
    expect(openArgs).toEqual(['-a', 'Warp', '/x'])
  })

  it('opens Ghostty when the user picked the "ghostty" preset', () => {
    // Arrange
    const preferredTerminal = 'ghostty'

    // Act
    const openArgs = buildOpenArgs(preferredTerminal, undefined, '/x')

    // Assert
    expect(openArgs).toEqual(['-a', 'Ghostty', '/x'])
  })

  it('opens Alacritty when the user picked the "alacritty" preset', () => {
    // Arrange
    const preferredTerminal = 'alacritty'

    // Act
    const openArgs = buildOpenArgs(preferredTerminal, undefined, '/x')

    // Assert
    expect(openArgs).toEqual(['-a', 'Alacritty', '/x'])
  })

  it('opens kitty using its lowercased app name when the user picked the "kitty" preset', () => {
    // Arrange
    const preferredTerminal = 'kitty'

    // Act
    const openArgs = buildOpenArgs(preferredTerminal, undefined, '/x')

    // Assert
    expect(openArgs).toEqual(['-a', 'kitty', '/x'])
  })

  it('opens WezTerm when the user picked the "wezterm" preset', () => {
    // Arrange
    const preferredTerminal = 'wezterm'

    // Act
    const openArgs = buildOpenArgs(preferredTerminal, undefined, '/x')

    // Assert
    expect(openArgs).toEqual(['-a', 'WezTerm', '/x'])
  })

  it('opens the user-named custom app when the "custom" preset is selected', () => {
    // Arrange
    const customTerminalAppName = 'Hyper'

    // Act
    const openArgs = buildOpenArgs('custom', customTerminalAppName, '/x')

    // Assert
    expect(openArgs).toEqual(['-a', 'Hyper', '/x'])
  })

  it('refuses to open anything when "custom" is selected but no app name is configured', () => {
    // Arrange
    const customTerminalAppName = undefined

    // Act
    const openArgs = buildOpenArgs('custom', customTerminalAppName, '/x')

    // Assert
    expect(openArgs).toBeNull()
  })

  it('refuses to open anything when the custom app name is an empty string', () => {
    // Arrange
    const customTerminalAppName = ''

    // Act
    const openArgs = buildOpenArgs('custom', customTerminalAppName, '/x')

    // Assert
    expect(openArgs).toBeNull()
  })

  it('refuses to open anything when the custom app name is only whitespace', () => {
    // Arrange
    // Defense-in-depth: Zod already trims+min(1)s the input, but the function
    // also trims internally so a stale settings.json with '   ' is rejected.
    const customTerminalAppName = '   '

    // Act
    const openArgs = buildOpenArgs('custom', customTerminalAppName, '/x')

    // Assert
    expect(openArgs).toBeNull()
  })

  it('strips surrounding whitespace from the custom app name before opening', () => {
    // Arrange
    const customTerminalAppName = '  Hyper  '

    // Act
    const openArgs = buildOpenArgs('custom', customTerminalAppName, '/x')

    // Assert
    expect(openArgs).toEqual(['-a', 'Hyper', '/x'])
  })
})
