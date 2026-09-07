import { describe, expect, it } from 'vitest'

import { backgroundCropPixels } from './backgroundCropPixels'

describe('background crop source pixels', () => {
  it('uses original dimensions so a valid half crop remains 1920 × 1080', () => {
    // Arrange
    const crop = { x: 12.5, y: 25, width: 50, height: 50 }
    // Act
    const pixels = backgroundCropPixels(crop, 3840, 2160)
    // Assert
    expect(pixels).toEqual({
      left: 480,
      top: 540,
      width: 1920,
      height: 1080,
      isLargeEnough: true,
    })
  })

  it('accepts the same minimum resolution after portrait orientation', () => {
    // Arrange / Act
    const pixels = backgroundCropPixels(
      { x: 0, y: 0, width: 100, height: 100 },
      1080,
      1920,
    )
    // Assert
    expect(pixels).toEqual({
      left: 0,
      top: 0,
      width: 1080,
      height: 1920,
      isLargeEnough: true,
    })
  })

  it('never rounds a below-minimum crop upward to pass validation', () => {
    // Arrange / Act
    const pixels = backgroundCropPixels(
      { x: 0.1, y: 0.1, width: 49.99, height: 49.99 },
      3840,
      2160,
    )
    // Assert
    expect(pixels).toEqual({
      left: 3,
      top: 2,
      width: 1919,
      height: 1079,
      isLargeEnough: false,
    })
  })

  it.each([
    { width: 0, height: 1080 },
    { width: 1920, height: -1 },
    { width: 1920.5, height: 1080 },
    { width: Number.NaN, height: 1080 },
    { width: 1920, height: Number.POSITIVE_INFINITY },
    { width: Number.MAX_SAFE_INTEGER + 1, height: 1080 },
  ])('rejects invalid source dimensions %j', ({ width, height }) => {
    // Arrange / Act
    const pixels = backgroundCropPixels(
      { x: 0, y: 0, width: 100, height: 100 },
      width,
      height,
    )
    // Assert
    expect(pixels).toBeNull()
  })

  it.each([
    { x: -1, y: 0, width: 100, height: 100 },
    { x: 1, y: 0, width: 100, height: 100 },
    { x: 0, y: 50, width: 100, height: 51 },
    { x: 0, y: 0, width: 0, height: 100 },
    { x: Number.NaN, y: 0, width: 100, height: 100 },
  ])('rejects invalid crop coordinates %j', (crop) => {
    // Arrange / Act
    const pixels = backgroundCropPixels(crop, 3840, 2160)
    // Assert
    expect(pixels).toBeNull()
  })

  it('keeps a subpixel selection measurable but ineligible for Apply', () => {
    // Arrange / Act
    const pixels = backgroundCropPixels(
      { x: 0, y: 0, width: 0.001, height: 0.001 },
      1920,
      1080,
    )
    // Assert
    expect(pixels).toEqual({
      left: 0,
      top: 0,
      width: 0,
      height: 0,
      isLargeEnough: false,
    })
  })
})
