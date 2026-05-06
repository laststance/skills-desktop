import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Relative path inside an isolated HOME where the e2e fixture redirects
 * Electron's `userData` directory via `E2E_USERDATA_DIR`. The override
 * lives in `src/main/index.ts` (top-level) and the fixture wires the env
 * var in `e2e/fixtures/electron-app.ts`. Both sides MUST agree on this
 * literal — if either drifts, tests silently read/write the wrong file.
 *
 * Why not the macOS-typical `Library/Application Support/skills-desktop`?
 * macOS's `app.getPath('userData')` uses `getpwuid(getuid())`, NOT
 * `$HOME`, so the conventional path doesn't help isolation. Picking a
 * dedicated `userData/` directory keeps the helper, fixture, and main-
 * process override all referring to the same simple subpath.
 */
const SETTINGS_RELATIVE = 'userData/settings.json'

/**
 * Resolves the on-disk path for `settings.json` inside an isolated test
 * HOME, matching the `E2E_USERDATA_DIR` override applied by the fixture
 * (and consumed by `src/main/index.ts`).
 * @param home - The isolated HOME directory created by the e2e fixture
 * @returns Absolute path to settings.json under the isolated profile
 * @example
 * settingsFilePath('/tmp/skills-desktop-e2e-home-X9z')
 * // => '/tmp/skills-desktop-e2e-home-X9z/userData/settings.json'
 */
export function settingsFilePath(home: string): string {
  return join(home, SETTINGS_RELATIVE)
}

/**
 * Reads `settings.json` from an isolated HOME. Returns `null` when the
 * file doesn't exist (first launch, before any user interaction). Parses
 * JSON eagerly — a malformed file throws at the call site so the test
 * author sees the exact JSON error instead of a downstream
 * `expect(...).toContain(...)` failure on `null`.
 * @param home - The isolated HOME directory
 * @returns
 * - The parsed JSON object when present
 * - `null` when settings.json doesn't exist yet
 * @example
 * const persisted = readSettingsFile(isolatedHome) as { hiddenAgentIds: string[] }
 * expect(persisted.hiddenAgentIds).toContain('cursor')
 */
export function readSettingsFile(home: string): unknown {
  const filePath = settingsFilePath(home)
  if (!existsSync(filePath)) return null
  return JSON.parse(readFileSync(filePath, 'utf8'))
}

/**
 * Writes `settings.json` to an isolated HOME, creating the
 * `Library/Application Support/skills-desktop` directory chain when it
 * doesn't already exist. Used by tests that need to pre-stage settings
 * before the app launches (e.g. round-tripping a hand-edited file with a
 * stale agent id to verify the disk schema's forgiveness).
 *
 * Accepts `Record<string, unknown>` rather than `Partial<Settings>`
 * because tests intentionally write invalid shapes (stale agent ids,
 * unknown fields) to verify the disk-side schema's `.transform` path —
 * narrowing the input type would block exactly the cases we need.
 * @param home - The isolated HOME directory
 * @param contents - The full JSON object to write (overwrites any existing file)
 * @example
 * writeSettingsFile(isolatedHome, {
 *   hiddenAgentIds: ['cursor', 'removed-agent-zzz'],
 *   defaultSkillTab: 'info',
 * })
 */
export function writeSettingsFile(
  home: string,
  contents: Record<string, unknown>,
): void {
  const filePath = settingsFilePath(home)
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(contents, null, 2), 'utf8')
}
