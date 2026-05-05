import { z } from 'zod'

import { TERMINAL_APP_IDS } from './constants'

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
