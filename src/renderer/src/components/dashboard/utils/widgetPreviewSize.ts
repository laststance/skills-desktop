import type { WidgetSize } from '@/renderer/src/components/dashboard/types'
import {
  GRID_MARGIN_PX,
  GRID_ROW_HEIGHT_PX,
} from '@/renderer/src/components/dashboard/utils/gridConstants'

/**
 * Pixel dimensions for rendering a widget at its default grid footprint inside
 * a static preview (the WidgetPicker live preview), so wide widgets look wide
 * and compact ones look compact instead of all filling one generic box.
 *
 * Uses a square reference cell (`GRID_ROW_HEIGHT_PX`) for column width because
 * the dashboard's column width ≈ its row height at the detail pane's typical
 * width — that approximation keeps each widget's relative aspect ratio faithful
 * without needing the live grid container width here.
 *
 * @param size - A widget's `defaultSize` in 6-col grid cells (`{ w, h }`).
 * @returns Pixel box `{ widthPx, heightPx }`, inter-cell margins included.
 * @example
 * widgetPreviewSize({ w: 3, h: 2 }) // => { widthPx: 208, heightPx: 136 }
 * widgetPreviewSize({ w: 6, h: 3 }) // => { widthPx: 424, heightPx: 208 }
 */
export function widgetPreviewSize(size: WidgetSize): {
  widthPx: number
  heightPx: number
} {
  const [marginPx] = GRID_MARGIN_PX
  // n cells span n row-heights plus the (n-1) margins between them.
  const cellSpanPx = (cells: number): number =>
    cells * GRID_ROW_HEIGHT_PX + (cells - 1) * marginPx
  return { widthPx: cellSpanPx(size.w), heightPx: cellSpanPx(size.h) }
}
