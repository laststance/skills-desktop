import type { ThemePresetName } from './constants'

/**
 * Every palette `<html>` can actually wear. Declared as a value, not just a
 * union, so `src/main/ipc/ipc-schemas.ts` can build the `theme:broadcast`
 * `z.enum` from it — adding a mode then updates the IPC validator with it
 * instead of leaving the two lists to drift apart silently.
 */
export const THEME_MODES = ['light', 'dark'] as const

/** Resolved palette selector. @example 'dark' */
export type ThemeMode = (typeof THEME_MODES)[number]

/**
 * Every value {@link ModePreference} accepts. Same single-source-of-truth
 * reason as {@link THEME_MODES}: the IPC schema derives its enum from here.
 */
export const MODE_PREFERENCES = ['light', 'dark', 'system'] as const

/**
 * User-facing palette mode choice.
 * - 'light' / 'dark' are sticky: the user pinned the palette and we never
 *   auto-flip it regardless of OS appearance changes.
 * - 'system' follows prefers-color-scheme: the listener middleware keeps
 *   {@link ThemeState.mode} in sync with the OS as long as this preference
 *   is active.
 *
 * Persisted alongside `mode` so the resolved value can survive cold starts
 * (read by the pre-hydration bootstrap script) while the preference
 * survives OS theme changes.
 */
export type ModePreference = (typeof MODE_PREFERENCES)[number]

/**
 * Shape persisted in localStorage via `@laststance/redux-storage-middleware`,
 * and the payload of the `theme:changed` broadcast that keeps the Settings
 * window's palette aligned with the main window's.
 *
 * `hue` x `chroma` together project to OKLCH coordinates on `<html>`:
 *   --theme-hue:    state.hue    (angle, ignored when chroma === 0)
 *   --theme-chroma: state.chroma (0 = grayscale ramp, 0.16 = saturated ramp)
 * Mode is tracked independently so users can flip dark/light without losing
 * their color preset. `preset` is the authoritative key; `hue`/`chroma`/`mode`
 * are derived snapshots kept in state so the DOM listener can apply them in
 * one pass without re-looking-up the preset table.
 *
 * `mode` is the resolved palette (what `<html>` actually wears) and
 * `modePreference` is the user's choice. They differ only when the user
 * picked "system" - in which case `mode` mirrors the OS while
 * `modePreference` stays `'system'` so the next OS flip can be honored.
 *
 * Lives in `shared/` rather than the slice because it crosses the IPC
 * boundary: `src/shared/ipc-contract.ts` types the broadcast with it, and a
 * contract reaching into the renderer would invert the layering.
 *
 * @example
 * { hue: 195, chroma: 0.16, mode: 'dark', modePreference: 'system', preset: 'cyan' }
 */
export interface ThemeState {
  /** OKLCH hue angle (0-360). No visual effect when `chroma === 0`. @example 195 */
  hue: number
  /**
   * OKLCH chroma scalar driving the entire token ramp. Only two values are
   * ever persisted: `0` (neutral / shadcn) and `COLOR_PRESET_CHROMA` (color preset).
   */
  chroma: number
  /** Light vs dark palette selector. Applied as `.light` / `.dark` on `<html>`. */
  mode: ThemeMode
  /**
   * User's explicit mode choice. Persisted so the "Auto" affordance survives
   * reloads and the resolver can re-apply OS appearance after hydration.
   */
  modePreference: ModePreference
  /** Authoritative preset key. Drives ThemeSelector's aria-pressed state. */
  preset: ThemePresetName
}
