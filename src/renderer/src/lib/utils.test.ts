import { describe, expect, it } from 'vitest'

import { formatInstallCount, toggleArrayMember } from './utils'

describe('formatInstallCount', () => {
  it('shows an em dash when the install count is unknown', () => {
    // Arrange
    const unknownCount = undefined
    // Act
    const label = formatInstallCount(unknownCount)
    // Assert
    expect(label).toBe('—')
  })

  it('shows small install counts as a plain number without K notation', () => {
    // Arrange
    const zeroCount = 0
    const justBelowOneThousand = 999
    // Act
    const zeroLabel = formatInstallCount(zeroCount)
    const belowThousandLabel = formatInstallCount(justBelowOneThousand)
    // Assert
    expect(zeroLabel).toBe('0')
    expect(belowThousandLabel).toBe('999')
  })

  it('abbreviates one thousand installs as 1.0K', () => {
    // Arrange
    const oneThousand = 1_000
    // Act
    const label = formatInstallCount(oneThousand)
    // Assert
    expect(label).toBe('1.0K')
  })

  it('rounds a count just below one million up to 1.0M', () => {
    // Arrange
    const justBelowOneMillion = 999_999
    // Act
    const label = formatInstallCount(justBelowOneMillion)
    // Assert
    expect(label).toBe('1.0M')
  })

  it('abbreviates one million installs as 1.0M', () => {
    // Arrange
    const oneMillion = 1_000_000
    // Act
    const label = formatInstallCount(oneMillion)
    // Assert
    expect(label).toBe('1.0M')
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
    // Arrange
    const members = ['a', 'b']
    // Act
    const toggled = toggleArrayMember(members, 'c')
    // Assert
    expect(toggled).toEqual(['a', 'b', 'c'])
  })

  it('removes a value when it is already present', () => {
    // Arrange
    const members = ['a', 'b']
    // Act
    const toggled = toggleArrayMember(members, 'a')
    // Assert
    expect(toggled).toEqual(['b'])
  })

  it('appends to an empty array', () => {
    // Arrange
    const members: string[] = []
    // Act
    const toggled = toggleArrayMember<string>(members, 'x')
    // Assert
    expect(toggled).toEqual(['x'])
  })

  it('returns an empty array when removing the only member', () => {
    // Arrange
    const members = ['x']
    // Act
    const toggled = toggleArrayMember(members, 'x')
    // Assert
    expect(toggled).toEqual([])
  })

  it('returns a new reference even when the result is structurally equal to the input', () => {
    // Callers (e.g. updateSettings({ hiddenAgentIds: ... })) rely on
    // a fresh reference for `setSettings` to be detected as a change
    // by Redux's default ===-equality checks. Aliasing the input would
    // silently drop optimistic updates.
    // Arrange
    const input = ['a', 'b']
    // Act
    const removed = toggleArrayMember(input, 'a')
    const appended = toggleArrayMember(input, 'c')
    // Assert
    expect(removed).not.toBe(input)
    expect(appended).not.toBe(input)
  })

  it('does not mutate the input array', () => {
    // Arrange
    const input = ['a', 'b']
    // Act
    toggleArrayMember(input, 'a')
    toggleArrayMember(input, 'c')
    // Assert
    expect(input).toEqual(['a', 'b'])
  })
})
