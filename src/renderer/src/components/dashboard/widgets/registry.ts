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

import type { WidgetDefinition, WidgetType } from '../types'

import { ActivityTimelineWidget } from './ActivityTimelineWidget'
import { AgentHeatmapWidget } from './AgentHeatmapWidget'
import { BookmarksWidget } from './BookmarksWidget'
import { CoverageWidget } from './CoverageWidget'
import { HealthWidget } from './HealthWidget'
import { QuickActionsWidget } from './QuickActionsWidget'
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
    defaultSize: { w: 6, h: 3 },
    minSize: { w: 4, h: 2 },
    Component: WelcomeWidget,
  },
  stats: {
    type: 'stats',
    label: 'Skill Stats',
    description: 'Totals for skills, linked skills, and agents at a glance.',
    icon: BarChart3,
    defaultSize: { w: 3, h: 2 },
    minSize: { w: 2, h: 2 },
    Component: StatsWidget,
  },
  health: {
    type: 'health',
    label: 'Symlink Health',
    description: 'Valid vs. broken symlinks across all agents.',
    icon: HeartPulse,
    defaultSize: { w: 3, h: 2 },
    minSize: { w: 2, h: 2 },
    Component: HealthWidget,
  },
  coverage: {
    type: 'coverage',
    label: 'Agent Coverage',
    description: 'Which agents have which skills — quick matrix view.',
    icon: Grid3x3,
    defaultSize: { w: 6, h: 3 },
    minSize: { w: 4, h: 2 },
    Component: CoverageWidget,
  },
  bookmarks: {
    type: 'bookmarks',
    label: 'Bookmarks',
    description: 'Your saved skills from the marketplace.',
    icon: Bookmark,
    defaultSize: { w: 3, h: 3 },
    minSize: { w: 2, h: 2 },
    Component: BookmarksWidget,
  },
  trending: {
    type: 'trending',
    label: 'Trending',
    description: 'Popular skills in the marketplace right now.',
    icon: Flame,
    defaultSize: { w: 6, h: 4 },
    minSize: { w: 3, h: 3 },
    Component: TrendingWidget,
  },
  'whats-new': {
    type: 'whats-new',
    label: "What's New",
    description: 'Recently added or updated skills in the marketplace.',
    icon: Sparkles,
    defaultSize: { w: 3, h: 3 },
    minSize: { w: 2, h: 2 },
    Component: WhatsNewWidget,
  },
  'quick-actions': {
    type: 'quick-actions',
    label: 'Quick Actions',
    description: 'Frequent actions: sync, refresh, open marketplace.',
    icon: Zap,
    defaultSize: { w: 6, h: 3 },
    minSize: { w: 3, h: 3 },
    Component: QuickActionsWidget,
  },
  'agent-heatmap': {
    type: 'agent-heatmap',
    label: 'Agent Heatmap',
    description: 'Symlink density per agent visualized as a heatmap.',
    icon: Activity,
    defaultSize: { w: 6, h: 4 },
    minSize: { w: 4, h: 3 },
    Component: AgentHeatmapWidget,
    experimental: true,
  },
  'activity-timeline': {
    type: 'activity-timeline',
    label: 'Activity Timeline',
    description: 'Recent add/remove/sync events in chronological order.',
    icon: FileClock,
    defaultSize: { w: 6, h: 4 },
    minSize: { w: 3, h: 3 },
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
