/**
 * Grid layout constants — keep in sync with react-grid-layout props in DashboardCanvas.
 *
 * The detail panel is narrow (often 300–500px), so a 6-column grid gives enough
 * resolution for two small widgets side-by-side without forcing each widget
 * into a sliver. Row height is intentionally small (48px) so widgets can
 * express their height in rounded increments (2=header+counter, 3=small list,
 * 4+=scrollable list).
 */
export const GRID_COLS = 6
export const GRID_ROW_HEIGHT_PX = 48
export const GRID_MARGIN_PX: readonly [number, number] = [8, 8]
export const GRID_CONTAINER_PADDING_PX: readonly [number, number] = [12, 12]

/**
 * Maximum widgets per page before auto-overflow kicks in.
 * 4 keeps pages scannable at a glance on a narrow side panel — adding a 5th
 * widget creates a new page automatically (macOS home-screen style).
 */
export const MAX_WIDGETS_PER_PAGE = 4

/**
 * Maximum number of rows tried when searching for an empty spot.
 * Beyond this, the page is treated as full and overflow triggers a new page.
 */
export const MAX_GRID_ROWS_SEARCH = 40

/** Class name used as the draggable handle on each WidgetShell header. */
export const WIDGET_DRAG_HANDLE_CLASS = 'widget-drag-handle'
