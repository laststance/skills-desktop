import type { Brand } from '@/shared/types'

// ============================================================================
// Widget identifiers
// ----------------------------------------------------------------------------
// Each widget type is a literal string. The list is closed — only registered
// widgets can exist. Adding a new widget requires:
//   1. Adding the id here
//   2. Adding a WidgetDefinition in `widgets/registry.ts`
// ============================================================================

/**
 * All widget types recognized by the dashboard.
 * Experimental widgets are hidden behind `experimental: true` in the registry.
 */
export type WidgetType =
  | 'stats'
  | 'health'
  | 'coverage'
  | 'bookmarks'
  | 'trending'
  | 'whats-new'
  | 'quick-actions'
  | 'welcome'
  | 'agent-heatmap'
  | 'activity-timeline'

/**
 * Unique instance id for a widget placed on a page.
 * Branded so it cannot be confused with other string ids (page id, skill name).
 * @example "w_01JEXK..."
 */
export type WidgetInstanceId = Brand<string, 'WidgetInstanceId'>

/**
 * Unique id for a dashboard page (tab).
 * @example "p_01JEXK..."
 */
export type DashboardPageId = Brand<string, 'DashboardPageId'>

/**
 * @description Human-readable tab name shown in the dashboard page strip.
 * @example "Overview"
 */
export type DashboardPageName = string

// ============================================================================
// Placement
// ----------------------------------------------------------------------------
// `x`/`y`/`w`/`h` are 6-col grid cells (not pixels). See `GRID_COLS` /
// `GRID_ROW_HEIGHT_PX` in utils. Kept small-integer to match react-grid-layout.
// ============================================================================

/**
 * @description Zero-based grid column where a widget begins.
 * @example 3
 */
export type GridColumnStart = number

/**
 * @description Zero-based grid row where a widget begins.
 * @example 6
 */
export type GridRowStart = number

/**
 * @description Width of a widget measured in dashboard grid columns.
 * @example 6
 */
export type GridColumnSpan = number

/**
 * @description Height of a widget measured in dashboard grid rows.
 * @example 3
 */
export type GridRowSpan = number

/**
 * A single placed widget on a page.
 * Shape kept compatible with react-grid-layout's Layout item (`i`, `x`, `y`, `w`, `h`).
 * @example
 * { id: 'w_abc', type: 'stats', x: 0, y: 0, w: 6, h: 2 }
 */
export interface WidgetInstance {
  id: WidgetInstanceId
  type: WidgetType
  x: GridColumnStart
  y: GridRowStart
  w: GridColumnSpan
  h: GridRowSpan
}

/**
 * A dashboard page holding up to ~4 widgets. When the user adds a widget and
 * no empty grid cell fits, a new page is created automatically.
 */
export interface DashboardPage {
  id: DashboardPageId
  name: DashboardPageName
  widgets: WidgetInstance[]
}

// ============================================================================
// Registry metadata — declarative description of each widget type
// ----------------------------------------------------------------------------
// The registry pairs each WidgetType with default placement + a renderer.
// This indirection lets the canvas render any widget without knowing concrete
// components, and lets the WidgetPicker list options without hard-coding them.
// ============================================================================

/**
 * Grid size bounds for a widget, in 6-col cells.
 */
export interface WidgetSize {
  w: GridColumnSpan
  h: GridRowSpan
}

/**
 * Static description of a widget type — label, icon, default/min size, and
 * the component that renders its body inside the WidgetShell frame.
 */
export interface WidgetDefinition {
  type: WidgetType
  /** Short label shown in WidgetPicker and in the widget's title bar. */
  label: string
  /** One-sentence description shown in WidgetPicker. */
  description: string
  /** Lucide icon for the widget header + picker. */
  icon: React.ComponentType<{ className?: string }>
  /** Default placement size when the widget is added. */
  defaultSize: WidgetSize
  /** Minimum size a user can resize to. */
  minSize: WidgetSize
  /** Renderer for the widget body. Receives its own instance for per-widget state. */
  Component: React.ComponentType<{ instance: WidgetInstance }>
  /**
   * When true, the widget is hidden from the picker unless the
   * `ENABLE_DASHBOARD_EXPERIMENTAL` feature flag is on.
   */
  experimental?: boolean
}
