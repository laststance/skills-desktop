import { promises as fs } from 'fs'
import { join } from 'path'

import { app } from 'electron'

import {
  DEFAULT_SETTINGS,
  SettingsSchema,
  type Settings,
} from '@/shared/settings'

/**
 * In-memory cache of settings. Populated by `loadSettings()` at app
 * boot and re-populated on every `saveSettings()`. Renderers receive a
 * snapshot via `settings:get` and a stream of updates via the
 * `settings:changed` broadcast event — they never read this file
 * directly.
 */
let cache: Settings | null = null

/**
 * Resolves the on-disk path for `settings.json`. Lazy because
 * `app.getPath('userData')` is only valid after `app.whenReady()`; calling
 * this at module-load time crashes Electron in tests.
 * @returns Absolute path to the settings file
 * @example
 * settingsFilePath() // => '/Users/me/Library/Application Support/skills-desktop/settings.json'
 */
function settingsFilePath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

/**
 * Reads `settings.json` from disk and validates it with Zod. On any
 * failure (missing file, malformed JSON, schema mismatch) the defaults
 * are returned — settings are non-critical, never block startup, and
 * the next `saveSettings()` will write a clean file.
 * @returns Validated settings (or defaults on any error)
 * @example
 * await loadSettings() // => { defaultSkillTab: 'files' }
 */
export async function loadSettings(): Promise<Settings> {
  try {
    const raw = await fs.readFile(settingsFilePath(), 'utf8')
    const parsed = JSON.parse(raw)
    const validated = SettingsSchema.parse(parsed)
    cache = validated
    return validated
  } catch (err) {
    // ENOENT (first launch) is expected; other errors get logged so
    // a corrupt file is visible in the dev console without blocking.
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      console.warn('[settings] failed to load, using defaults:', err)
    }
    cache = { ...DEFAULT_SETTINGS }
    return cache
  }
}

/**
 * Returns the in-memory settings snapshot. Lazy-loads on first call so
 * IPC handlers can `getSettings()` without awaiting.
 * @returns The cached settings (or defaults if `loadSettings` was never called)
 * @example
 * getSettings() // => { defaultSkillTab: 'files' }
 */
export function getSettings(): Settings {
  if (cache === null) {
    cache = { ...DEFAULT_SETTINGS }
  }
  return cache
}

/**
 * Merges `partial` over the current settings and writes the result
 * atomically (temp file + rename) so a crash mid-write cannot corrupt
 * the file. The merged value is validated with Zod before disk write —
 * an invalid `partial` rejects the whole call.
 * @param partial - Subset of fields to overwrite
 * @returns
 * - On success: the new full Settings object (also updates the cache)
 * - On Zod failure: throws — caller should surface the message
 * @example
 * await saveSettings({ defaultSkillTab: 'info' })
 * // => { defaultSkillTab: 'info' }
 */
export async function saveSettings(
  partial: Partial<Settings>,
): Promise<Settings> {
  const current = getSettings()
  const merged = SettingsSchema.parse({ ...current, ...partial })
  // Shallow-compare guard: when nothing actually changed (e.g. tapping
  // the already-active radio), short-circuit before disk write so
  // `ipc/settings.ts` can also skip the broadcast — no fan-out, no
  // redundant Redux replace in every open window. Safe today because
  // `Settings` is a flat object; revisit if a nested field lands.
  const isUnchanged = (Object.keys(merged) as Array<keyof Settings>).every(
    (key) => merged[key] === current[key],
  )
  if (isUnchanged) return current
  const target = settingsFilePath()
  const tempPath = `${target}.tmp`
  // Ensure userData dir exists — first run on a fresh profile may lack it.
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  await fs.writeFile(tempPath, JSON.stringify(merged, null, 2), 'utf8')
  await fs.rename(tempPath, target)
  cache = merged
  return merged
}
