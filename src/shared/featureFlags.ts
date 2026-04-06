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
   * Agent Chat Panel (Claude Agent SDK powered)
   * Currently disabled: response latency too high for practical use
   * When enabled: Shows chat panel in right pane
   * When disabled: Shows skill detail (Inspector) in right pane
   */
  ENABLE_CHAT_PANEL: false,
} as const

export type FeatureFlag = keyof typeof FEATURE_FLAGS
