import { describe, expect, it } from 'vitest'

import { getWindowSectionOpacity } from './getWindowSectionOpacity'

describe('Independent window section opacity', () => {
  it('keeps saved section values from multiplying the native Entire opacity', () => {
    // Arrange
    const savedOpacityPercent = 65
    // Act
    const opacity = getWindowSectionOpacity('entire', savedOpacityPercent)
    // Assert
    expect(opacity).toBe(1)
  })

  it.each([
    { percent: 45, expectedOpacity: 0.45 },
    { percent: 65, expectedOpacity: 0.65 },
    { percent: 100, expectedOpacity: 1 },
  ])(
    'applies $percent percent to a section when Section mode is selected',
    ({ percent, expectedOpacity }) => {
      // Arrange
      const opacityMode = 'section'
      // Act
      const opacity = getWindowSectionOpacity(opacityMode, percent)
      // Assert
      expect(opacity).toBe(expectedOpacity)
    },
  )
})
