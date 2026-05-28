import { describe, expect, it } from 'vitest'

import type { WidgetSize } from '@/renderer/src/components/dashboard/types'

import { widgetPreviewSize } from './widgetPreviewSize'

describe('widgetPreviewSize', () => {
  it('sizes a default 3x2 widget to a wide preview box', () => {
    // Arrange
    const defaultSize: WidgetSize = { w: 3, h: 2 }

    // Act
    const box = widgetPreviewSize(defaultSize)

    // Assert
    expect(box).toEqual({ widthPx: 208, heightPx: 136 })
  })

  it('sizes a full-width 6x3 widget to a large preview box', () => {
    // Arrange
    const defaultSize: WidgetSize = { w: 6, h: 3 }

    // Act
    const box = widgetPreviewSize(defaultSize)

    // Assert
    expect(box).toEqual({ widthPx: 424, heightPx: 208 })
  })

  it('sizes a single 1x1 cell with no inter-cell margin', () => {
    // Arrange
    const defaultSize: WidgetSize = { w: 1, h: 1 }

    // Act
    const box = widgetPreviewSize(defaultSize)

    // Assert
    expect(box).toEqual({ widthPx: 64, heightPx: 64 })
  })
})
