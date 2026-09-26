import { describe, expect, test } from 'vitest'

import { toPixelHeight, toPixelWidth } from '@/shared/types'

import { clampSizeToWorkArea } from './clampSizeToWorkArea'

describe('clampSizeToWorkArea', () => {
  test('keeps a smaller window at its desired size so it is not needlessly shrunk', () => {
    // Arrange
    const desiredSize = {
      width: toPixelWidth(1000),
      height: toPixelHeight(700),
    }
    const workArea = { width: toPixelWidth(1440), height: toPixelHeight(900) }

    // Act
    const result = clampSizeToWorkArea(desiredSize, workArea)

    // Assert
    expect(result).toEqual({ width: 1000, height: 700 })
  })

  test('shrinks an over-wide window to the work-area width so it cannot overflow off-screen', () => {
    // Arrange
    const desiredSize = {
      width: toPixelWidth(3000),
      height: toPixelHeight(700),
    }
    const workArea = { width: toPixelWidth(1440), height: toPixelHeight(900) }

    // Act
    const result = clampSizeToWorkArea(desiredSize, workArea)

    // Assert
    expect(result).toEqual({ width: 1440, height: 700 })
  })

  test('shrinks an over-tall window to the work-area height so it cannot overflow off-screen', () => {
    // Arrange
    const desiredSize = {
      width: toPixelWidth(1000),
      height: toPixelHeight(2000),
    }
    const workArea = { width: toPixelWidth(1440), height: toPixelHeight(900) }

    // Act
    const result = clampSizeToWorkArea(desiredSize, workArea)

    // Assert
    expect(result).toEqual({ width: 1000, height: 900 })
  })

  test('clamps width and height separately so an oversized window fills but never exceeds the work area', () => {
    // Arrange
    const desiredSize = {
      width: toPixelWidth(3000),
      height: toPixelHeight(2000),
    }
    const workArea = { width: toPixelWidth(1440), height: toPixelHeight(900) }

    // Act
    const result = clampSizeToWorkArea(desiredSize, workArea)

    // Assert
    expect(result).toEqual({ width: 1440, height: 900 })
  })

  test('leaves a window that exactly matches the work area unchanged', () => {
    // Arrange
    const desiredSize = {
      width: toPixelWidth(1440),
      height: toPixelHeight(900),
    }
    const workArea = { width: toPixelWidth(1440), height: toPixelHeight(900) }

    // Act
    const result = clampSizeToWorkArea(desiredSize, workArea)

    // Assert
    expect(result).toEqual({ width: 1440, height: 900 })
  })
})
