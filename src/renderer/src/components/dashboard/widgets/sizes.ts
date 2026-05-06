import type {
  WidgetSize,
  WidgetType,
} from '@/renderer/src/components/dashboard/types'

// ============================================================================
// Widget size metadata
// ----------------------------------------------------------------------------
// Pure data table of `defaultSize` / `minSize` per `WidgetType`. Kept separate
// from `widgets/registry.ts` so that consumers needing *only* sizing — the
// Redux slice (`dashboardSlice.addWidget`) and preset builder
// (`widgetPresets.buildDefaultDashboardPages`) — can read sizes without
// importing the registry, which transitively pulls every widget React
// component. That import edge is what previously created the cycle:
//   dashboardSlice → registry → <Widget>.tsx → dashboardSlice
// `registry.ts` continues to own the visual + behavioral metadata (label,
// icon, Component, experimental flag) and reads sizes from this module so
// the numbers stay in one place.
// ============================================================================

/**
 * Default and minimum grid size per widget type, in 6-col grid cells.
 * Indexed by `WidgetType`; every variant must have an entry — `Record` (not
 * `Partial<Record>`) enforces this at compile time, so adding a new
 * `WidgetType` without a size triggers a TypeScript error here.
 *
 * @example
 * WIDGET_SIZES['stats']
 * // => { defaultSize: { w: 3, h: 2 }, minSize: { w: 2, h: 2 } }
 */
export const WIDGET_SIZES: Readonly<
  Record<WidgetType, { defaultSize: WidgetSize; minSize: WidgetSize }>
> = {
  welcome: {
    defaultSize: { w: 6, h: 3 },
    minSize: { w: 4, h: 2 },
  },
  stats: {
    defaultSize: { w: 3, h: 2 },
    minSize: { w: 2, h: 2 },
  },
  health: {
    defaultSize: { w: 3, h: 2 },
    minSize: { w: 2, h: 2 },
  },
  coverage: {
    defaultSize: { w: 6, h: 3 },
    minSize: { w: 4, h: 2 },
  },
  bookmarks: {
    defaultSize: { w: 3, h: 3 },
    minSize: { w: 2, h: 2 },
  },
  trending: {
    defaultSize: { w: 6, h: 4 },
    minSize: { w: 3, h: 3 },
  },
  'whats-new': {
    defaultSize: { w: 3, h: 3 },
    minSize: { w: 2, h: 2 },
  },
  'quick-actions': {
    defaultSize: { w: 6, h: 3 },
    minSize: { w: 3, h: 3 },
  },
  'agent-heatmap': {
    defaultSize: { w: 6, h: 4 },
    minSize: { w: 4, h: 3 },
  },
  'activity-timeline': {
    defaultSize: { w: 6, h: 4 },
    minSize: { w: 3, h: 3 },
  },
} as const
