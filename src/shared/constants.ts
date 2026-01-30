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
 * Agent definitions (without paths - paths computed at runtime in main process)
 */
export const AGENT_DEFINITIONS = [
  { id: 'claude', name: 'Claude Code', dir: '.claude' },
  { id: 'cursor', name: 'Cursor', dir: '.cursor' },
  { id: 'codex', name: 'OpenAI Codex', dir: '.codex' },
  { id: 'gemini', name: 'Gemini CLI', dir: '.gemini' },
  { id: 'opencode', name: 'OpenCode', dir: '.opencode' },
  { id: 'copilot', name: 'GitHub Copilot', dir: '.github-copilot' },
  { id: 'cline', name: 'Cline', dir: '.cline' },
  { id: 'roo-code', name: 'Roo Code', dir: '.roo-code' },
  { id: 'amp', name: 'Amp', dir: '.amp' },
  { id: 'goose', name: 'Goose', dir: '.goose' },
  { id: 'aider', name: 'Aider', dir: '.aider' },
  { id: 'codeium', name: 'Codeium Windsurf', dir: '.codeium' },
  { id: 'zed', name: 'Zed', dir: '.zed' },
  { id: 'continue', name: 'Continue', dir: '.continue' },
  { id: 'pearai', name: 'PearAI', dir: '.pearai' },
  { id: 'void', name: 'Void', dir: '.void' },
  { id: 'melty', name: 'Melty', dir: '.melty' },
  { id: 'trae', name: 'Trae', dir: '.trae' },
  { id: 'junie', name: 'Junie', dir: '.junie' },
  { id: 'kilo-code', name: 'Kilo Code', dir: '.kilo-code' },
  { id: 'blackbox', name: 'Blackbox AI', dir: '.blackbox-ai' },
] as const
