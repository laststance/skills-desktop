import { describe, it, expect } from 'vitest'

import { buildOpenArgs } from './folder'

/**
 * Pure-function unit tests for `buildOpenArgs` — covers every branch of the
 * curated × custom matrix without spawning processes or touching the filesystem.
 * Integration tests (mocked spawn / realpath) live in `folder.integration.test.ts`.
 */
describe('buildOpenArgs', () => {
  it('maps curated id "terminal" to Apple Terminal display name', () => {
    expect(buildOpenArgs('terminal', undefined, '/x')).toEqual([
      '-a',
      'Terminal',
      '/x',
    ])
  })

  it('maps curated id "iterm" to iTerm display name', () => {
    expect(buildOpenArgs('iterm', undefined, '/x')).toEqual([
      '-a',
      'iTerm',
      '/x',
    ])
  })

  it('maps curated id "warp" to Warp display name', () => {
    expect(buildOpenArgs('warp', undefined, '/x')).toEqual(['-a', 'Warp', '/x'])
  })

  it('maps curated id "ghostty" to Ghostty display name', () => {
    expect(buildOpenArgs('ghostty', undefined, '/x')).toEqual([
      '-a',
      'Ghostty',
      '/x',
    ])
  })

  it('maps curated id "alacritty" to Alacritty display name', () => {
    expect(buildOpenArgs('alacritty', undefined, '/x')).toEqual([
      '-a',
      'Alacritty',
      '/x',
    ])
  })

  it('maps curated id "kitty" to lowercased "kitty" display name', () => {
    expect(buildOpenArgs('kitty', undefined, '/x')).toEqual([
      '-a',
      'kitty',
      '/x',
    ])
  })

  it('maps curated id "wezterm" to WezTerm display name', () => {
    expect(buildOpenArgs('wezterm', undefined, '/x')).toEqual([
      '-a',
      'WezTerm',
      '/x',
    ])
  })

  it('uses customTerminalAppName when preferredTerminal is "custom"', () => {
    expect(buildOpenArgs('custom', 'Hyper', '/x')).toEqual([
      '-a',
      'Hyper',
      '/x',
    ])
  })

  it('returns null for "custom" with undefined customTerminalAppName', () => {
    expect(buildOpenArgs('custom', undefined, '/x')).toBeNull()
  })

  it('returns null for "custom" with empty string customTerminalAppName', () => {
    expect(buildOpenArgs('custom', '', '/x')).toBeNull()
  })

  it('returns null for "custom" with whitespace-only customTerminalAppName', () => {
    // Defense-in-depth: Zod already trims+min(1)s the input, but the function
    // also trims internally so a stale settings.json with '   ' is rejected.
    expect(buildOpenArgs('custom', '   ', '/x')).toBeNull()
  })

  it('trims surrounding whitespace from custom name', () => {
    expect(buildOpenArgs('custom', '  Hyper  ', '/x')).toEqual([
      '-a',
      'Hyper',
      '/x',
    ])
  })
})
