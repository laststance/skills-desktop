import { z } from 'zod'

import { AGENT_IDS, TERMINAL_APP_IDS } from './constants'
import type { AgentId } from './types'

/**
 * Defense-in-depth floor for a persisted startup window size. Set well
 * below the BrowserWindow runtime resize floor (`minWidth: 800` /
 * `minHeight: 600` in `src/main/index.ts`) — those constrain the
 * interactive resize and constructor sizing, which is the real UX
 * boundary. This 400px floor is intentionally distinct: it's a sanity
 * check that catches a corrupted or hand-edited `settings.json`
 * carrying a nonsense value (e.g. `{ width: 0 }`) before it ever
 * reaches the launch path. Exported so tests can pin to it instead of
 * duplicating the literal.
 */
export const WINDOW_SIZE_MIN_DIMENSION = 400

/**
 * Bounds for the main window's Electron 42 background blur radius.
 * Radius is persisted in whole CSS pixels because `view.setBackgroundBlur`
 * accepts an integer pixel value, and a bounded range keeps a hand-edited
 * settings file from requesting a visually unusable blur.
 */
export const WINDOW_BACKGROUND_BLUR_MIN_RADIUS = 0
export const WINDOW_BACKGROUND_BLUR_MAX_RADIUS = 48

/**
 * Visual opacity range paired with the background blur slider.
 * `1` keeps the app surface fully opaque when blur is off; the minimum keeps the desktop visible.
 */
export const WINDOW_BACKGROUND_OPACITY_MAX = 1
export const WINDOW_BACKGROUND_OPACITY_MIN = 0.45

/**
 * Clamp a persisted blur radius before it touches Electron or CSS surfaces.
 * @param blurRadius - User setting from `settings.json` or IPC.
 * @returns Whole-pixel radius inside the app-supported range.
 * @example
 * normalizeWindowBackgroundBlurRadius(99) // => 48
 */
export function normalizeWindowBackgroundBlurRadius(
  blurRadius: number,
): number {
  return Math.min(
    WINDOW_BACKGROUND_BLUR_MAX_RADIUS,
    Math.max(WINDOW_BACKGROUND_BLUR_MIN_RADIUS, Math.trunc(blurRadius)),
  )
}

/**
 * Convert the blur slider into the visible app-surface opacity.
 * @param blurRadius - User setting from `settings.json` or IPC.
 * @returns BrowserWindow opacity, where higher blur means more transparency.
 * @example
 * getWindowBackgroundOpacity(24) // => 0.72
 */
export function getWindowBackgroundOpacity(blurRadius: number): number {
  const normalizedRadius = normalizeWindowBackgroundBlurRadius(blurRadius)
  if (normalizedRadius === WINDOW_BACKGROUND_BLUR_MIN_RADIUS) {
    return WINDOW_BACKGROUND_OPACITY_MAX
  }

  const blurProgress = normalizedRadius / WINDOW_BACKGROUND_BLUR_MAX_RADIUS
  const opacity =
    WINDOW_BACKGROUND_OPACITY_MAX -
    blurProgress *
      (WINDOW_BACKGROUND_OPACITY_MAX - WINDOW_BACKGROUND_OPACITY_MIN)

  // Two decimals are enough for CSS alpha and keep labels stable.
  return Number(opacity.toFixed(2))
}

/**
 * Non-defaulting blur-radius schema shared by disk and IPC boundaries.
 * `SettingsSchema` adds the persisted default; IPC keeps it optional so
 * unrelated partial writes do not materialize a zero-radius reset.
 */
export const WINDOW_BACKGROUND_BLUR_RADIUS_SCHEMA = z
  .number()
  .int()
  .min(WINDOW_BACKGROUND_BLUR_MIN_RADIUS)
  .max(WINDOW_BACKGROUND_BLUR_MAX_RADIUS)

/**
 * Persisted startup window size. `undefined` means "no preference —
 * use the app's launch default". Values are CSS pixels matching what
 * `BrowserWindow.getBounds()` returns (DPR is handled by Electron).
 *
 * Captured from the main window's current bounds when the user clicks
 * "Use current window size" in Settings → General. Cleared when the
 * user clicks "Reset to default".
 */
const windowSizeSchema = z
  .object({
    width: z.number().int().min(WINDOW_SIZE_MIN_DIMENSION),
    height: z.number().int().min(WINDOW_SIZE_MIN_DIMENSION),
  })
  .optional()

/**
 * Forgiving disk-side schema for `hiddenAgentIds`.
 *
 * Pre-filters against `AGENT_IDS` via `transform` instead of validating
 * with `z.enum(AGENT_IDS)`: if an upstream `/cli-upgrade` removes an
 * agent that was previously hidden, the stale id silently falls out of
 * the array rather than rejecting the whole settings file. With strict
 * enum validation, ONE bad id makes `loadSettings()` fall back to
 * defaults — wiping every other field too (default tab, terminal,
 * window size). The `.includes` cast is needed because `.includes` on
 * a `readonly` tuple narrows to its literal members.
 *
 * Element type is `z.unknown()` (not `z.string()`) on purpose: a single
 * non-string element in a hand-edited settings.json (e.g. `[123]`)
 * would otherwise fail array-element validation BEFORE `.transform()`
 * ever runs, taking the entire `SettingsSchema.parse()` down with it
 * — the same blast-radius bug that strict-enum validation has. The
 * `typeof === 'string'` filter inside transform handles the bad
 * element while keeping the rest of the file intact.
 *
 * Also dedupes — `areSettingsEqual` uses length-then-membership for
 * set-equality, which would false-positive if one side had duplicates
 * (e.g. a hand-edited settings.json with `["cursor","cursor"]` would
 * compare equal to a different 2-element list sharing one member). The
 * Set drop is cheap and keeps the equality contract honest.
 *
 * NOTE: this is the DISK schema. The IPC boundary uses a strict
 * `z.array(z.enum(AGENT_IDS))` — renderers should only ever emit valid
 * ids, and an invalid id at that layer is a bug rather than a schema-
 * evolution event.
 */
const HIDDEN_AGENT_IDS_SCHEMA = z
  .array(z.unknown())
  .transform((arr): AgentId[] => {
    const valid = arr.filter(
      (id): id is AgentId =>
        typeof id === 'string' && (AGENT_IDS as readonly string[]).includes(id),
    )
    return Array.from(new Set(valid))
  })
  .default([])

/**
 * App-wide user settings schema.
 *
 * - `defaultSkillTab`: right-pane tab on initial render of a skill detail.
 *   Both the Settings window's General section and the SkillDetail tab
 *   buttons read and write this — last-used tab becomes the default next
 *   time the app opens.
 * - `preferredTerminal`: which macOS terminal app the "Open in Terminal"
 *   action launches. `'custom'` defers to `customTerminalAppName`.
 * - `customTerminalAppName`: free-form macOS app name forwarded to
 *   `open -a <name>`. Trimmed and length-capped (1..64) at the schema
 *   boundary so a malformed value cannot reach `spawn`. Only consulted
 *   when `preferredTerminal === 'custom'`.
 * - `windowSize`: persisted startup window size. `undefined` means
 *   "use the app's launch default" (and lets the main process keep its
 *   prior `maximize()` behavior). When set, the main window opens at
 *   the saved size — clamped to the current display work area so a
 *   saved size from a wider monitor never opens off-screen on a smaller
 *   one.
 * - `windowBackgroundBlurRadius`: Electron 42 `View#setBackgroundBlur`
 *   radius for the main window. `0` disables the translucent surface and
 *   restores the opaque app background.
 * - `hiddenAgentIds`: agents the user has chosen to hide from the
 *   sidebar's installed list. Pure visibility toggle — the agent's
 *   skills folder, symlinks, and Marketplace presence are unaffected.
 *   Validated against `AGENT_IDS` so a stale id from a prior version
 *   (e.g. an agent removed upstream by `/cli-upgrade`) is silently
 *   dropped on parse rather than surfacing as a phantom hidden entry.
 * - `autoDownloadUpdates`: when `true`, `electron-updater` downloads a new
 *   release in the background as soon as it is detected. Default `false`
 *   preserves the app's manual confirm-via-UI flow (`src/main/updater.ts`
 *   keeps `autoUpdater.autoDownload` in sync with this field).
 *
 * Adding a field here requires widening `IPC_ARG_SCHEMAS['settings:set']`
 * in `src/main/ipc/ipc-schemas.ts` in lockstep — that schema is `.strict()`
 * so unknown keys are rejected at the IPC boundary (defense in depth).
 *
 * @example
 * SettingsSchema.parse({}) // { defaultSkillTab: 'files', preferredTerminal: 'terminal', windowBackgroundBlurRadius: 0, hiddenAgentIds: [], autoDownloadUpdates: false }
 */
export const SettingsSchema = z.object({
  defaultSkillTab: z.enum(['files', 'info']).default('files'),
  preferredTerminal: z.enum(TERMINAL_APP_IDS).default('terminal'),
  customTerminalAppName: z.string().trim().min(1).max(64).optional(),
  windowSize: windowSizeSchema,
  windowBackgroundBlurRadius: WINDOW_BACKGROUND_BLUR_RADIUS_SCHEMA.default(
    WINDOW_BACKGROUND_BLUR_MIN_RADIUS,
  ),
  hiddenAgentIds: HIDDEN_AGENT_IDS_SCHEMA,
  // Legacy auto-download preference. Defaults to false so the manual
  // confirm-via-UI download flow is preserved unless a persisted opt-in
  // already exists from an older version.
  autoDownloadUpdates: z.boolean().default(false),
})

/**
 * App-wide user settings persisted by the main process at
 * `app.getPath('userData')/settings.json`. Renderers cache this in
 * Redux but never write directly — see `src/main/services/settings.ts`
 * and the `settings:get` / `settings:set` IPC handlers.
 */
export type Settings = z.infer<typeof SettingsSchema>

/**
 * @description Partial settings payload accepted by the `settings:set` IPC write boundary.
 * @example { defaultSkillTab: 'info' }
 */
export type SettingsPatch = Partial<Settings>

/**
 * Default settings used when `settings.json` is missing or fails
 * Zod validation. Kept here (not derived from `.parse({})`) so the
 * defaults are visible to both main and renderer without instantiating
 * Zod at module-load time.
 */
export const DEFAULT_SETTINGS: Settings = {
  defaultSkillTab: 'files',
  preferredTerminal: 'terminal',
  windowBackgroundBlurRadius: WINDOW_BACKGROUND_BLUR_MIN_RADIUS,
  hiddenAgentIds: [],
  autoDownloadUpdates: false,
}
