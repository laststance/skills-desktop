import { z } from 'zod'

/**
 * User setting for the right-pane skill detail tab. Both the Settings
 * window's General section and the SkillDetail tab buttons read and write
 * this same field — last-used tab becomes the default tab next time the
 * app opens.
 * @example 'files' → Files tab; 'info' → Info tab
 */
export const SettingsSchema = z.object({
  defaultSkillTab: z.enum(['files', 'info']).default('files'),
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
}
