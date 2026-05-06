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
 * NOTE: this is the DISK schema. The IPC boundary uses a strict
 * `z.array(z.enum(AGENT_IDS))` — renderers should only ever emit valid
 * ids, and an invalid id at that layer is a bug rather than a schema-
 * evolution event.
 */
const HIDDEN_AGENT_IDS_SCHEMA = z
  .array(z.string())
  .transform((arr): AgentId[] =>
    arr.filter((id): id is AgentId =>
      (AGENT_IDS as readonly string[]).includes(id),
    ),
  )
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
 * - `hiddenAgentIds`: agents the user has chosen to hide from the
 *   sidebar's installed list. Pure visibility toggle — the agent's
 *   skills folder, symlinks, and Marketplace presence are unaffected.
 *   Validated against `AGENT_IDS` so a stale id from a prior version
 *   (e.g. an agent removed upstream by `/cli-upgrade`) is silently
 *   dropped on parse rather than surfacing as a phantom hidden entry.
 *
 * Adding a field here requires widening `IPC_ARG_SCHEMAS['settings:set']`
 * in `src/main/ipc/ipc-schemas.ts` in lockstep — that schema is `.strict()`
 * so unknown keys are rejected at the IPC boundary (defense in depth).
 *
 * @example
 * SettingsSchema.parse({}) // { defaultSkillTab: 'files', preferredTerminal: 'terminal', hiddenAgentIds: [] }
 */
export const SettingsSchema = z.object({
  defaultSkillTab: z.enum(['files', 'info']).default('files'),
  preferredTerminal: z.enum(TERMINAL_APP_IDS).default('terminal'),
  customTerminalAppName: z.string().trim().min(1).max(64).optional(),
  windowSize: windowSizeSchema,
  hiddenAgentIds: HIDDEN_AGENT_IDS_SCHEMA,
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
  hiddenAgentIds: [],
}
