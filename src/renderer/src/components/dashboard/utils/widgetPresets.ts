import type {
  DashboardPage,
  DashboardPageName,
  GridColumnSpan,
  GridColumnStart,
  GridRowSpan,
  GridRowStart,
  WidgetInstance,
  WidgetType,
} from '@/renderer/src/components/dashboard/types'
import {
  toDashboardPageName,
  toGridColumnSpan,
  toGridColumnStart,
  toGridRowSpan,
  toGridRowStart,
} from '@/renderer/src/components/dashboard/types'
import { WIDGET_SIZES } from '@/renderer/src/components/dashboard/widgets/sizes'

import { newDashboardPageId, newWidgetInstanceId } from './ids'

// ============================================================================
// Default dashboard preset
// ----------------------------------------------------------------------------
// Shown on first launch. Four pages mirror the "information architecture" of
// the app: Overview (at-a-glance state) → Discovery (marketplace) → Actions
// (things to do) → Personal (your saved work). Overview ships full — four
// widgets, equal to MAX_WIDGETS_PER_PAGE (one is the dismissable Welcome card);
// the other pages hold one or two. Adding a widget to a page that is already
// full is non-destructive: `addWidget` drops the new widget onto a
// freshly-created page and navigates there. Once Welcome is dismissed, Overview
// falls to three widgets and accepts an in-place add.
// ============================================================================

/** Specification for a page-to-be-built — layout is laid out by hand per preset. */
interface PageSpec {
  name: DashboardPageName
  widgets: readonly {
    type: WidgetType
    x: GridColumnStart
    y: GridRowStart
    /** Optional size overrides. If omitted, the registry default is used. */
    w?: GridColumnSpan
    h?: GridRowSpan
  }[]
}

const PAGE_SPECS: readonly PageSpec[] = [
  {
    name: toDashboardPageName('Overview'),
    widgets: [
      {
        type: 'welcome',
        x: toGridColumnStart(0),
        y: toGridRowStart(0),
        w: toGridColumnSpan(6),
        h: toGridRowSpan(3),
      },
      { type: 'stats', x: toGridColumnStart(0), y: toGridRowStart(3) },
      // health inherits its h=3 default (sizes.ts), occupying rows 3-5 at
      // x3-5, so coverage starts at row 6 to clear it. (At y=5 the vertical
      // compactor would push coverage to 6 on mount anyway; hand-author the
      // honest value rather than rely on runtime collision-resolution.)
      { type: 'health', x: toGridColumnStart(3), y: toGridRowStart(3) },
      {
        type: 'coverage',
        x: toGridColumnStart(0),
        y: toGridRowStart(6),
        w: toGridColumnSpan(6),
        h: toGridRowSpan(3),
      },
    ],
  },
  {
    name: toDashboardPageName('Discovery'),
    widgets: [
      {
        type: 'trending',
        x: toGridColumnStart(0),
        y: toGridRowStart(0),
        w: toGridColumnSpan(6),
        h: toGridRowSpan(4),
      },
      {
        type: 'whats-new',
        x: toGridColumnStart(0),
        y: toGridRowStart(4),
        w: toGridColumnSpan(6),
        h: toGridRowSpan(3),
      },
    ],
  },
  {
    name: toDashboardPageName('Actions'),
    widgets: [
      {
        type: 'quick-actions',
        x: toGridColumnStart(0),
        y: toGridRowStart(0),
        w: toGridColumnSpan(6),
        h: toGridRowSpan(3),
      },
    ],
  },
  {
    name: toDashboardPageName('Personal'),
    widgets: [
      {
        type: 'bookmarks',
        x: toGridColumnStart(0),
        y: toGridRowStart(0),
        w: toGridColumnSpan(6),
        h: toGridRowSpan(4),
      },
    ],
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
      const sizes = WIDGET_SIZES[widgetSpec.type]
      const instance: WidgetInstance = {
        id: newWidgetInstanceId(),
        type: widgetSpec.type,
        x: widgetSpec.x,
        y: widgetSpec.y,
        w: widgetSpec.w ?? sizes.defaultSize.w,
        h: widgetSpec.h ?? sizes.defaultSize.h,
      }
      return instance
    }),
  }))
}
