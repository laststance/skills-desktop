import { describe, expect, test } from 'vitest'

import { backgroundImageLayout } from './backgroundImageLayout'

describe('background layout geometry', () => {
  test('Fill covers the entire surface while excluding pixels outside the source crop', () => {
    // Arrange / Act
    const layout = backgroundImageLayout('fill', {
      left: 10,
      top: 20,
      width: 200,
      height: 100,
      isLargeEnough: false,
    })
    // Assert
    expect(layout).toEqual({
      mode: 'image',
      viewBox: '10 20 200 100',
      imageStyle: {
        display: 'block',
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        objectViewBox: 'xywh(10px 20px 200px 100px)',
      },
    })
  })

  test('Fit preserves the cropped image aspect ratio within both container dimensions', () => {
    // Arrange / Act
    const layout = backgroundImageLayout('fit', {
      left: 10,
      top: 20,
      width: 200,
      height: 100,
      isLargeEnough: false,
    })
    // Assert
    expect(layout).toEqual({
      mode: 'image',
      viewBox: '10 20 200 100',
      imageStyle: {
        display: 'block',
        width: 'min(100cqw, calc(100cqh * 2))',
        height: 'min(100cqh, calc(100cqw * 0.5))',
        objectFit: 'cover',
        objectViewBox: 'xywh(10px 20px 200px 100px)',
      },
    })
  })

  test('Tile switches to SVG sampling and keeps the crop origin in source pixels', () => {
    // Arrange / Act
    const layout = backgroundImageLayout('tile', {
      left: 12,
      top: 24,
      width: 80,
      height: 160,
      isLargeEnough: false,
    })
    // Assert
    expect(layout.mode).toBe('tile')
    expect(layout.viewBox).toBe('12 24 80 160')
  })
})
