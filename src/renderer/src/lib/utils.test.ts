import { describe, expect, it } from 'vitest'

import { formatInstallCount, toggleArrayMember } from './utils'

describe('formatInstallCount', () => {
  it('returns em dash when count is undefined', () => {
    expect(formatInstallCount(undefined)).toBe('—')
  })

  it('returns raw number string for values below 1K', () => {
    expect(formatInstallCount(0)).toBe('0')
    expect(formatInstallCount(999)).toBe('999')
  })

  it('formats 1K boundary as K notation', () => {
    expect(formatInstallCount(1_000)).toBe('1.0K')
  })

  it('rounds near 1M boundary to M notation', () => {
    expect(formatInstallCount(999_999)).toBe('1.0M')
  })

  it('formats 1M boundary as M notation', () => {
    expect(formatInstallCount(1_000_000)).toBe('1.0M')
  })
})

/**
 * `toggleArrayMember` is the single primitive backing every
 * hide-from-sidebar flow (right-click toggle, settings checkbox).
 * The contract these tests pin:
 *  - membership flip works in both directions
 *  - the returned reference is always fresh so callers can dispatch
 *    it straight into Redux without aliasing the previous state
 *  - the input array is not mutated (defense against accidental
 *    .push / .splice rewrites that would break `setSettings` referential
 *    equality and the listener invariants downstream)
 */
describe('toggleArrayMember', () => {
  it('appends a value when it is not already present', () => {
    expect(toggleArrayMember(['a', 'b'], 'c')).toEqual(['a', 'b', 'c'])
  })

  it('removes a value when it is already present', () => {
    expect(toggleArrayMember(['a', 'b'], 'a')).toEqual(['b'])
  })

  it('appends to an empty array', () => {
    expect(toggleArrayMember<string>([], 'x')).toEqual(['x'])
  })

  it('returns an empty array when removing the only member', () => {
    expect(toggleArrayMember(['x'], 'x')).toEqual([])
  })

  it('returns a new reference even when the result is structurally equal to the input', () => {
    // Callers (e.g. updateSettings({ hiddenAgentIds: ... })) rely on
    // a fresh reference for `setSettings` to be detected as a change
    // by Redux's default ===-equality checks. Aliasing the input would
    // silently drop optimistic updates.
    const input = ['a', 'b']
    const removed = toggleArrayMember(input, 'a')
    const appended = toggleArrayMember(input, 'c')
    expect(removed).not.toBe(input)
    expect(appended).not.toBe(input)
  })

  it('does not mutate the input array', () => {
    const input = ['a', 'b']
    toggleArrayMember(input, 'a')
    toggleArrayMember(input, 'c')
    expect(input).toEqual(['a', 'b'])
  })
})
