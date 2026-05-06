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
 * Structural equality for `Settings`. Primitives compare by value;
 * `windowSize` (the only nested field) compares by `width` + `height`
 * because Zod's `.parse()` always materializes a fresh object reference.
 *
 * Iterates the **union** of keys from both inputs so an asymmetric
 * shape (e.g. `a` lacks the `windowSize` key entirely while `b` has it
 * defined) is detected rather than swallowed — `Object.keys(a)` alone
 * would skip keys that exist only on `b`.
 *
 * Adding another nested field requires a parallel branch here — there's
 * no recursive deep-equal because the schema is intentionally narrow.
 * @param a - First settings snapshot
 * @param b - Second settings snapshot
 * @returns
 * - `true` when every field is structurally equal
 * - `false` otherwise
 * @example
 * areSettingsEqual({ defaultSkillTab: 'files', preferredTerminal: 'terminal' }, { defaultSkillTab: 'files', preferredTerminal: 'terminal' }) // => true
 */
export function areSettingsEqual(a: Settings, b: Settings): boolean {
  const allKeys = new Set<keyof Settings>([
    ...(Object.keys(a) as Array<keyof Settings>),
    ...(Object.keys(b) as Array<keyof Settings>),
  ])
  for (const key of allKeys) {
    if (key === 'windowSize') {
      const aw = a.windowSize
      const bw = b.windowSize
      if (aw === bw) continue
      if (aw === undefined || bw === undefined) return false
      if (aw.width !== bw.width || aw.height !== bw.height) return false
      continue
    }
    if (key === 'hiddenAgentIds') {
      // Renderer treats the array as a set — so does the equality check.
      // Without a set comparison, an order-only drift between disk and
      // renderer (e.g. JSON load order ≠ optimistic-update order) would
      // trigger a redundant disk write + `settings:changed` broadcast on
      // every settings:set roundtrip. Length-then-membership is enough
      // for the small N (~44 max).
      const ah = a.hiddenAgentIds
      const bh = b.hiddenAgentIds
      if (ah.length !== bh.length) return false
      const bSet = new Set<string>(bh)
      for (const id of ah) {
        if (!bSet.has(id)) return false
      }
      continue
    }
    if (a[key] !== b[key]) return false
  }
  return true
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
  // No-op guard: when nothing actually changed (e.g. tapping the
  // already-active radio, or clicking "Use current window size" twice
  // at the same dimensions), short-circuit before disk write so
  // `ipc/settings.ts` can also skip the broadcast — no fan-out, no
  // redundant Redux replace in every open window.
  //
  // `windowSize` needs structural equality because Zod's `.parse()`
  // always returns a fresh object, so `merged.windowSize === current.windowSize`
  // would always be `false` for any defined value — even when both
  // sides describe identical dimensions. Other fields are primitives
  // and compare by value via `===`.
  if (areSettingsEqual(merged, current)) return current
  const target = settingsFilePath()
  const tempPath = `${target}.tmp`
  // Ensure userData dir exists — first run on a fresh profile may lack it.
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  await fs.writeFile(tempPath, JSON.stringify(merged, null, 2), 'utf8')
  await fs.rename(tempPath, target)
  cache = merged
  return merged
}
