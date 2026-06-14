import { describe, expect, it } from 'vitest'

import type {
  WidgetInstance,
  WidgetInstanceId,
  WidgetType,
} from '@/renderer/src/components/dashboard/types'

import { findEmptySpot } from './findEmptySpot'

// ----------------------------------------------------------------------------
// Helper: build a widget with just the fields `findEmptySpot` reads. Using
// `as WidgetInstanceId` here is the only place we cast — the test layer owns
// the type shortcut so the production code stays branded.
// ----------------------------------------------------------------------------

function buildWidget(
  position: { x: number; y: number; w: number; h: number },
  type: WidgetType = 'stats',
): WidgetInstance {
  return {
    id: `w_test_${position.x}_${position.y}` as WidgetInstanceId,
    type,
    ...position,
  }
}

describe('findEmptySpot', () => {
  it('drops the first widget into the top-left corner of an empty page', () => {
    // Arrange
    const noWidgets: WidgetInstance[] = []

    // Act
    const spot = findEmptySpot(noWidgets, { w: 6, h: 2 })

    // Assert
    expect(spot).toEqual({ x: 0, y: 0 })
  })

  it('stacks a new full-width widget on the row below an existing one', () => {
    // Arrange
    const widgets = [buildWidget({ x: 0, y: 0, w: 6, h: 2 })]

    // Act
    const spot = findEmptySpot(widgets, { w: 6, h: 2 })

    // Assert
    expect(spot).toEqual({ x: 0, y: 2 })
  })

  it('packs a small widget beside a half-width one on the same row', () => {
    // Arrange — 3-wide widget on the left → next 3-wide widget can sit at x=3.
    const widgets = [buildWidget({ x: 0, y: 0, w: 3, h: 2 })]

    // Act
    const spot = findEmptySpot(widgets, { w: 3, h: 2 })

    // Assert
    expect(spot).toEqual({ x: 3, y: 0 })
  })

  it('refuses to place a widget once the page already holds MAX_WIDGETS_PER_PAGE', () => {
    // Arrange — 4 widgets of any size → full page per the macOS-style overflow rule.
    const widgets = [
      buildWidget({ x: 0, y: 0, w: 3, h: 1 }),
      buildWidget({ x: 3, y: 0, w: 3, h: 1 }),
      buildWidget({ x: 0, y: 1, w: 3, h: 1 }),
      buildWidget({ x: 3, y: 1, w: 3, h: 1 }),
    ]

    // Act
    const spot = findEmptySpot(widgets, { w: 3, h: 1 })

    // Assert
    expect(spot).toBeNull()
  })

  it('refuses to place a widget wider than the grid itself', () => {
    // Arrange — 6-col grid; asking for width 7 can never fit.
    const noWidgets: WidgetInstance[] = []

    // Act
    const spot = findEmptySpot(noWidgets, { w: 7, h: 1 })

    // Assert
    expect(spot).toBeNull()
  })

  it('returns null when one widget fills every searchable row so no spot is left', () => {
    // Arrange — a single full-width widget tall enough to occupy all 40 searched
    // rows (w=6 = GRID_COLS, h=40 = MAX_GRID_ROWS_SEARCH). Count is 1, below the
    // MAX_WIDGETS_PER_PAGE limit, so the search loop runs and exhausts every row.
    const widgets = [buildWidget({ x: 0, y: 0, w: 6, h: 40 })]

    // Act
    const spot = findEmptySpot(widgets, { w: 6, h: 1 })

    // Assert
    expect(spot).toBeNull()
  })
})
