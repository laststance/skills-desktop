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
 * Chroma scalar for "tinted neutral" presets — the shadcn-baseColor
 * lookalikes (zinc / slate / stone / mauve). Sits between pure neutral
 * (chroma=0) and full color (chroma=COLOR_PRESET_CHROMA=0.16) so the tint
 * is perceptible on the saturated tokens (primary/accent/ring at L=0.7)
 * while backgrounds (L=0.12) collapse to a near-grey that lines up with
 * shadcn's published baseColor swatches.
 *
 * Value rationale: 0.05 × the smallest --chroma-N step (--chroma-5 = 0.111)
 * lands at ~0.0055 — within rounding distance of shadcn's official zinc
 * baseColor `oklch(0.141 0.005 285.823)`. At L=0.7 (primary), the same
 * 0.05 reads as "subtly tinted gray," not "saturated color," matching
 * shadcn's design contract for baseColor.
 *
 * Why not larger: any value above ~0.08 reintroduces the "is this teal or
 * zinc?" ambiguity that the tinted-vs-color distinction exists to prevent.
 * Why not smaller: below ~0.03 the four hue families collapse to visually
 * indistinguishable grayscale and the swatches become meaningless filler.
 *
 * Note for users picking the `red` color preset: the destructive token
 * still uses its own theme-invariant red (`oklch(0.55 0.2 25)`), so an
 * error button next to a red CTA loses some affordance. That's a deliberate
 * trade-off — keeping destructive theme-invariant matters more than
 * preventing this one collision.
 *
 * @example
 * oklch(0.7 var(--theme-chroma) var(--theme-hue)) // primary, with --theme-chroma=0.05
 */
export const TINTED_NEUTRAL_CHROMA = 0.05

/**
 * Theme preset definitions. Each entry drives a single row in the
 * ThemeSelector and provides the three values Redux needs to compute
 * `--theme-hue` / `--theme-chroma` on `<html>`:
 *  - `hue`     : OKLCH hue angle (0–360). Meaningless when `chroma === 0`.
 *  - `chroma`  : `0` (pure neutral), `TINTED_NEUTRAL_CHROMA` (shadcn-style
 *                baseColor tint), or `COLOR_PRESET_CHROMA` (full color).
 *  - `mode`    : Present only on neutral / tinted-neutral presets where
 *                dark/light is baked in; omitted for color presets so
 *                `toggleMode` can flip freely.
 *  - `label`   : UI title (sentence-cased).
 *
 * The color hues stay roughly in sync with skills.sh ThemePalette plus the
 * shadcn extras (pink / red / emerald / fuchsia / magenta) that fill the
 * larger gaps in the original 12-hue ring. Tinted neutral entries are
 * explicit dark/light pairs because shadcn's baseColors have hand-tuned
 * chroma-per-mode in their published palette (we approximate with one
 * shared chroma + the L value baked into globals.css).
 *
 * Neutral entries keep their `neutral-dark` / `neutral-light` keys so
 * persisted state from older app versions migrates without renaming.
 */
export const THEME_PRESETS = {
  // ── Color presets (light/dark agnostic, full chroma) ──
  // Hues are spaced ~15-30° apart to stay perceptually distinct in OKLCH.
  // Order = clockwise around the color wheel starting from rose.
  rose: { hue: 350, chroma: COLOR_PRESET_CHROMA, label: 'Rose' },
  pink: { hue: 15, chroma: COLOR_PRESET_CHROMA, label: 'Pink' },
  red: { hue: 25, chroma: COLOR_PRESET_CHROMA, label: 'Red' },
  orange: { hue: 45, chroma: COLOR_PRESET_CHROMA, label: 'Orange' },
  amber: { hue: 70, chroma: COLOR_PRESET_CHROMA, label: 'Amber' },
  yellow: { hue: 95, chroma: COLOR_PRESET_CHROMA, label: 'Yellow' },
  lime: { hue: 125, chroma: COLOR_PRESET_CHROMA, label: 'Lime' },
  green: { hue: 145, chroma: COLOR_PRESET_CHROMA, label: 'Green' },
  emerald: { hue: 160, chroma: COLOR_PRESET_CHROMA, label: 'Emerald' },
  teal: { hue: 175, chroma: COLOR_PRESET_CHROMA, label: 'Teal' },
  cyan: { hue: 195, chroma: COLOR_PRESET_CHROMA, label: 'Cyan' },
  sky: { hue: 220, chroma: COLOR_PRESET_CHROMA, label: 'Sky' },
  blue: { hue: 250, chroma: COLOR_PRESET_CHROMA, label: 'Blue' },
  indigo: { hue: 275, chroma: COLOR_PRESET_CHROMA, label: 'Indigo' },
  violet: { hue: 300, chroma: COLOR_PRESET_CHROMA, label: 'Violet' },
  fuchsia: { hue: 325, chroma: COLOR_PRESET_CHROMA, label: 'Fuchsia' },
  magenta: { hue: 340, chroma: COLOR_PRESET_CHROMA, label: 'Magenta' },

  // ── Pure neutral (shadcn default, no tint) ──
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

  // ── Tinted neutral (shadcn baseColor lookalikes) ──
  // Hue values picked to match the published shadcn baseColor swatches:
  //   zinc  → cool purple-gray (around 265°, matches `oklch(0.141 0.005 285.823)`)
  //   slate → blue-gray
  //   stone → warm sand-gray
  //   mauve → purple-pink-gray
  // All share TINTED_NEUTRAL_CHROMA so the four families form a coherent
  // tier between pure neutral and full color.
  'zinc-dark': {
    hue: 265,
    chroma: TINTED_NEUTRAL_CHROMA,
    mode: 'dark' as const,
    label: 'Zinc Dark',
  },
  'zinc-light': {
    hue: 265,
    chroma: TINTED_NEUTRAL_CHROMA,
    mode: 'light' as const,
    label: 'Zinc Light',
  },
  'slate-dark': {
    hue: 240,
    chroma: TINTED_NEUTRAL_CHROMA,
    mode: 'dark' as const,
    label: 'Slate Dark',
  },
  'slate-light': {
    hue: 240,
    chroma: TINTED_NEUTRAL_CHROMA,
    mode: 'light' as const,
    label: 'Slate Light',
  },
  'stone-dark': {
    hue: 60,
    chroma: TINTED_NEUTRAL_CHROMA,
    mode: 'dark' as const,
    label: 'Stone Dark',
  },
  'stone-light': {
    hue: 60,
    chroma: TINTED_NEUTRAL_CHROMA,
    mode: 'light' as const,
    label: 'Stone Light',
  },
  'mauve-dark': {
    hue: 320,
    chroma: TINTED_NEUTRAL_CHROMA,
    mode: 'dark' as const,
    label: 'Mauve Dark',
  },
  'mauve-light': {
    hue: 320,
    chroma: TINTED_NEUTRAL_CHROMA,
    mode: 'light' as const,
    label: 'Mauve Light',
  },
} as const

/**
 * Agent definitions synced with vercel-labs/skills CLI
 * Source: https://github.com/vercel-labs/skills/blob/main/src/agents.ts
 *
 * - `id`: Internal ID used in this app (used for state, checkbox values)
 * - `cliId`: Skills CLI agent identifier (used for --agent flag)
 * - `name`: Display name shown in UI
 * - `installDir`: Home subdir where the CLI installs skills globally for
 *   this agent. Mirrors the parent of the CLI's `globalSkillsDir`. Used by
 *   `/cli-upgrade` to detect upstream divergence.
 * - `scanDir`: Home subdir this app scans for the agent's OWN symlinks.
 *   Equals `installDir` for most agents. Diverges for agents whose
 *   `globalSkillsDir` resolves to the universal source `~/.agents/skills`
 *   (Cline, Warp): if `scanDir` aliased the source, the scanner would
 *   surface every source skill as a "valid local skill" of those agents
 *   (the v0.13.0 regression). Required on every entry so `/cli-upgrade`
 *   must consider it for new agents — no silent fallback.
 *
 * When id !== cliId, the skillsCliService maps id → cliId for CLI commands
 */
export const AGENT_DEFINITIONS = [
  // Agents supported by skills CLI (synced from agents.ts)
  {
    id: 'claude-code',
    cliId: 'claude-code',
    name: 'Claude Code',
    installDir: '.claude',
    scanDir: '.claude',
  },
  {
    id: 'cursor',
    cliId: 'cursor',
    name: 'Cursor',
    installDir: '.cursor',
    scanDir: '.cursor',
  },
  {
    id: 'codex',
    cliId: 'codex',
    name: 'Codex',
    installDir: '.codex',
    scanDir: '.codex',
  },
  {
    id: 'gemini-cli',
    cliId: 'gemini-cli',
    name: 'Gemini CLI',
    installDir: '.gemini',
    scanDir: '.gemini',
  },
  {
    id: 'opencode',
    cliId: 'opencode',
    name: 'OpenCode',
    installDir: '.config/opencode',
    scanDir: '.config/opencode',
  },
  {
    id: 'github-copilot',
    cliId: 'github-copilot',
    name: 'GitHub Copilot',
    installDir: '.copilot',
    scanDir: '.copilot',
  },
  {
    id: 'cline',
    cliId: 'cline',
    name: 'Cline',
    installDir: '.agents',
    scanDir: '.cline',
  },
  {
    id: 'roo',
    cliId: 'roo',
    name: 'Roo Code',
    installDir: '.roo',
    scanDir: '.roo',
  },
  {
    id: 'amp',
    cliId: 'amp',
    name: 'Amp',
    installDir: '.config/agents',
    scanDir: '.config/agents',
  },
  {
    id: 'goose',
    cliId: 'goose',
    name: 'Goose',
    installDir: '.config/goose',
    scanDir: '.config/goose',
  },
  {
    id: 'windsurf',
    cliId: 'windsurf',
    name: 'Windsurf',
    installDir: '.codeium/windsurf',
    scanDir: '.codeium/windsurf',
  },
  {
    id: 'continue',
    cliId: 'continue',
    name: 'Continue',
    installDir: '.continue',
    scanDir: '.continue',
  },
  {
    id: 'trae',
    cliId: 'trae',
    name: 'Trae',
    installDir: '.trae',
    scanDir: '.trae',
  },
  {
    id: 'junie',
    cliId: 'junie',
    name: 'Junie',
    installDir: '.junie',
    scanDir: '.junie',
  },
  {
    id: 'kilo',
    cliId: 'kilo',
    name: 'Kilo Code',
    installDir: '.kilocode',
    scanDir: '.kilocode',
  },
  {
    id: 'openhands',
    cliId: 'openhands',
    name: 'OpenHands',
    installDir: '.openhands',
    scanDir: '.openhands',
  },
  {
    id: 'neovate',
    cliId: 'neovate',
    name: 'Neovate',
    installDir: '.neovate',
    scanDir: '.neovate',
  },
  {
    id: 'qoder',
    cliId: 'qoder',
    name: 'Qoder',
    installDir: '.qoder',
    scanDir: '.qoder',
  },
  {
    id: 'zencoder',
    cliId: 'zencoder',
    name: 'Zencoder',
    installDir: '.zencoder',
    scanDir: '.zencoder',
  },
  {
    id: 'pochi',
    cliId: 'pochi',
    name: 'Pochi',
    installDir: '.pochi',
    scanDir: '.pochi',
  },
  {
    id: 'adal',
    cliId: 'adal',
    name: 'AdaL',
    installDir: '.adal',
    scanDir: '.adal',
  },
  {
    id: 'kimi-cli',
    cliId: 'kimi-cli',
    name: 'Kimi Code CLI',
    installDir: '.config/agents',
    scanDir: '.config/agents',
  },
  // Additional agents synced through Skills CLI v1.5.1
  {
    id: 'bob',
    cliId: 'bob',
    name: 'IBM Bob',
    installDir: '.bob',
    scanDir: '.bob',
  },
  {
    id: 'firebender',
    cliId: 'firebender',
    name: 'Firebender',
    installDir: '.firebender',
    scanDir: '.firebender',
  },
  {
    id: 'antigravity',
    cliId: 'antigravity',
    name: 'Antigravity',
    installDir: '.gemini/antigravity',
    scanDir: '.gemini/antigravity',
  },
  {
    id: 'augment',
    cliId: 'augment',
    name: 'Augment',
    installDir: '.augment',
    scanDir: '.augment',
  },
  {
    id: 'codebuddy',
    cliId: 'codebuddy',
    name: 'CodeBuddy',
    installDir: '.codebuddy',
    scanDir: '.codebuddy',
  },
  {
    id: 'command-code',
    cliId: 'command-code',
    name: 'Command Code',
    installDir: '.commandcode',
    scanDir: '.commandcode',
  },
  {
    id: 'cortex',
    cliId: 'cortex',
    name: 'Cortex Code',
    installDir: '.snowflake/cortex',
    scanDir: '.snowflake/cortex',
  },
  {
    id: 'crush',
    cliId: 'crush',
    name: 'Crush',
    installDir: '.config/crush',
    scanDir: '.config/crush',
  },
  {
    id: 'deepagents',
    cliId: 'deepagents',
    name: 'Deep Agents',
    installDir: '.deepagents/agent',
    scanDir: '.deepagents/agent',
  },
  {
    id: 'droid',
    cliId: 'droid',
    name: 'Droid',
    installDir: '.factory',
    scanDir: '.factory',
  },
  {
    id: 'iflow-cli',
    cliId: 'iflow-cli',
    name: 'iFlow CLI',
    installDir: '.iflow',
    scanDir: '.iflow',
  },
  {
    id: 'kiro-cli',
    cliId: 'kiro-cli',
    name: 'Kiro CLI',
    installDir: '.kiro',
    scanDir: '.kiro',
  },
  {
    id: 'kode',
    cliId: 'kode',
    name: 'Kode',
    installDir: '.kode',
    scanDir: '.kode',
  },
  {
    id: 'mcpjam',
    cliId: 'mcpjam',
    name: 'MCPJam',
    installDir: '.mcpjam',
    scanDir: '.mcpjam',
  },
  {
    id: 'mistral-vibe',
    cliId: 'mistral-vibe',
    name: 'Mistral Vibe',
    installDir: '.vibe',
    scanDir: '.vibe',
  },
  {
    id: 'mux',
    cliId: 'mux',
    name: 'Mux',
    installDir: '.mux',
    scanDir: '.mux',
  },
  {
    id: 'openclaw',
    cliId: 'openclaw',
    name: 'OpenClaw',
    installDir: '.openclaw',
    scanDir: '.openclaw',
  },
  {
    id: 'pi',
    cliId: 'pi',
    name: 'Pi',
    installDir: '.pi/agent',
    scanDir: '.pi/agent',
  },
  {
    id: 'qwen-code',
    cliId: 'qwen-code',
    name: 'Qwen Code',
    installDir: '.qwen',
    scanDir: '.qwen',
  },
  {
    id: 'replit',
    cliId: 'replit',
    name: 'Replit',
    installDir: '.config/agents',
    scanDir: '.config/agents',
  },
  {
    id: 'trae-cn',
    cliId: 'trae-cn',
    name: 'Trae CN',
    installDir: '.trae-cn',
    scanDir: '.trae-cn',
  },
  {
    id: 'warp',
    cliId: 'warp',
    name: 'Warp',
    installDir: '.agents',
    scanDir: '.warp',
  },
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
 * Agent IDs where G-Stack-managed skills may appear in card-level UI.
 * Currently the team operates G-Stack primarily through Claude Code, with
 * Codex/Cursor included for forward compatibility.
 */
export const GSTACK_BADGE_AGENT_IDS = [
  'claude-code',
  'codex',
  'cursor',
] as const satisfies readonly AgentId[]

/**
 * Canonical GitHub repository URL for G-Stack.
 * Used by the skill-card badge link so users can jump to upstream docs.
 */
export const GSTACK_REPOSITORY_URL = 'https://github.com/garrytan/gstack'

/**
 * Canonical GitHub repository URL for Skills Desktop itself.
 * Used by the sidebar version link and the post-update "What's new" toast
 * to deep-link into the matching `/releases/tag/v<version>` page.
 */
export const SKILLS_DESKTOP_REPOSITORY_URL =
  'https://github.com/laststance/skills-desktop'

/**
 * localStorage key tracking the last app version the user was shown release
 * notes for. Read on mount; if it differs from the running version (and was
 * non-null), the post-update toast fires once and the key is updated.
 *
 * Why a string here rather than a Redux slice: this is a one-shot UI cue,
 * not a piece of app state — no other component reads or mutates it.
 */
export const RELEASE_NOTES_LAST_SEEN_VERSION_KEY =
  'skills-desktop:last-seen-version'

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
 * Canonical hostname for skills marketplace pages used by renderer/main
 * allowlist checks.
 * @example
 * new URL('https://skills.sh/trending').hostname === SKILLS_SH_HOSTNAME
 */
export const SKILLS_SH_HOSTNAME = 'skills.sh'

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

/**
 * Minimum tap-target size (px) for interactive elements. Floor set by both
 * Apple HIG (44×44 pt) and WCAG 2.2 AA (target size 24 CSS px minimum, 44
 * recommended) — keeping a single source of truth here means adding a new
 * pill / toggle / icon button can grep for the constant rather than
 * scatter `min-h-[44px]` arbitrary-values across components.
 *
 * Imported via inline `style={{ minHeight: MIN_TOUCH_TARGET_PX }}` rather
 * than a Tailwind arbitrary value because the constant is the contract;
 * the className is just a delivery mechanism.
 *
 * @example
 * <Button style={{ minHeight: MIN_TOUCH_TARGET_PX }}>Clear</Button>
 */
export const MIN_TOUCH_TARGET_PX = 44
