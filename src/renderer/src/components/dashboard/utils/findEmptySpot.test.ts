import { describe, expect, it } from 'vitest'

import type { WidgetInstance, WidgetInstanceId, WidgetType } from '../types'

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
  it('returns origin on an empty page', () => {
    expect(findEmptySpot([], { w: 6, h: 2 })).toEqual({ x: 0, y: 0 })
  })

  it('places a widget below an existing full-width widget', () => {
    const widgets = [buildWidget({ x: 0, y: 0, w: 6, h: 2 })]
    expect(findEmptySpot(widgets, { w: 6, h: 2 })).toEqual({ x: 0, y: 2 })
  })

  it('packs a small widget beside a half-width one on the same row', () => {
    // 3-wide widget on the left → next 3-wide widget can sit at x=3.
    const widgets = [buildWidget({ x: 0, y: 0, w: 3, h: 2 })]
    expect(findEmptySpot(widgets, { w: 3, h: 2 })).toEqual({ x: 3, y: 0 })
  })

  it('returns null when the page is at MAX_WIDGETS_PER_PAGE', () => {
    // 4 widgets of any size → full page per the macOS-style overflow rule.
    const widgets = [
      buildWidget({ x: 0, y: 0, w: 3, h: 1 }),
      buildWidget({ x: 3, y: 0, w: 3, h: 1 }),
      buildWidget({ x: 0, y: 1, w: 3, h: 1 }),
      buildWidget({ x: 3, y: 1, w: 3, h: 1 }),
    ]
    expect(findEmptySpot(widgets, { w: 3, h: 1 })).toBeNull()
  })

  it('returns null when the requested width exceeds the grid', () => {
    // 6-col grid; asking for width 7 can never fit.
    expect(findEmptySpot([], { w: 7, h: 1 })).toBeNull()
  })
})
