import type { WidgetInstance, WidgetSize } from '../types'

import {
  GRID_COLS,
  MAX_GRID_ROWS_SEARCH,
  MAX_WIDGETS_PER_PAGE,
} from './gridConstants'

/**
 * Place a `size`×`size` rectangle into the grid of existing widgets.
 * Scans top-to-bottom, left-to-right, returning the first position that fits
 * without overlapping any existing widget and without exceeding the grid width.
 *
 * @param widgets - Widgets already on the page.
 * @param size - Desired width/height in grid cells.
 * @returns
 * - `{ x, y }` when an empty spot is found
 * - `null` when the page is "full" (widget count limit reached OR no spot within `MAX_GRID_ROWS_SEARCH` rows)
 *
 * @example
 * findEmptySpot([], { w: 6, h: 2 })                       // => { x: 0, y: 0 }
 * findEmptySpot([{...w:6,h:2,x:0,y:0}], { w: 6, h: 2 })   // => { x: 0, y: 2 }
 */
export function findEmptySpot(
  widgets: readonly WidgetInstance[],
  size: WidgetSize,
): { x: number; y: number } | null {
  // Page-fullness shortcut: macOS-style overflow kicks in once the user's
  // visible-widget budget is exhausted, even if the grid is technically free.
  if (widgets.length >= MAX_WIDGETS_PER_PAGE) return null

  if (size.w > GRID_COLS) return null

  // Build an occupancy map for cells 0..maxY of the existing widgets.
  // Using a string-key Set avoids allocating a 2D array whose height we don't know.
  const occupied = new Set<string>()
  for (const widget of widgets) {
    for (let dx = 0; dx < widget.w; dx++) {
      for (let dy = 0; dy < widget.h; dy++) {
        occupied.add(`${widget.x + dx},${widget.y + dy}`)
      }
    }
  }

  for (let originY = 0; originY < MAX_GRID_ROWS_SEARCH; originY++) {
    for (let originX = 0; originX <= GRID_COLS - size.w; originX++) {
      if (fitsAt(occupied, originX, originY, size)) {
        return { x: originX, y: originY }
      }
    }
  }

  return null
}

/**
 * Check whether a rectangle of `size` fits at `(originX, originY)` without
 * overlapping any cell in `occupied`.
 */
function fitsAt(
  occupied: ReadonlySet<string>,
  originX: number,
  originY: number,
  size: WidgetSize,
): boolean {
  for (let dx = 0; dx < size.w; dx++) {
    for (let dy = 0; dy < size.h; dy++) {
      if (occupied.has(`${originX + dx},${originY + dy}`)) return false
    }
  }
  return true
}
