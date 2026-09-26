import { describe, expect, test } from 'vitest'

import tailwindConfig from '../../../../tailwind.config'

import { cn, formatInstallCount, toggleArrayMember } from './utils'

describe('cn', () => {
  test('keeps the muted color when a Settings description overrides the size', () => {
    // Arrange — DialogDescription's defaults plus the crop view's override.
    const componentDefaults = 'text-sm text-muted-foreground'
    const callerOverride = 'mt-1 truncate text-settings-description'

    // Act
    const merged = cn(componentDefaults, callerOverride)

    // Assert — text-sm loses to the custom size; the color survives.
    expect(merged).toBe(
      'text-muted-foreground mt-1 truncate text-settings-description',
    )
  })

  test('keeps the Settings description size when a color class follows it', () => {
    // Arrange / Act
    const merged = cn('text-settings-description text-muted-foreground')

    // Assert
    expect(merged).toBe('text-settings-description text-muted-foreground')
  })

  test('lets a later Tailwind size replace the Settings description size', () => {
    // Arrange
    const settingsDescription =
      'text-settings-description text-muted-foreground'
    const laterSize = 'text-xs'

    // Act
    const merged = cn(settingsDescription, laterSize)

    // Assert — both are font sizes, so only the last one survives.
    expect(merged).toBe('text-muted-foreground text-xs')
  })

  test('still resolves a built-in size override the same way as before the custom token', () => {
    // Arrange
    const componentDefaults = 'text-sm text-muted-foreground'
    const callerOverride = 'text-xs'

    // Act
    const merged = cn(componentDefaults, callerOverride)

    // Assert
    expect(merged).toBe('text-muted-foreground text-xs')
  })

  test('still resolves a built-in color override the same way as before the custom token', () => {
    // Arrange
    const componentDefaults = 'text-sm text-muted-foreground'
    const callerOverride = 'text-destructive'

    // Act
    const merged = cn(componentDefaults, callerOverride)

    // Assert
    expect(merged).toBe('text-sm text-destructive')
  })

  test('keeps the link color when an inline link button inherits the sentence size', () => {
    // Arrange — Button base size + link variant color, then the inline override.
    const linkButtonDefaults = 'text-[13px] text-primary'
    const inlineOverride = 'text-[length:inherit]'

    // Act
    const merged = cn(linkButtonDefaults, inlineOverride)

    // Assert
    expect(merged).toBe('text-primary text-[length:inherit]')
  })

  test('keeps the muted color for every custom font size in tailwind.config.ts', () => {
    // Arrange — a size added to the config but not to cn()'s font-size group
    // would be merged as a color and drop text-muted-foreground.
    const customSizes = Object.keys(
      tailwindConfig.theme?.extend?.fontSize ?? {},
    )

    // Act
    const mergedBySize = customSizes.map((size) =>
      cn('text-sm text-muted-foreground', `text-${size}`),
    )

    // Assert
    expect(mergedBySize).toEqual([
      'text-muted-foreground text-settings-description',
    ])
  })
})

describe('formatInstallCount', () => {
  test('shows an em dash when the install count is unknown', () => {
    // Arrange
    const unknownCount = undefined
    // Act
    const label = formatInstallCount(unknownCount)
    // Assert
    expect(label).toBe('—')
  })

  test('shows small install counts as a plain number without K notation', () => {
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

  test('abbreviates one thousand installs as 1.0K', () => {
    // Arrange
    const oneThousand = 1_000
    // Act
    const label = formatInstallCount(oneThousand)
    // Assert
    expect(label).toBe('1.0K')
  })

  test('rounds a count just below one million up to 1.0M', () => {
    // Arrange
    const justBelowOneMillion = 999_999
    // Act
    const label = formatInstallCount(justBelowOneMillion)
    // Assert
    expect(label).toBe('1.0M')
  })

  test('abbreviates one million installs as 1.0M', () => {
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
  test('appends a value when it is not already present', () => {
    // Arrange
    const members = ['a', 'b']
    // Act
    const toggled = toggleArrayMember(members, 'c')
    // Assert
    expect(toggled).toEqual(['a', 'b', 'c'])
  })

  test('removes a value when it is already present', () => {
    // Arrange
    const members = ['a', 'b']
    // Act
    const toggled = toggleArrayMember(members, 'a')
    // Assert
    expect(toggled).toEqual(['b'])
  })

  test('appends to an empty array', () => {
    // Arrange
    const members: string[] = []
    // Act
    const toggled = toggleArrayMember<string>(members, 'x')
    // Assert
    expect(toggled).toEqual(['x'])
  })

  test('returns an empty array when removing the only member', () => {
    // Arrange
    const members = ['x']
    // Act
    const toggled = toggleArrayMember(members, 'x')
    // Assert
    expect(toggled).toEqual([])
  })

  test('returns a new reference even when the result is structurally equal to the input', () => {
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

  test('does not mutate the input array', () => {
    // Arrange
    const input = ['a', 'b']
    // Act
    toggleArrayMember(input, 'a')
    toggleArrayMember(input, 'c')
    // Assert
    expect(input).toEqual(['a', 'b'])
  })
})
