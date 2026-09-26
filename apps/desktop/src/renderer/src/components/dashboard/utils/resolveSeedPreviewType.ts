import type {
  WidgetDefinition,
  WidgetType,
} from '@/renderer/src/components/dashboard/types'

/**
 * Pick which widget the live-preview stage should show by default — the seed.
 * Welcome is first in the catalog, but once dismissed its body renders only a
 * muted "already dismissed" hint (global flag, not per-instance). That makes a
 * poor first frame, so returning users seed on the next widget. Welcome stays
 * in the list and still previews truthfully when hovered.
 *
 * Pulled out of `WidgetPicker` so it's unit-testable without React Testing
 * Library, per the renderer convention for conditional UI logic.
 *
 * @param availableWidgets - Visible picker rows (post feature-flag filter).
 * @param isWelcomeDismissed - Whether the user has already dismissed Welcome.
 * @returns The widget type to seed the stage with, or `undefined` when the
 *   catalog is empty (caller falls back to `'welcome'`).
 * @example
 * resolveSeedPreviewType({
 *   availableWidgets: [{ type: 'welcome', ... }, { type: 'stats', ... }],
 *   isWelcomeDismissed: true,
 * }) // => 'stats'
 * resolveSeedPreviewType({
 *   availableWidgets: [{ type: 'welcome', ... }, { type: 'stats', ... }],
 *   isWelcomeDismissed: false,
 * }) // => 'welcome'
 */
export function resolveSeedPreviewType({
  availableWidgets,
  isWelcomeDismissed,
}: {
  availableWidgets: readonly WidgetDefinition[]
  isWelcomeDismissed: boolean
}): WidgetType | undefined {
  if (availableWidgets[0]?.type === 'welcome' && isWelcomeDismissed) {
    return availableWidgets[1]?.type
  }
  return availableWidgets[0]?.type
}
