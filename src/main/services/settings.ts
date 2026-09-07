import { promises as fs } from 'fs'
import { join } from 'path'

import { app } from 'electron'
import { z } from 'zod'

import { errorCode } from '@/main/utils/errorCode'
import {
  LEGACY_WINDOW_BLUR_MAX_RADIUS_PX,
  LEGACY_WINDOW_OPACITY_MIN_PERCENT,
  WINDOW_OPACITY_MAX_PERCENT,
} from '@/shared/constants'
import {
  DEFAULT_SETTINGS,
  SettingsSchema,
  type Settings,
  type SettingsPatch,
} from '@/shared/settings'

/**
 * In-memory cache of settings. Populated by `loadSettings()` at app
 * boot and re-populated on every `saveSettings()`. Renderers receive a
 * snapshot via `settings:get` and a stream of updates via the
 * `settings:changed` broadcast event — they never read this file
 * directly.
 */
let cache: Settings | null = null

/** Serializes preference writes so overlapping IPC patches cannot share a stale cache or temp file. */
let settingsSaveQueue: Promise<void> = Promise.resolve()

/** Retry a failed migration even when the next patch matches the normalized cache. */
let needsMigrationWrite = false

// Accept only historically valid values; malformed data must not be silently coerced.
const legacyOpacitySchema = z
  .number()
  .int()
  .min(LEGACY_WINDOW_OPACITY_MIN_PERCENT)
  .max(WINDOW_OPACITY_MAX_PERCENT)
  .default(WINDOW_OPACITY_MAX_PERCENT)
const legacySettingsSchema = SettingsSchema.omit({
  windowBackgroundOpacityPercent: true,
}).extend({
  windowBackgroundBlurRadius: z
    .number()
    .int()
    .min(0)
    .max(LEGACY_WINDOW_BLUR_MAX_RADIUS_PX)
    .default(0),
  leftSectionOpacityPercent: legacyOpacitySchema,
  centerSectionOpacityPercent: legacyOpacitySchema,
  rightSectionOpacityPercent: legacyOpacitySchema,
})

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
 * Queues startup hydration before edits so {@link saveSettings} cannot overwrite an in-flight migration.
 * @returns Validated, migrated settings; defaults only when the source cannot be read or validated.
 * @example await loadSettings() // Loads preferences before creating any renderer window.
 */
export async function loadSettings(): Promise<Settings> {
  return queueSettingsUpdate(readPersistedSettings)
}

/**
 * Reads and upgrades disk preferences when {@link loadSettings} reaches the front of the write queue.
 * @returns The validated snapshot, preserving preferences even if its migration cannot be saved yet.
 * @example await readPersistedSettings() // Legacy radius 48 becomes 45%; section values are preserved.
 */
async function readPersistedSettings(): Promise<Settings> {
  let validated: Settings
  needsMigrationWrite = false
  try {
    const raw = await fs.readFile(settingsFilePath(), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    // The new field is the migration marker; a present modern value always wins.
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'windowBackgroundOpacityPercent' in parsed
    ) {
      validated = SettingsSchema.parse(parsed)
    } else {
      const { windowBackgroundBlurRadius, ...legacy } =
        legacySettingsSchema.parse(parsed)
      // Preserve the old background strength, including its two-decimal rounding.
      const oldOpacity = Number(
        (
          1 -
          (windowBackgroundBlurRadius / LEGACY_WINDOW_BLUR_MAX_RADIUS_PX) *
            (1 - LEGACY_WINDOW_OPACITY_MIN_PERCENT / WINDOW_OPACITY_MAX_PERCENT)
        ).toFixed(2),
      )
      validated = SettingsSchema.parse({
        ...legacy,
        windowBackgroundOpacityPercent: Math.round(
          oldOpacity * WINDOW_OPACITY_MAX_PERCENT,
        ),
      })
      needsMigrationWrite = true
    }
  } catch (err) {
    // ENOENT (first launch) is expected; other errors get logged so
    // a corrupt file is visible in the dev console without blocking.
    if (errorCode(err) !== 'ENOENT') {
      console.warn('[settings] failed to load, using defaults:', err)
    }
    cache = { ...DEFAULT_SETTINGS }
    return cache
  }

  // Read → validate/migrate → atomic write → cache; failed writes retain the valid session values.
  if (needsMigrationWrite) {
    try {
      await writeSettingsSnapshot(validated)
      // eslint-disable-next-line require-atomic-updates -- loadSettings and saveSettings run exclusively inside settingsSaveQueue.
      needsMigrationWrite = false
    } catch (err) {
      console.warn(
        '[settings] migration could not be saved; retrying on the next save or launch:',
        err,
      )
    }
  }
  cache = validated
  return validated
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
 * Queue IPC preference patches to merge and write atomically after earlier saves finish.
 * @param partial - Subset of fields to overwrite
 * @returns
 * - On success: the new full Settings object (also updates the cache)
 * - On Zod failure: throws — caller should surface the message
 * @example
 * await saveSettings({ defaultSkillTab: 'info' })
 * // => { defaultSkillTab: 'info' }
 */
export async function saveSettings(partial: SettingsPatch): Promise<Settings> {
  return queueSettingsUpdate(async () => persistSettingsPatch(partial))
}

/**
 * Serializes startup and edits for {@link loadSettings} and {@link saveSettings}, recovering after individual failures.
 * @returns This operation's result or rejection, without poisoning later queued operations.
 * @example queueSettingsUpdate(readPersistedSettings) // Later slider saves wait for migration.
 */
async function queueSettingsUpdate(
  update: () => Promise<Settings>,
): Promise<Settings> {
  const pendingSave = settingsSaveQueue.then(update)
  // Preserve this caller's rejection while allowing the next queued save to proceed.
  settingsSaveQueue = pendingSave.then(
    () => undefined,
    () => undefined,
  )
  return pendingSave
}

/**
 * Merge and persist one patch when saveSettings reaches it in the serialized write queue.
 * @param partial - Preference fields to merge into the latest successfully saved snapshot.
 * @returns Updated cached settings, or the same snapshot for a no-op; rejects on validation or disk failure.
 * @example await persistSettingsPatch({ leftSectionOpacityPercent: 85 }) // Saved Left opacity is 85%.
 */
async function persistSettingsPatch(partial: SettingsPatch): Promise<Settings> {
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
  if (areSettingsEqual(merged, current) && !needsMigrationWrite) return current
  await writeSettingsSnapshot(merged)
  // eslint-disable-next-line require-atomic-updates -- the complete read/merge/write/cache transaction is serialized by settingsSaveQueue.
  needsMigrationWrite = false
  cache = merged
  return merged
}

/**
 * Atomically replaces disk preferences for startup migration and {@link persistSettingsPatch} inside their shared queue.
 * @returns Resolves after rename; rejects without replacing the original file on write failure.
 * @example await writeSettingsSnapshot(settings) // A partial temporary file never becomes settings.json.
 */
async function writeSettingsSnapshot(settings: Settings): Promise<void> {
  const target = settingsFilePath()
  const tempPath = `${target}.tmp`
  // Ensure userData dir exists — first run on a fresh profile may lack it.
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  await fs.writeFile(tempPath, JSON.stringify(settings, null, 2), 'utf8')
  await fs.rename(tempPath, target)
}
