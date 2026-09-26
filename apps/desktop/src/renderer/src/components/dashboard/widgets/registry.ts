import {
  Activity,
  BarChart3,
  Bookmark,
  FileClock,
  Flame,
  Grid3x3,
  Hand,
  HeartPulse,
  Sparkles,
  Zap,
} from 'lucide-react'

import type {
  WidgetDefinition,
  WidgetType,
} from '@/renderer/src/components/dashboard/types'

import { ActivityTimelineWidget } from './ActivityTimelineWidget'
import { AgentHeatmapWidget } from './AgentHeatmapWidget'
import { BookmarksWidget } from './BookmarksWidget'
import { CoverageWidget } from './CoverageWidget'
import { HealthWidget } from './HealthWidget'
import { QuickActionsWidget } from './QuickActionsWidget'
import { WIDGET_SIZES } from './sizes'
import { StatsWidget } from './StatsWidget'
import { TrendingWidget } from './TrendingWidget'
import { WelcomeWidget } from './WelcomeWidget'
import { WhatsNewWidget } from './WhatsNewWidget'

// ============================================================================
// Widget Registry
// ----------------------------------------------------------------------------
// Single source of truth for every widget type. The canvas, WidgetPicker, and
// preset builders all read from this map. Adding a new widget means:
//   1. add its id to `WidgetType` in `../types.ts`
//   2. add an entry below with its real body `Component`
// ============================================================================

export const WIDGET_REGISTRY: Readonly<Record<WidgetType, WidgetDefinition>> = {
  welcome: {
    type: 'welcome',
    label: 'Welcome',
    description: 'Introduction card shown on first launch — dismissible.',
    icon: Hand,
    defaultSize: WIDGET_SIZES.welcome.defaultSize,
    minSize: WIDGET_SIZES.welcome.minSize,
    Component: WelcomeWidget,
  },
  stats: {
    type: 'stats',
    label: 'Skill Stats',
    description: 'Totals for skills, linked skills, and agents at a glance.',
    icon: BarChart3,
    defaultSize: WIDGET_SIZES.stats.defaultSize,
    minSize: WIDGET_SIZES.stats.minSize,
    Component: StatsWidget,
  },
  health: {
    type: 'health',
    label: 'Symlink Health',
    description: 'Valid vs. broken symlinks across all agents.',
    icon: HeartPulse,
    defaultSize: WIDGET_SIZES.health.defaultSize,
    minSize: WIDGET_SIZES.health.minSize,
    Component: HealthWidget,
  },
  coverage: {
    type: 'coverage',
    label: 'Agent Coverage',
    description: 'Which agents have which skills — quick matrix view.',
    icon: Grid3x3,
    defaultSize: WIDGET_SIZES.coverage.defaultSize,
    minSize: WIDGET_SIZES.coverage.minSize,
    Component: CoverageWidget,
  },
  bookmarks: {
    type: 'bookmarks',
    label: 'Bookmarks',
    description: 'Your saved skills from the marketplace.',
    icon: Bookmark,
    defaultSize: WIDGET_SIZES.bookmarks.defaultSize,
    minSize: WIDGET_SIZES.bookmarks.minSize,
    Component: BookmarksWidget,
  },
  trending: {
    type: 'trending',
    label: 'Trending',
    description: 'Popular skills in the marketplace right now.',
    icon: Flame,
    defaultSize: WIDGET_SIZES.trending.defaultSize,
    minSize: WIDGET_SIZES.trending.minSize,
    Component: TrendingWidget,
  },
  'whats-new': {
    type: 'whats-new',
    label: "What's New",
    description: 'Recently added or updated skills in the marketplace.',
    icon: Sparkles,
    defaultSize: WIDGET_SIZES['whats-new'].defaultSize,
    minSize: WIDGET_SIZES['whats-new'].minSize,
    Component: WhatsNewWidget,
  },
  'quick-actions': {
    type: 'quick-actions',
    label: 'Quick Actions',
    description: 'Frequent actions: sync, refresh, open marketplace.',
    icon: Zap,
    defaultSize: WIDGET_SIZES['quick-actions'].defaultSize,
    minSize: WIDGET_SIZES['quick-actions'].minSize,
    Component: QuickActionsWidget,
  },
  'agent-heatmap': {
    type: 'agent-heatmap',
    label: 'Agent Heatmap',
    description: 'Symlink density per agent visualized as a heatmap.',
    icon: Activity,
    defaultSize: WIDGET_SIZES['agent-heatmap'].defaultSize,
    minSize: WIDGET_SIZES['agent-heatmap'].minSize,
    Component: AgentHeatmapWidget,
    experimental: true,
  },
  'activity-timeline': {
    type: 'activity-timeline',
    label: 'Activity Timeline',
    description: 'Recent add/remove/sync events in chronological order.',
    icon: FileClock,
    defaultSize: WIDGET_SIZES['activity-timeline'].defaultSize,
    minSize: WIDGET_SIZES['activity-timeline'].minSize,
    Component: ActivityTimelineWidget,
    experimental: true,
  },
} as const

/**
 * List all widget types visible in the picker.
 * Experimental widgets are filtered out unless the feature flag is on.
 *
 * @param experimentalEnabled - pass `FEATURE_FLAGS.ENABLE_DASHBOARD_EXPERIMENTAL`
 * @returns widget definitions in picker order
 */
export function listAvailableWidgets(
  experimentalEnabled: boolean,
): readonly WidgetDefinition[] {
  const all = Object.values(WIDGET_REGISTRY)
  return experimentalEnabled ? all : all.filter((w) => !w.experimental)
}

/**
 * Look up a widget definition by type.
 * Returns `undefined` for unknown types — callers should render nothing in
 * that case (can happen if persisted state references a removed widget).
 */
export function getWidgetDefinition(
  type: WidgetType,
): WidgetDefinition | undefined {
  return WIDGET_REGISTRY[type]
}
