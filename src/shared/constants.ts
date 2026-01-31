/**
 * Status colors matching design system
 */
export const STATUS_COLORS = {
  valid: '#22D3EE', // Cyan
  broken: '#F59E0B', // Amber
  missing: '#475569', // Gray
} as const

/**
 * Base hues for 12 color theme presets (OKLCH)
 */
export const THEME_HUES = {
  rose: 350,
  orange: 45,
  amber: 70,
  yellow: 95,
  lime: 125,
  green: 145,
  teal: 175,
  cyan: 195,
  sky: 220,
  blue: 250,
  indigo: 275,
  violet: 300,
} as const

/**
 * Theme preset types
 * - 'color': Uses OKLCH dynamic colors with hue
 * - 'neutral': shadcn/ui default neutral palette
 */
export type ThemePresetType = 'color' | 'neutral'

/**
 * All available theme presets
 * Includes 12 color hues + 2 neutral (shadcn defaults)
 */
export const THEME_PRESETS = {
  // Color themes (OKLCH hue-based)
  ...Object.fromEntries(
    Object.entries(THEME_HUES).map(([name, hue]) => [
      name,
      {
        type: 'color' as const,
        hue,
        label: name.charAt(0).toUpperCase() + name.slice(1),
      },
    ]),
  ),
  // Neutral themes (shadcn/ui defaults)
  'neutral-dark': {
    type: 'neutral' as const,
    mode: 'dark' as const,
    label: 'Neutral Dark',
  },
  'neutral-light': {
    type: 'neutral' as const,
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
] as const
