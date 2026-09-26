import { expect, test } from 'vitest'

import { getWindowSurfaceStyle } from './getWindowSurfaceStyle'

test('shares the Entire background percentage without setting foreground opacity', () => {
  // Arrange / Act
  const style = getWindowSurfaceStyle('entire', 85, 92)
  // Assert
  expect(style).toEqual({ '--window-surface-opacity': 0.92 })
})

test('uses the independent section percentage without multiplying the Entire setting', () => {
  // Arrange / Act
  const style = getWindowSurfaceStyle('section', 85, 92)
  // Assert
  expect(style).toEqual({ '--window-surface-opacity': 0.85 })
})

test('restores the original palette for an opaque section', () => {
  // Arrange / Act
  const style = getWindowSurfaceStyle('section', 100, 85)
  // Assert
  expect(style).toEqual({ '--window-surface-opacity': 1 })
})
