import { describe, expect, it } from 'vitest'

import { resolveNeutralFamilySelection } from './ThemeSelector'

const zincFamily: Parameters<typeof resolveNeutralFamilySelection>[0] = {
  id: 'zinc',
  label: 'Zinc',
  dark: 'zinc-dark',
  light: 'zinc-light',
  hue: 265,
  chroma: 0.05,
}

describe('resolveNeutralFamilySelection', () => {
  it('marks a neutral family selected when the current preset is either mode partner', () => {
    // Arrange
    const preset = 'zinc-light'

    // Act
    const selection = resolveNeutralFamilySelection(zincFamily, preset, 'dark')

    // Assert
    expect(selection).toEqual({
      isSelected: true,
      targetPreset: 'zinc-dark',
    })
  })

  it('resolves the light partner when the current display mode is light', () => {
    // Arrange
    const preset = 'rose'

    // Act
    const selection = resolveNeutralFamilySelection(zincFamily, preset, 'light')

    // Assert
    expect(selection).toEqual({
      isSelected: false,
      targetPreset: 'zinc-light',
    })
  })

  it('returns a null click target when a family is missing the requested mode partner', () => {
    // Arrange
    const incompleteFamily: Parameters<
      typeof resolveNeutralFamilySelection
    >[0] = {
      id: 'custom',
      label: 'Custom',
      dark: 'neutral-dark',
      light: null,
      hue: 0,
      chroma: 0,
    }

    // Act
    const selection = resolveNeutralFamilySelection(
      incompleteFamily,
      'neutral-dark',
      'light',
    )

    // Assert
    expect(selection).toEqual({
      isSelected: true,
      targetPreset: null,
    })
  })
})
