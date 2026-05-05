import { z } from 'zod'

import { TERMINAL_APP_IDS } from './constants'

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
 *
 * Adding a field here requires widening `IPC_ARG_SCHEMAS['settings:set']`
 * in `src/main/ipc/ipc-schemas.ts` in lockstep — that schema is `.strict()`
 * so unknown keys are rejected at the IPC boundary (defense in depth).
 *
 * @example
 * SettingsSchema.parse({}) // { defaultSkillTab: 'files', preferredTerminal: 'terminal' }
 */
export const SettingsSchema = z.object({
  defaultSkillTab: z.enum(['files', 'info']).default('files'),
  preferredTerminal: z.enum(TERMINAL_APP_IDS).default('terminal'),
  customTerminalAppName: z.string().trim().min(1).max(64).optional(),
  windowSize: windowSizeSchema,
})

/**
 * App-wide user settings persisted by the main process at
 * `app.getPath('userData')/settings.json`. Renderers cache this in
 * Redux but never write directly — see `src/main/services/settings.ts`
 * and the `settings:get` / `settings:set` IPC handlers.
 */
export type Settings = z.infer<typeof SettingsSchema>

/**
 * Default settings used when `settings.json` is missing or fails
 * Zod validation. Kept here (not derived from `.parse({})`) so the
 * defaults are visible to both main and renderer without instantiating
 * Zod at module-load time.
 */
export const DEFAULT_SETTINGS: Settings = {
  defaultSkillTab: 'files',
  preferredTerminal: 'terminal',
}
