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
 * @description All widget types recognized by the dashboard. Experimental
 * widgets are hidden behind `experimental: true` in the registry.
 * @example "stats"
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
  /** Unique instance id (distinct from the page id and the widget type). */
  id: WidgetInstanceId
  /** Which registered widget this instance renders. */
  type: WidgetType
  /** Zero-based grid column where the widget begins. */
  x: GridColumnStart
  /** Zero-based grid row where the widget begins. */
  y: GridRowStart
  /** Width in grid columns. */
  w: GridColumnSpan
  /** Height in grid rows. */
  h: GridRowSpan
}

/**
 * A dashboard page holding up to ~4 widgets. When the user adds a widget and
 * no empty grid cell fits, a new page is created automatically.
 * @example
 * { id: 'p_abc', name: 'Overview', widgets: [{ id: 'w_abc', type: 'stats', x: 0, y: 0, w: 6, h: 2 }] }
 */
export interface DashboardPage {
  /** Unique id for this page (tab). */
  id: DashboardPageId
  /** Human-readable tab name shown in the page strip. */
  name: DashboardPageName
  /** Widgets placed on this page, each with its own grid placement. */
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
 * @description Grid size bounds for a widget, in 6-col cells. Used for both
 * `defaultSize` and `minSize` in a WidgetDefinition.
 */
export interface WidgetSize {
  /** Width in grid columns. */
  w: GridColumnSpan
  /** Height in grid rows. */
  h: GridRowSpan
}

/**
 * @description Static description of a widget type — label, icon, default/min
 * size, and the component that renders its body inside the WidgetShell frame.
 * One entry per WidgetType lives in `widgets/registry.ts`.
 * @example
 * { type: 'stats', label: 'Skill Stats', description: 'Totals at a glance', icon: BarChart3, defaultSize: { w: 6, h: 2 }, minSize: { w: 3, h: 2 }, Component: StatsWidget }
 */
export interface WidgetDefinition {
  /** Which widget type this definition describes. */
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
