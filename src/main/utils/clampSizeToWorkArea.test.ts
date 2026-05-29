import { describe, expect, it } from 'vitest'

import { clampSizeToWorkArea } from './clampSizeToWorkArea'

describe('clampSizeToWorkArea', () => {
  it('keeps a smaller window at its desired size so it is not needlessly shrunk', () => {
    // Arrange
    const desiredSize = { width: 1000, height: 700 }
    const workArea = { width: 1440, height: 900 }

    // Act
    const result = clampSizeToWorkArea(desiredSize, workArea)

    // Assert
    expect(result).toEqual({ width: 1000, height: 700 })
  })

  it('shrinks an over-wide window to the work-area width so it cannot overflow off-screen', () => {
    // Arrange
    const desiredSize = { width: 3000, height: 700 }
    const workArea = { width: 1440, height: 900 }

    // Act
    const result = clampSizeToWorkArea(desiredSize, workArea)

    // Assert
    expect(result).toEqual({ width: 1440, height: 700 })
  })

  it('shrinks an over-tall window to the work-area height so it cannot overflow off-screen', () => {
    // Arrange
    const desiredSize = { width: 1000, height: 2000 }
    const workArea = { width: 1440, height: 900 }

    // Act
    const result = clampSizeToWorkArea(desiredSize, workArea)

    // Assert
    expect(result).toEqual({ width: 1000, height: 900 })
  })

  it('clamps width and height separately so an oversized window fills but never exceeds the work area', () => {
    // Arrange
    const desiredSize = { width: 3000, height: 2000 }
    const workArea = { width: 1440, height: 900 }

    // Act
    const result = clampSizeToWorkArea(desiredSize, workArea)

    // Assert
    expect(result).toEqual({ width: 1440, height: 900 })
  })

  it('leaves a window that exactly matches the work area unchanged', () => {
    // Arrange
    const desiredSize = { width: 1440, height: 900 }
    const workArea = { width: 1440, height: 900 }

    // Act
    const result = clampSizeToWorkArea(desiredSize, workArea)

    // Assert
    expect(result).toEqual({ width: 1440, height: 900 })
  })
})
