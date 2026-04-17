/**
 * Feature flags for controlling experimental/incomplete features
 *
 * Convention:
 * - Flag name: ENABLE_<FEATURE_NAME>
 * - Default: false for incomplete features
 * - Set to true when feature is ready for release
 * - Remove flag entirely when feature is stable
 */
export const FEATURE_FLAGS = {
  /**
   * Marketplace in-app browsing and installation
   * Currently disabled: skills CLI lacks marketplace API
   * When enabled: Shows full marketplace UI with search/install
   * When disabled: Opens skill.sh website in browser
   */
  ENABLE_MARKETPLACE_UI: true,
  /**
   * Experimental dashboard widgets (agent-heatmap, activity-timeline)
   * Hidden from the widget picker when false.
   * When enabled: Users can add these widgets to their dashboard.
   * When disabled: Registry entries exist but picker filters them out.
   */
  ENABLE_DASHBOARD_EXPERIMENTAL: false,
} as const

export type FeatureFlag = keyof typeof FEATURE_FLAGS
