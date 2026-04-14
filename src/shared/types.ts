import type { AgentId, AgentName } from './constants'
export type { AgentId, AgentName } from './constants'
export type {
  ColorThemePresetName,
  NeutralThemePresetName,
  ThemePresetName,
} from './constants'

/**
 * A reusable AI agent capability package containing a SKILL.md manifest.
 * Installed in ~/.agents/skills/ and symlinked into agent skill directories.
 * @example
 * {
 *   name: 'tdd-workflow',
 *   description: 'Test-driven development workflow for TypeScript projects',
 *   path: '/Users/me/.agents/skills/tdd-workflow',
 *   symlinkCount: 3,
 *   symlinks: [...],
 *   source: 'vercel-labs/skills',
 *   sourceUrl: 'https://github.com/vercel-labs/skills.git',
 * }
 */
export interface Skill {
  /** Human-readable identifier matching the directory name. @example "tdd-workflow" */
  name: string
  /** Summary from SKILL.md frontmatter. @example "Test-driven development workflow" */
  description: string
  /** Absolute filesystem path to the skill directory. @example "/Users/me/.agents/skills/tdd-workflow" */
  path: string
  /** Number of agents this skill is symlinked to (valid symlinks only). @example 3 */
  symlinkCount: number
  /** Per-agent symlink status entries */
  symlinks: SymlinkInfo[]
  /** Short source identifier in owner/repo format. @example "vercel-labs/skills" */
  source?: string
  /** Full URL to the source repository. @example "https://github.com/vercel-labs/skills.git" */
  sourceUrl?: string
}

/**
 * An AI coding agent that can use skills via symlinks.
 * Each agent has a home directory (e.g. ~/.claude) containing a skills/ subdirectory.
 * @example
 * {
 *   id: 'claude-code',
 *   name: 'Claude Code',
 *   path: '/Users/me/.claude/skills',
 *   exists: true,
 *   skillCount: 12,
 *   localSkillCount: 2,
 * }
 */
export interface Agent {
  /** Internal identifier matching skills CLI agent ID. @example "claude-code" */
  id: AgentId
  /** Display name shown in the UI. @example "Claude Code" */
  name: AgentName
  /** Absolute path to the agent's skills directory. @example "/Users/me/.claude/skills" */
  path: string
  /** Whether the agent's skills directory exists on disk */
  exists: boolean
  /** Number of valid symlinked skills. @example 12 */
  skillCount: number
  /** Number of local skills (real folders, not symlinks). @example 2 */
  localSkillCount: number
}

/**
 * Symlink status between a skill source and an agent's skills directory.
 * Each skill has one SymlinkInfo per agent, describing the link state.
 * @example
 * {
 *   agentId: 'cursor',
 *   agentName: 'Cursor',
 *   status: 'valid',
 *   targetPath: '/Users/me/.agents/skills/tdd-workflow',
 *   linkPath: '/Users/me/.cursor/skills/tdd-workflow',
 *   isLocal: false,
 * }
 */
export interface SymlinkInfo {
  /** Agent this symlink belongs to. @example "cursor" */
  agentId: AgentId
  /** Agent display name. @example "Cursor" */
  agentName: AgentName
  /** Current symlink state: valid (linked), broken (dangling), or missing (no link) */
  status: SymlinkStatus
  /** Where the symlink points to (skill source directory). @example "/Users/me/.agents/skills/tdd-workflow" */
  targetPath: string
  /** Where the symlink lives (in agent's skills dir). @example "/Users/me/.cursor/skills/tdd-workflow" */
  linkPath: string
  /** true = real folder in agent dir (local skill), false = symlink */
  isLocal: boolean
}

/**
 * Symlink status type
 * - valid: Symlink exists and points to valid target
 * - broken: Symlink exists but target is missing
 * - missing: No symlink for this agent
 */
export type SymlinkStatus = 'valid' | 'broken' | 'missing'

/**
 * Skill type indicating source of the skill
 * - source: Skill from ~/.agents/skills/ (symlinked to agents)
 * - local: Skill created directly in agent's skills directory
 */
export type SkillType = 'source' | 'local'

/**
 * Statistics for the ~/.agents/skills/ source directory.
 * Shown in the sidebar SourceCard.
 * @example
 * { path: '/Users/me/.agents/skills', skillCount: 15, totalSize: '2.4 MB', lastModified: '2026-04-10' }
 */
export interface SourceStats {
  /** Absolute path to the source directory. @example "/Users/me/.agents/skills" */
  path: string
  /** Total number of skill directories. @example 15 */
  skillCount: number
  /** Human-readable total size. @example "2.4 MB" */
  totalSize: string
  /** Human-readable last modified date. @example "2026-04-10" */
  lastModified: string
}

/**
 * Skill metadata parsed from SKILL.md frontmatter.
 * @example { name: 'tdd-workflow', description: 'Test-driven development workflow' }
 */
export interface SkillMetadata {
  /** Skill name from frontmatter `name` field. @example "tdd-workflow" */
  name: string
  /** Skill description from frontmatter `description` field. @example "Test-driven development workflow" */
  description: string
}

/**
 * File entry within a skill directory (for the code preview panel).
 * @example { name: 'SKILL.md', path: '/Users/me/.agents/skills/tdd/SKILL.md', extension: 'md', size: 1024 }
 */
export interface SkillFile {
  /** File name with extension. @example "SKILL.md" */
  name: string
  /** Absolute path to the file. @example "/Users/me/.agents/skills/tdd/SKILL.md" */
  path: string
  /** File extension without dot. @example "md" */
  extension: string
  /** File size in bytes. @example 1024 */
  size: number
}

/**
 * File content loaded for the code preview panel.
 * @example { name: 'SKILL.md', content: '---\nname: tdd\n---', extension: 'md', lineCount: 42 }
 */
export interface SkillFileContent {
  /** File name with extension. @example "SKILL.md" */
  name: string
  /** Full text content of the file */
  content: string
  /** File extension without dot. @example "md" */
  extension: string
  /** Number of lines in the file. @example 42 */
  lineCount: number
}

/**
 * Update information from electron-updater.
 * @example { version: '0.8.0', releaseNotes: 'Added marketplace search' }
 */
export interface UpdateInfo {
  /** Semantic version string of the available update. @example "0.8.0" */
  version: string
  /** Markdown release notes (may be absent for minor releases) */
  releaseNotes?: string
}

/**
 * Download progress during auto-update.
 * @example { percent: 45.2, bytesPerSecond: 524288, total: 10485760, transferred: 4739174 }
 */
export interface DownloadProgress {
  /** Download completion percentage (0–100). @example 45.2 */
  percent: number
  /** Current download speed in bytes per second. @example 524288 */
  bytesPerSecond: number
  /** Total download size in bytes. @example 10485760 */
  total: number
  /** Bytes transferred so far. @example 4739174 */
  transferred: number
}

/**
 * Update status for UI state management
 */
export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'error'

/**
 * Skill search result from `npx skills find` command
 */
export interface SkillSearchResult {
  /** Search result ranking */
  rank: number
  /** Skill name */
  name: string
  /** Repository in owner/repo format */
  repo: string
  /** URL to skill source (skills.sh or GitHub) */
  url: string
  /** Install count (may not be available from all sources) */
  installCount?: number
}

/**
 * A skill bookmarked for later reinstall.
 * Stored in Redux and persisted to localStorage.
 * @example
 * const bookmark: BookmarkedSkill = {
 *   name: 'task',
 *   repo: 'vercel-labs/skills',
 *   url: 'https://skills.sh/task',
 *   bookmarkedAt: '2026-04-01T08:00:00.000Z',
 * }
 */
export interface BookmarkedSkill {
  /** Skill name */
  name: string
  /** Repository in owner/repo format (required for InstallOptions.repo) */
  repo: string
  /** URL to skill source (skills.sh or GitHub) */
  url: string
  /** ISO timestamp of when bookmarked */
  bookmarkedAt: string
}

/**
 * Options for skill installation
 */
export interface InstallOptions {
  /** Repository in owner/repo format */
  repo: string
  /** Install globally (--global flag) */
  global: boolean
  /** Target agents (--agent flags) */
  agents: AgentId[]
  /** Specific skills to install (--skill flags) */
  skills?: string[]
}

/**
 * Result from CLI command execution
 */
export interface CliCommandResult {
  success: boolean
  stdout: string
  stderr: string
  code: number | null
}

/**
 * Progress information during skill installation
 */
export interface InstallProgress {
  phase: 'cloning' | 'installing' | 'linking' | 'complete' | 'error'
  message: string
  percent?: number
}

/**
 * Marketplace operation status
 */
export type MarketplaceStatus =
  | 'idle'
  | 'searching'
  | 'installing'
  | 'removing'
  | 'error'

/**
 * Filter for marketplace leaderboard ranking tabs.
 * Maps to skills.sh pages: / (all-time), /trending, /hot
 */
export type RankingFilter = 'all-time' | 'trending' | 'hot'

/**
 * Per-filter leaderboard loading status
 */
export type LeaderboardStatus = 'idle' | 'loading' | 'error'

/**
 * Cached leaderboard data for a single ranking filter.
 * Each filter key tracks its own fetch state and TTL independently.
 * @example
 * {
 *   skills: [...],
 *   lastFetched: 1713045600000,
 *   filter: 'trending',
 *   status: 'idle',
 * }
 */
export interface LeaderboardData {
  /** Ranked skills parsed from skills.sh HTML */
  skills: SkillSearchResult[]
  /** Timestamp (ms since epoch) of last successful fetch */
  lastFetched: number
  /** Which ranking filter this data belongs to */
  filter: RankingFilter
  /** Current loading state for this filter */
  status: LeaderboardStatus
  /** Error message if status is 'error' */
  error?: string
}

/**
 * Options for unlinking a skill from a specific agent
 */
export interface UnlinkFromAgentOptions {
  skillName: string
  agentId: AgentId
  linkPath: string
}

/**
 * Result from unlinking a skill from an agent
 */
export interface UnlinkResult {
  success: boolean
  error?: string
}

/**
 * Options for deleting a specific agent's entire skills folder
 * @example
 * { agentId: 'claude-code', agentPath: '/Users/x/.claude/skills' }
 */
export interface RemoveAllFromAgentOptions {
  agentId: AgentId
  agentPath: string
}

/**
 * Result from deleting an agent's skills folder
 * @example
 * { success: true, removedCount: 5 }
 */
export interface RemoveAllFromAgentResult {
  success: boolean
  /** Number of items that were in the folder before deletion */
  removedCount: number
  error?: string
}

/**
 * Options for deleting a skill entirely (source dir + all agent symlinks)
 * @example
 * { skillName: 'theme-generator', skillPath: '/Users/x/.agents/skills/theme-generator' }
 */
export interface DeleteSkillOptions {
  skillName: string
  skillPath: string
}

/**
 * Result from deleting a skill
 * @example
 * { success: true, symlinksRemoved: 3 }
 */
export interface DeleteSkillResult {
  success: boolean
  symlinksRemoved: number
  error?: string
}

/**
 * Options for creating symlinks for a skill to multiple agents
 * @example
 * { skillName: 'theme-generator', skillPath: '/...', agentIds: ['claude-code', 'cursor'] }
 */
export interface CreateSymlinksOptions {
  skillName: string
  skillPath: string
  agentIds: AgentId[]
}

/**
 * Result from creating symlinks
 * @example
 * { success: true, created: 2, failures: [] }
 */
export interface CreateSymlinksResult {
  success: boolean
  created: number
  failures: Array<{ agentId: AgentId; error: string }>
}

/**
 * Options for copying a skill from one agent to other agents
 * @param skillName - Name of the skill to copy
 * @param linkPath - Full path to the skill in the source agent's directory
 * @param targetAgentIds - IDs of agents to copy the skill to
 * @example
 * { skillName: 'my-skill', linkPath: '/Users/me/.claude/skills/my-skill', targetAgentIds: ['cursor', 'windsurf'] }
 */
export interface CopyToAgentsOptions {
  skillName: string
  linkPath: string
  targetAgentIds: AgentId[]
}

/**
 * Result of copying a skill to multiple agents
 * @param success - true if all copies succeeded
 * @param copied - Number of agents successfully copied to
 * @param failures - Per-agent error details
 * @example
 * { success: true, copied: 2, failures: [] }
 * { success: false, copied: 1, failures: [{ agentId: 'codex', error: 'Already exists' }] }
 */
export interface CopyToAgentsResult {
  success: boolean
  copied: number
  failures: Array<{ agentId: AgentId; error: string }>
}

/**
 * A conflict found during sync preview (local folder exists where symlink would go)
 */
export interface SyncConflict {
  skillName: string
  agentId: AgentId
  agentName: AgentName
  agentSkillPath: string
}

/**
 * Result from sync preview (dry run)
 * @example
 * { totalSkills: 5, totalAgents: 3, toCreate: 10, alreadySynced: 5, conflicts: [] }
 */
export interface SyncPreviewResult {
  totalSkills: number
  totalAgents: number
  toCreate: number
  alreadySynced: number
  conflicts: SyncConflict[]
}

/**
 * Options for executing sync with conflict resolution choices
 * @example
 * { replaceConflicts: ['/Users/x/.claude/skills/my-skill'] }
 */
export interface SyncExecuteOptions {
  replaceConflicts: string[]
}

/**
 * Action type for each item processed during sync execution.
 * - `created`: new symlink was created
 * - `replaced`: existing conflict was overwritten with a symlink
 * - `skipped`: already-synced symlink or user-declined conflict (no filesystem change)
 * - `error`: operation failed; message is carried on the item
 */
export type SyncResultAction = 'created' | 'replaced' | 'skipped' | 'error'

/** Shared fields for every sync result row */
type SyncResultBase = {
  skillName: string
  agentName: string
}

/**
 * Per-item detail from sync execution, used to show a diff of what happened.
 * Discriminated union guarantees error rows always carry a message.
 * @example
 * { skillName: 'my-skill', agentName: 'Claude Code', action: 'created' }
 * @example
 * { skillName: 's', agentName: 'a', action: 'error', error: 'EACCES' }
 */
export type SyncResultItem =
  | (SyncResultBase & { action: 'created' | 'replaced' | 'skipped' })
  | (SyncResultBase & { action: 'error'; error: string })

/**
 * Result from executing sync
 * @example
 * { success: true, created: 10, replaced: 2, skipped: 5, errors: [], details: [...] }
 */
export interface SyncExecuteResult {
  success: boolean
  created: number
  replaced: number
  /** Number of already-synced items that were skipped */
  skipped: number
  errors: Array<{ path: string; error: string }>
  /** Per-item action details for displaying sync diff */
  details: SyncResultItem[]
}
