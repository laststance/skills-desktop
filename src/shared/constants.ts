/**
 * Key used by `@laststance/redux-storage-middleware` to persist + rehydrate
 * Redux state in `localStorage`. Duplicated as a literal string in
 * `src/renderer/index.html` because the pre-hydration bootstrap script runs
 * before the bundle loads and cannot import modules.
 * `src/renderer/src/bootstrap.test.ts` guards `PERSIST_STORAGE_KEY` and
 * `COLOR_PRESET_CHROMA` against drift between this module and the inline
 * IIFE — rename or retune either and the test fails.
 * @example localStorage.getItem(PERSIST_STORAGE_KEY)
 */
export const PERSIST_STORAGE_KEY = 'skills-desktop-state'

/**
 * Current persisted-state schema version. Bumping this triggers
 * `migrateState` in `src/renderer/src/redux/migrations.ts` for users whose
 * stored payload carries an older version. Must stay in lockstep with the
 * `version` option passed to `createStorageMiddleware` in `store.ts`.
 *
 * History:
 *  - v0 → v1: theme `{presetType,chroma}` collapsed to a single `chroma` scalar.
 *  - v1 → v2: dashboard widget `{w,h}` clamped upward when a widget's
 *    `minSize` grew (Quick Actions h: 2 → 3 with the row-height bump). Without
 *    this clamp, persisted layouts violate the new minSize and react-grid-layout
 *    silently re-clamps them mid-render, jolting saved positions.
 */
export const PERSIST_STATE_VERSION = 2

/**
 * Chroma value applied to OKLCH tokens for fully-saturated (color) presets.
 * `--theme-chroma: 0` collapses every surface to grayscale, reproducing the
 * shadcn "neutral" look without maintaining a parallel HSL block.
 *
 * Value chosen for sRGB safety: 0.16 at L=0.7 (the highest-L primary token)
 * keeps every hue in the 12-preset palette inside sRGB gamut on standard
 * monitors. Anything higher clips for amber/yellow/lime (~100°) and
 * cyan/sky/blue (~200-250°), forcing the browser to gamut-map and breaking
 * perceived hue fidelity. Display-P3 monitors (most Retina Macs) can handle
 * more, but we optimize for the lowest-common display.
 *
 * @example
 * oklch(0.7 var(--theme-chroma) var(--theme-hue)) // primary accent
 */
export const COLOR_PRESET_CHROMA = 0.16

/**
 * Theme preset definitions. Each entry drives a single row in the
 * ThemeSelector and provides the three values Redux needs to compute
 * `--theme-hue` / `--theme-chroma` on `<html>`:
 *  - `hue`     : OKLCH hue angle (0–360). Meaningless when `chroma === 0`.
 *  - `chroma`  : `0` for neutral ramps, `COLOR_PRESET_CHROMA` for color ramps.
 *  - `mode`    : Present only on neutral presets where dark/light is baked in;
 *                omitted for color presets so `toggleMode` can flip freely.
 *  - `label`   : UI title (sentence-cased).
 * The 12 color hues stay in sync with skills.sh ThemePalette; neutral entries
 * keep their `neutral-dark` / `neutral-light` keys so persisted state from
 * older app versions migrates without renaming.
 */
export const THEME_PRESETS = {
  rose: { hue: 350, chroma: COLOR_PRESET_CHROMA, label: 'Rose' },
  orange: { hue: 45, chroma: COLOR_PRESET_CHROMA, label: 'Orange' },
  amber: { hue: 70, chroma: COLOR_PRESET_CHROMA, label: 'Amber' },
  yellow: { hue: 95, chroma: COLOR_PRESET_CHROMA, label: 'Yellow' },
  lime: { hue: 125, chroma: COLOR_PRESET_CHROMA, label: 'Lime' },
  green: { hue: 145, chroma: COLOR_PRESET_CHROMA, label: 'Green' },
  teal: { hue: 175, chroma: COLOR_PRESET_CHROMA, label: 'Teal' },
  cyan: { hue: 195, chroma: COLOR_PRESET_CHROMA, label: 'Cyan' },
  sky: { hue: 220, chroma: COLOR_PRESET_CHROMA, label: 'Sky' },
  blue: { hue: 250, chroma: COLOR_PRESET_CHROMA, label: 'Blue' },
  indigo: { hue: 275, chroma: COLOR_PRESET_CHROMA, label: 'Indigo' },
  violet: { hue: 300, chroma: COLOR_PRESET_CHROMA, label: 'Violet' },
  'neutral-dark': {
    hue: 0,
    chroma: 0,
    mode: 'dark' as const,
    label: 'Neutral Dark',
  },
  'neutral-light': {
    hue: 0,
    chroma: 0,
    mode: 'light' as const,
    label: 'Neutral Light',
  },
} as const

/**
 * Agent definitions synced with vercel-labs/skills CLI
 * Source: https://github.com/vercel-labs/skills/blob/main/src/agents.ts
 *
 * - `id`: Internal ID used in this app (used for state, checkbox values)
 * - `cliId`: Skills CLI agent identifier (used for --agent flag)
 * - `name`: Display name shown in UI
 * - `dir`: Home directory subdirectory for skills
 *
 * When id !== cliId, the skillsCliService maps id → cliId for CLI commands
 */
export const AGENT_DEFINITIONS = [
  // Agents supported by skills CLI (synced from agents.ts)
  {
    id: 'claude-code',
    cliId: 'claude-code',
    name: 'Claude Code',
    dir: '.claude',
  },
  { id: 'cursor', cliId: 'cursor', name: 'Cursor', dir: '.cursor' },
  { id: 'codex', cliId: 'codex', name: 'Codex', dir: '.codex' },
  { id: 'gemini-cli', cliId: 'gemini-cli', name: 'Gemini CLI', dir: '.gemini' },
  { id: 'opencode', cliId: 'opencode', name: 'OpenCode', dir: '.opencode' },
  {
    id: 'github-copilot',
    cliId: 'github-copilot',
    name: 'GitHub Copilot',
    dir: '.copilot',
  },
  { id: 'cline', cliId: 'cline', name: 'Cline', dir: '.cline' },
  { id: 'roo', cliId: 'roo', name: 'Roo Code', dir: '.roo' },
  { id: 'amp', cliId: 'amp', name: 'Amp', dir: '.config/amp' },
  { id: 'goose', cliId: 'goose', name: 'Goose', dir: '.config/goose' },
  {
    id: 'windsurf',
    cliId: 'windsurf',
    name: 'Windsurf',
    dir: '.codeium/windsurf',
  },
  { id: 'continue', cliId: 'continue', name: 'Continue', dir: '.continue' },
  { id: 'trae', cliId: 'trae', name: 'Trae', dir: '.trae' },
  { id: 'junie', cliId: 'junie', name: 'Junie', dir: '.junie' },
  { id: 'kilo', cliId: 'kilo', name: 'Kilo Code', dir: '.kilocode' },
  { id: 'openhands', cliId: 'openhands', name: 'OpenHands', dir: '.openhands' },
  { id: 'neovate', cliId: 'neovate', name: 'Neovate', dir: '.neovate' },
  { id: 'qoder', cliId: 'qoder', name: 'Qoder', dir: '.qoder' },
  { id: 'zencoder', cliId: 'zencoder', name: 'Zencoder', dir: '.zencoder' },
  { id: 'pochi', cliId: 'pochi', name: 'Pochi', dir: '.pochi' },
  { id: 'adal', cliId: 'adal', name: 'AdaL', dir: '.adal' },
  { id: 'kimi-cli', cliId: 'kimi-cli', name: 'Kimi Code CLI', dir: '.kimi' },
  // New agents synced from Skills CLI v1.4.7
  { id: 'bob', cliId: 'bob', name: 'IBM Bob', dir: '.bob' },
  {
    id: 'firebender',
    cliId: 'firebender',
    name: 'Firebender',
    dir: '.firebender',
  },
  {
    id: 'antigravity',
    cliId: 'antigravity',
    name: 'Antigravity',
    dir: '.gemini/antigravity',
  },
  { id: 'augment', cliId: 'augment', name: 'Augment', dir: '.augment' },
  { id: 'codebuddy', cliId: 'codebuddy', name: 'CodeBuddy', dir: '.codebuddy' },
  {
    id: 'command-code',
    cliId: 'command-code',
    name: 'Command Code',
    dir: '.commandcode',
  },
  {
    id: 'cortex',
    cliId: 'cortex',
    name: 'Cortex Code',
    dir: '.snowflake/cortex',
  },
  { id: 'crush', cliId: 'crush', name: 'Crush', dir: '.config/crush' },
  {
    id: 'deepagents',
    cliId: 'deepagents',
    name: 'Deep Agents',
    dir: '.deepagents',
  },
  { id: 'droid', cliId: 'droid', name: 'Droid', dir: '.factory' },
  { id: 'iflow-cli', cliId: 'iflow-cli', name: 'iFlow CLI', dir: '.iflow' },
  { id: 'kiro-cli', cliId: 'kiro-cli', name: 'Kiro CLI', dir: '.kiro' },
  { id: 'kode', cliId: 'kode', name: 'Kode', dir: '.kode' },
  { id: 'mcpjam', cliId: 'mcpjam', name: 'MCPJam', dir: '.mcpjam' },
  {
    id: 'mistral-vibe',
    cliId: 'mistral-vibe',
    name: 'Mistral Vibe',
    dir: '.vibe',
  },
  { id: 'mux', cliId: 'mux', name: 'Mux', dir: '.mux' },
  { id: 'openclaw', cliId: 'openclaw', name: 'OpenClaw', dir: '.openclaw' },
  { id: 'pi', cliId: 'pi', name: 'Pi', dir: '.pi/agent' },
  { id: 'qwen-code', cliId: 'qwen-code', name: 'Qwen Code', dir: '.qwen' },
  { id: 'replit', cliId: 'replit', name: 'Replit', dir: '.replit' },
  { id: 'trae-cn', cliId: 'trae-cn', name: 'Trae CN', dir: '.trae-cn' },
  { id: 'warp', cliId: 'warp', name: 'Warp', dir: '.warp' },
] as const

/**
 * Any valid theme preset name — 12 OKLCH color hues + 2 neutral variants.
 * Derived from `THEME_PRESETS` so new presets only need to be added in one
 * place; Redux reducers, selectors, and the ThemeSelector all pick up the
 * widened union automatically.
 * @example 'cyan', 'rose', 'neutral-dark'
 */
export type ThemePresetName = keyof typeof THEME_PRESETS

/**
 * Agent IDs used in app state and IPC.
 * Derived from AGENT_DEFINITIONS to stay in sync with skills CLI.
 */
export type AgentId = (typeof AGENT_DEFINITIONS)[number]['id']

/**
 * Agent display names shown in UI.
 * Derived from AGENT_DEFINITIONS to avoid manual union maintenance.
 */
export type AgentName = (typeof AGENT_DEFINITIONS)[number]['name']

/**
 * Agent IDs that use ~/.agents/skills/ directly (no symlinks needed).
 * Derived from skills CLI: agents where skillsDir === '.agents/skills'
 * and showInUniversalList !== false.
 * Source: https://github.com/vercel-labs/skills/blob/main/src/agents.ts
 *
 * @example
 * UNIVERSAL_AGENT_IDS // => ['amp', 'codex', 'gemini-cli', 'github-copilot', 'kimi-cli', 'opencode']
 */
export const UNIVERSAL_AGENT_IDS = [
  'amp',
  'antigravity',
  'cline',
  'codex',
  'cursor',
  'deepagents',
  'firebender',
  'gemini-cli',
  'github-copilot',
  'kimi-cli',
  'opencode',
  'warp',
] as const satisfies readonly AgentId[]

/**
 * Pinned `vercel-labs/skills` CLI version used by the main-process
 * `skillsCliService` when spawning `npx skills@<version> ...`. Kept in the
 * shared module so the `/cli-upgrade` maintenance skill has a single place
 * to bump alongside `AGENT_DEFINITIONS`. Consumers must template this into
 * their spawn args rather than hard-coding a version string — drift here
 * would silently run a stale CLI against up-to-date agent definitions.
 * @example
 * spawn('npx', [`skills@${SKILLS_CLI_VERSION}`, 'find', 'react'])
 */
export const SKILLS_CLI_VERSION = '1.5.1'

/**
 * Undo window for bulk skill deletes (ms). The trashService tombstone TTL and
 * the renderer undo-toast duration must stay in lockstep — if the on-disk
 * tombstone expires before the toast, a user's "undo" click races an empty
 * trash directory. Keep both sides importing from this single constant.
 */
export const UNDO_WINDOW_MS = 15_000

/**
 * Batch size at which bulk ops surface a live per-item progress counter in the
 * toolbar. Below this, the final `.fulfilled` toast is a better UX than a
 * flashing "k of n". Main-process `emitProgress` and renderer-side display
 * gate must read the same threshold.
 */
export const BULK_PROGRESS_THRESHOLD = 10
