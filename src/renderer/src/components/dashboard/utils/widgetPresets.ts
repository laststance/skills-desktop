import type { DashboardPage, WidgetInstance, WidgetType } from '../types'
import { WIDGET_REGISTRY } from '../widgets/registry'

import { newDashboardPageId, newWidgetInstanceId } from './ids'

// ============================================================================
// Default dashboard preset
// ----------------------------------------------------------------------------
// Shown on first launch. Four pages mirror the "information architecture" of
// the app: Overview (at-a-glance state) → Discovery (marketplace) → Actions
// (things to do) → Personal (your saved work). Each page holds 3–4 widgets,
// staying under MAX_WIDGETS_PER_PAGE so the user can add one without overflow.
// ============================================================================

/** Specification for a page-to-be-built — layout is laid out by hand per preset. */
interface PageSpec {
  name: string
  widgets: readonly {
    type: WidgetType
    x: number
    y: number
    /** Optional size overrides. If omitted, the registry default is used. */
    w?: number
    h?: number
  }[]
}

const PAGE_SPECS: readonly PageSpec[] = [
  {
    name: 'Overview',
    widgets: [
      { type: 'welcome', x: 0, y: 0, w: 6, h: 3 },
      { type: 'stats', x: 0, y: 3 },
      { type: 'health', x: 3, y: 3 },
      { type: 'coverage', x: 0, y: 5, w: 6, h: 3 },
    ],
  },
  {
    name: 'Discovery',
    widgets: [
      { type: 'trending', x: 0, y: 0, w: 6, h: 4 },
      { type: 'whats-new', x: 0, y: 4, w: 6, h: 3 },
    ],
  },
  {
    name: 'Actions',
    widgets: [{ type: 'quick-actions', x: 0, y: 0, w: 6, h: 2 }],
  },
  {
    name: 'Personal',
    widgets: [{ type: 'bookmarks', x: 0, y: 0, w: 6, h: 4 }],
  },
]

/**
 * Build the default 4-page dashboard. Called once on first launch (or when
 * the persisted state is empty). Subsequent launches load whatever the user
 * arranged.
 *
 * @returns Four dashboard pages with preset widget layouts.
 * @example
 * const state = buildDefaultDashboardPages()
 * state.length                       // => 4
 * state[0].name                      // => "Overview"
 * state[0].widgets.map(w => w.type)  // => ["welcome", "stats", "health", "coverage"]
 */
export function buildDefaultDashboardPages(): DashboardPage[] {
  return PAGE_SPECS.map((spec) => ({
    id: newDashboardPageId(),
    name: spec.name,
    widgets: spec.widgets.map((widgetSpec) => {
      const def = WIDGET_REGISTRY[widgetSpec.type]
      const instance: WidgetInstance = {
        id: newWidgetInstanceId(),
        type: widgetSpec.type,
        x: widgetSpec.x,
        y: widgetSpec.y,
        w: widgetSpec.w ?? def.defaultSize.w,
        h: widgetSpec.h ?? def.defaultSize.h,
      }
      return instance
    }),
  }))
}
