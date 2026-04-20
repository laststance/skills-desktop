import type { AgentId, AgentName } from './constants'
import type { FilePreviewKind } from './fileTypes'
export type { AgentId, AgentName } from './constants'
export type { ThemePresetName } from './constants'
export type { FilePreviewKind } from './fileTypes'

// ============================================================================
// Domain primitives — named aliases & branded types
// ----------------------------------------------------------------------------
// These types replace raw `string` / `number` at domain boundaries so signatures
// communicate WHAT a value represents, not just its runtime shape.
// ============================================================================

/**
 * Brand helper for nominal typing.
 * Intersects a primitive with a phantom `__brand` property so structurally
 * identical primitives cannot be swapped by mistake at compile time.
 * @example
 * type OrderId = Brand<string, 'OrderId'>
 * const id: OrderId = 'abc' as OrderId // explicit construction
 */
export type Brand<T, B extends string> = T & { readonly __brand: B }

/**
 * Human-readable skill identifier matching the directory name.
 * @example "tdd-workflow"
 */
export type SkillName = string

/**
 * Absolute filesystem path (platform-native, not POSIX-normalized).
 * @example "/Users/me/.agents/skills/tdd-workflow"
 */
export type AbsolutePath = string

/**
 * Filesystem path written with forward slashes, used for display and tree keys
 * regardless of the host OS. Always relative to some known root.
 * @example "lib/helper.py"
 */
export type PosixRelativePath = string

/**
 * File extension as surfaced by Node's `path.extname` (with leading dot, lowercase).
 * @example ".md"
 */
export type FileExtension = string

/**
 * IANA MIME type string.
 * @example "image/png"
 */
export type MimeType = string

/**
 * HTTP(S) URL string.
 * @example "https://github.com/vercel-labs/skills.git"
 */
export type HttpUrl = string

/**
 * ISO 8601 timestamp string (UTC with milliseconds).
 * @example "2026-04-01T08:00:00.000Z"
 */
export type IsoTimestamp = string

/**
 * Unix timestamp in milliseconds since epoch (Date.now() output).
 * @example 1713045600000
 */
export type UnixTimestampMs = number

/**
 * Human-readable byte-size string (from `humanFileSize()` in main).
 * @example "2.4 MB"
 */
export type HumanFileSize = string

/**
 * Human-readable date string (locale-formatted, not machine-parseable).
 * @example "Apr 10, 2026"
 */
export type HumanDate = string

/**
 * Free-form marketplace search text typed by the user.
 * Not branded because the value is user input with no nominal safety payoff —
 * the alias exists so signatures read "search text" rather than "any string".
 * @example "react hooks"
 */
export type SearchQuery = string

/**
 * Sonner toast id returned by `toast.custom(...)` and passed to `toast.dismiss(...)`.
 * Sonner treats this identifier as opaque (`string | number`); mirroring that
 * union here keeps imperative dismiss calls honest without widening to `any`.
 * @example "abc-123"
 * @example 42
 */
export type ToastId = string | number

/**
 * Repository identifier in GitHub `owner/repo` format.
 * Branded because structurally-identical strings (skill names, file names)
 * could otherwise be passed where a repo slug is required.
 * @example "vercel-labs/skills"
 */
export type RepositoryId = Brand<string, 'RepositoryId'>

/**
 * Construct a RepositoryId from a raw string at a trust boundary
 * (CLI output parser, IPC input, stored bookmark).
 * @example repositoryId('vercel-labs/skills')
 */
export const repositoryId = (value: string): RepositoryId =>
  value as RepositoryId

/**
 * Semantic version string following semver (major.minor.patch, optional suffix).
 * Branded to distinguish from arbitrary strings returned by electron-updater.
 * @example "0.8.0"
 */
export type SemanticVersion = Brand<string, 'SemanticVersion'>

/**
 * Construct a SemanticVersion from a raw string at a trust boundary
 * (electron-updater payload, package.json read, IPC event).
 * @example semanticVersion('0.11.0')
 */
export const semanticVersion = (value: string): SemanticVersion =>
  value as SemanticVersion

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
  name: SkillName
  /** Summary from SKILL.md frontmatter. @example "Test-driven development workflow" */
  description: string
  /** Absolute filesystem path to the skill directory. @example "/Users/me/.agents/skills/tdd-workflow" */
  path: AbsolutePath
  /** Number of agents this skill is symlinked to (valid symlinks only). @example 3 */
  symlinkCount: number
  /** Per-agent symlink status entries */
  symlinks: SymlinkInfo[]
  /** Short source identifier in owner/repo format. @example "vercel-labs/skills" */
  source?: RepositoryId
  /** Full URL to the source repository. @example "https://github.com/vercel-labs/skills.git" */
  sourceUrl?: HttpUrl
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
  path: AbsolutePath
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
  targetPath: AbsolutePath
  /** Where the symlink lives (in agent's skills dir). @example "/Users/me/.cursor/skills/tdd-workflow" */
  linkPath: AbsolutePath
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
  path: AbsolutePath
  /** Total number of skill directories. @example 15 */
  skillCount: number
  /** Human-readable total size. @example "2.4 MB" */
  totalSize: HumanFileSize
  /** ISO 8601 last-modified timestamp. @example "2026-04-10T08:00:00.000Z" */
  lastModified: IsoTimestamp
}

/**
 * Skill metadata parsed from SKILL.md frontmatter.
 * @example { name: 'tdd-workflow', description: 'Test-driven development workflow' }
 */
export interface SkillMetadata {
  /** Skill name from frontmatter `name` field. @example "tdd-workflow" */
  name: SkillName
  /** Skill description from frontmatter `description` field. @example "Test-driven development workflow" */
  description: string
}

/**
 * File entry within a skill directory (for the code preview panel).
 * `relativePath` is POSIX-style (forward slashes) relative to the skill root,
 * used by the UI to build a folder tree without re-deriving paths.
 * @example
 * {
 *   name: 'SKILL.md',
 *   path: '/Users/me/.agents/skills/tdd/SKILL.md',
 *   relativePath: 'SKILL.md',
 *   extension: '.md',
 *   size: 1024,
 *   previewable: 'text',
 * }
 * @example
 * {
 *   name: 'helper.py',
 *   path: '/Users/me/.agents/skills/tdd/lib/helper.py',
 *   relativePath: 'lib/helper.py',
 *   extension: '.py',
 *   size: 2048,
 *   previewable: 'text',
 * }
 */
export interface SkillFile {
  /** File name with extension. @example "SKILL.md" */
  name: string
  /** Absolute path to the file. @example "/Users/me/.agents/skills/tdd/SKILL.md" */
  path: AbsolutePath
  /** POSIX-style path relative to the skill root. @example "lib/helper.py" */
  relativePath: PosixRelativePath
  /** File extension with leading dot (lowercase). @example ".md" */
  extension: FileExtension
  /** File size in bytes. @example 1024 */
  size: number
  /** How the renderer should display this file. */
  previewable: FilePreviewKind
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
  extension: FileExtension
  /** Number of lines in the file. @example 42 */
  lineCount: number
}

/**
 * Binary file content (images) loaded as a base64 data URL so the renderer
 * can drop it directly into an `<img src>` without a custom protocol handler.
 * @example
 * {
 *   name: 'preview.png',
 *   dataUrl: 'data:image/png;base64,iVBORw0KGgo...',
 *   mimeType: 'image/png',
 *   size: 48201,
 * }
 */
export interface SkillBinaryContent {
  /** File name with extension. @example "preview.png" */
  name: string
  /** base64-encoded data URL ready to use in `<img src>`. */
  dataUrl: string
  /** MIME type derived from the file extension. @example "image/png" */
  mimeType: MimeType
  /** File size in bytes. @example 48201 */
  size: number
}

/**
 * Update information from electron-updater.
 * Emitted on `update:available` and `update:downloaded` events.
 * @example { version: '0.8.0', releaseNotes: 'Added marketplace search' }
 */
export interface UpdateInfo {
  /** Semantic version string of the available update. @example "0.8.0" */
  version: SemanticVersion
  /** Markdown release notes (absent for releases published without notes) */
  releaseNotes?: string
}

/**
 * Event payload for the `skills:deleteProgress` channel — emitted by main
 * during serial batch delete when `total >= BULK_PROGRESS_THRESHOLD` so the
 * renderer toolbar can show a live counter.
 * @example { current: 3, total: 12 }
 */
export interface DeleteProgressPayload {
  /** 1-based index of the item just processed. @example 3 */
  current: number
  /** Total items in this batch. @example 12 */
  total: number
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
 * A skill surfaced by the marketplace — either from a `skills find` CLI search
 * or scraped from the skills.sh leaderboard HTML.
 * @example
 * {
 *   rank: 1,
 *   name: 'task',
 *   repo: 'vercel-labs/skills',
 *   url: 'https://skills.sh/task',
 *   installCount: 2480,
 * }
 */
export interface SkillSearchResult {
  /** 1-indexed rank in the source listing (CLI output order or leaderboard). @example 1 */
  rank: number
  /** Skill name (directory-style identifier). @example "task" */
  name: SkillName
  /** Source repository in GitHub owner/repo format. @example "vercel-labs/skills" */
  repo: RepositoryId
  /** Canonical URL to the skill on skills.sh or its GitHub source. @example "https://skills.sh/task" */
  url: HttpUrl
  /** Install count from skills.sh when available (absent for CLI search results). @example 2480 */
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
  /** Skill name (used as unique key within the bookmark list). @example "task" */
  name: SkillName
  /** Source repository in owner/repo format — passed to InstallOptions.repo on reinstall. Empty string for local skills without a remote source. @example "vercel-labs/skills" */
  repo: RepositoryId | ''
  /** Canonical URL to the skill source (skills.sh or GitHub). @example "https://skills.sh/task" */
  url: HttpUrl
  /** ISO 8601 timestamp of when this entry was bookmarked. @example "2026-04-01T08:00:00.000Z" */
  bookmarkedAt: IsoTimestamp
}

/**
 * Arguments passed to the `skills install` CLI through the IPC bridge.
 * @example
 * { repo: 'vercel-labs/skills', global: true, agents: ['claude-code'], skills: ['task'] }
 */
export interface InstallOptions {
  /** Source repository in owner/repo format. @example "vercel-labs/skills" */
  repo: RepositoryId
  /** When true, installs into ~/.agents/skills/ (equivalent to `--global`). */
  global: boolean
  /** Target agent IDs (translated to `--agent` flags per entry). */
  agents: AgentId[]
  /** Specific skill names to install (translated to `--skill` flags). Omit to install every skill in the repo. @example ["task", "theme-generator"] */
  skills?: SkillName[]
}

/**
 * Captured output from a spawned skills-CLI process.
 * @example
 * { success: true, stdout: '✔ Installed task', stderr: '', code: 0 }
 */
export interface CliCommandResult {
  /** true when the process exited with code 0. */
  success: boolean
  /** Full stdout stream, joined. May be empty. */
  stdout: string
  /** Full stderr stream, joined. May be empty. */
  stderr: string
  /** Exit code, or null if the process was killed by a signal. @example 0 */
  code: number | null
}

/**
 * Streamed progress event emitted while the skills CLI runs an install.
 * Pushed over IPC on the `skills:cli:progress` channel.
 * @example { phase: 'cloning', message: 'Fetching vercel-labs/skills...' }
 * @example { phase: 'complete', message: '2 skills installed', percent: 100 }
 */
export interface InstallProgress {
  /** Current pipeline stage. */
  phase: 'cloning' | 'installing' | 'linking' | 'complete' | 'error'
  /** Human-readable status line surfaced in the UI. */
  message: string
  /** Overall completion percentage (0–100) when the stage can report one. */
  percent?: number
}

/**
 * Marketplace operation status
 */
export type MarketplaceStatus = 'idle' | 'searching' | 'installing' | 'error'

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
  /** Timestamp of last successful fetch, used for the 30-minute cache TTL. */
  lastFetched: UnixTimestampMs
  /** Which ranking filter this data belongs to */
  filter: RankingFilter
  /** Current loading state for this filter */
  status: LeaderboardStatus
  /** Error message if status is 'error' */
  error?: string
}

/**
 * IPC argument for `skills:unlinkFromAgent` — removes a single agent's symlink
 * without touching the underlying skill source.
 * @example
 * { skillName: 'tdd-workflow', agentId: 'cursor', linkPath: '/Users/me/.cursor/skills/tdd-workflow' }
 */
export interface UnlinkFromAgentOptions {
  /** Skill whose symlink will be removed. @example "tdd-workflow" */
  skillName: SkillName
  /** Agent the symlink belongs to. */
  agentId: AgentId
  /** Absolute path to the symlink itself (inside the agent's skills directory). */
  linkPath: AbsolutePath
}

/**
 * Result from unlinking a single symlink.
 * @example { success: true }
 * @example { success: false, error: "EACCES: permission denied" }
 */
export interface UnlinkResult {
  /** true if the symlink was removed (or did not exist). */
  success: boolean
  /** Failure reason when `success` is false. */
  error?: string
}

/**
 * IPC argument for `skills:removeAllFromAgent` — wipes everything inside a single
 * agent's skills directory (used when resetting an agent).
 * @example { agentId: 'claude-code', agentPath: '/Users/me/.claude/skills' }
 */
export interface RemoveAllFromAgentOptions {
  /** Agent whose skills directory will be cleared. */
  agentId: AgentId
  /** Absolute path to the agent's skills directory. @example "/Users/me/.claude/skills" */
  agentPath: AbsolutePath
}

/**
 * Result from clearing an agent's skills folder.
 * @example { success: true, removedCount: 5 }
 */
export interface RemoveAllFromAgentResult {
  /** true if the folder was emptied successfully. */
  success: boolean
  /** Number of entries (symlinks and local folders) removed. @example 5 */
  removedCount: number
  /** Failure reason when `success` is false. */
  error?: string
}

/**
 * IPC argument for `skills:deleteSkill` — removes the skill source directory
 * AND every agent symlink pointing at it. Main derives `sourcePath` from
 * `SOURCE_DIR + skillName` server-side; renderer never passes a path.
 * @example { skillName: 'theme-generator' }
 */
export interface DeleteSkillOptions {
  /** Skill to delete. @example "theme-generator" */
  skillName: SkillName
}

/**
 * Result from deleting a skill.
 * @example { success: true, symlinksRemoved: 3, cascadeAgents: ['cursor', 'codex'] }
 */
export interface DeleteSkillResult {
  /** true if both the source and all symlinks were removed. */
  success: boolean
  /** Count of agent symlinks that pointed at the skill before deletion. @example 3 */
  symlinksRemoved: number
  /** Agent IDs whose symlinks were removed during the delete. Empty if the skill had no symlinks. @example ["cursor", "codex"] */
  cascadeAgents: AgentId[]
  /** Failure reason when `success` is false. */
  error?: string
}

/**
 * Trash entry identifier — basename of the trash directory.
 * Format: `<unix_ms>-<skillName>-<rand8hex>` (e.g. `1729180800000-my-skill-a1b2c3d4`).
 * Branded so raw strings cannot be passed where a tombstone id is required.
 * @example "1729180800000-theme-generator-a1b2c3d4"
 */
export type TombstoneId = Brand<string, 'TombstoneId'>

/**
 * Construct a TombstoneId from a raw string at a trust boundary
 * (main-process trashService output, IPC input validated by Zod).
 * @example tombstoneId('1729180800000-theme-generator-a1b2c3d4')
 */
export const tombstoneId = (value: string): TombstoneId => value as TombstoneId

/**
 * IPC argument for `skills:deleteSkills` — batch delete N skills atomically with trash/undo.
 * Main derives each `sourcePath = join(SOURCE_DIR, skillName)` server-side; the renderer
 * does not pass paths (security: removes a trust-boundary widening).
 * @example { items: [{ skillName: 'task' }, { skillName: 'theme-generator' }] }
 */
export interface DeleteSkillsOptions {
  /** Skills to delete, in the order the user selected them (batch runs serially per reviewer #21). */
  items: Array<{ skillName: SkillName }>
}

/**
 * Per-item result from a batch delete. Discriminated on `outcome` so error items
 * never carry a phantom `tombstoneId` (reviewer CRITICAL-1).
 * @example { skillName: 'task', outcome: 'deleted', tombstoneId: '1729180800000-task-a1b2c3d4', symlinksRemoved: 3, cascadeAgents: ['cursor'] }
 * @example { skillName: 'task', outcome: 'error', error: { message: 'Permission denied', code: 'EACCES' } }
 */
export type BulkDeleteItemResult =
  | {
      skillName: SkillName
      outcome: 'deleted'
      tombstoneId: TombstoneId
      symlinksRemoved: number
      cascadeAgents: AgentId[]
    }
  | {
      skillName: SkillName
      outcome: 'error'
      error: { message: string; code?: string }
    }

/**
 * Batch delete result. Renderer derives the list of tombstone ids for the undo
 * toast via `items.filter(i => i.outcome === 'deleted').map(i => i.tombstoneId)`.
 * @example { items: [{ skillName: 'task', outcome: 'deleted', tombstoneId: '...', symlinksRemoved: 2, cascadeAgents: ['cursor'] }] }
 */
export interface BulkDeleteResult {
  /** Per-item outcome, index-aligned with the input `items` array (serial execution). */
  items: BulkDeleteItemResult[]
}

/**
 * IPC argument for `skills:unlinkManyFromAgent` — batch unlink N skills from a single agent.
 * Main derives `linkPath = join(agent.path, skillName)` server-side.
 * @example { agentId: 'cursor', items: [{ skillName: 'task' }, { skillName: 'theme-generator' }] }
 */
export interface UnlinkManyFromAgentOptions {
  /** Agent the symlinks belong to. */
  agentId: AgentId
  /** Skills whose symlinks should be removed (serial processing, no tombstone — unlink is benign). */
  items: Array<{ skillName: SkillName }>
}

/**
 * Per-item result from a batch unlink. Discriminated on `outcome`.
 * @example { skillName: 'task', outcome: 'unlinked' }
 * @example { skillName: 'task', outcome: 'error', error: { message: 'EACCES', code: 'EACCES' } }
 */
export type BulkUnlinkItemResult =
  | { skillName: SkillName; outcome: 'unlinked' }
  | {
      skillName: SkillName
      outcome: 'error'
      error: { message: string; code?: string }
    }

/**
 * Batch unlink result.
 * @example { items: [{ skillName: 'task', outcome: 'unlinked' }] }
 */
export interface BulkUnlinkResult {
  /** Per-item outcome, index-aligned with the input `items` array. */
  items: BulkUnlinkItemResult[]
}

/**
 * IPC argument for `skills:cli:remove` — deregister a single skill from the
 * global lock file (`~/.agents/.skill-lock.json`) via `npx skills remove
 * <name> --global --yes`. The UI routes here when `skill.source` is truthy
 * so the CLI stays in sync; non-CLI skills go through moveToTrash instead.
 * @example { skillName: 'brainstorming' }
 */
export interface CliRemoveSkillOptions {
  /** Skill to deregister. Must match a key in `~/.agents/.skill-lock.json`. @example "brainstorming" */
  skillName: SkillName
}

/** Batch remove timeout sentinel code surfaced to renderer to show retry copy. */
export const CLI_REMOVE_TIMEOUT_CODE = 'CLI_TIMEOUT' as const
/** Reject-on-busy sentinel code surfaced when another CLI process is active. */
export const CLI_REMOVE_BUSY_CODE = 'CLI_BUSY' as const

/**
 * Error code surfaced by CLI remove failures.
 * - numeric: direct process exit code from `npx skills remove`
 * - null: child process exited without a numeric code (signal/unknown)
 * - `CLI_TIMEOUT`: hard timeout exceeded before close
 * - `CLI_BUSY`: another CLI operation is already running
 */
export type CliRemoveErrorCode =
  | number
  | null
  | typeof CLI_REMOVE_TIMEOUT_CODE
  | typeof CLI_REMOVE_BUSY_CODE

/**
 * Result from `skills:cli:remove`. Discriminated on `outcome` so an error
 * branch never carries a spurious "removed" claim. The CLI is irreversible —
 * successful removes have no undo token.
 * @example { skillName: 'brainstorming', outcome: 'removed' }
 * @example { skillName: 'brainstorming', outcome: 'error', error: { message: 'skills: not found', code: 1 } }
 * @example { skillName: 'brainstorming', outcome: 'cancelled' }
 */
export type CliRemoveSkillResult =
  | { skillName: SkillName; outcome: 'removed' }
  | { skillName: SkillName; outcome: 'cancelled' }
  | {
      skillName: SkillName
      outcome: 'error'
      error: { message: string; code?: CliRemoveErrorCode }
    }

/**
 * IPC argument for `skills:cli:removeBatch` — deregister N skills in sequence.
 * CLI invocations are serial by design: concurrent writers to the lock file
 * would race. Bulk mixed-mode flows (CLI + trash) live in the renderer;
 * this IPC owns only the CLI half.
 * @example { items: [{ skillName: 'brainstorming' }, { skillName: 'frontend-design' }] }
 */
export interface CliRemoveSkillsOptions {
  /** Skills to deregister, in user-selection order. */
  items: Array<{ skillName: SkillName }>
}

/**
 * Batch CLI remove result. The batch handler is currently silent during the
 * serial spawn loop (no progress events) — the UI shows only the generic
 * `bulkCliRemoving` spinner via `SelectionToolbar`. A 10-item batch takes
 * ~6–20s of npx cold-starts; if that becomes a UX problem, add progress
 * emission to `skillsCli.ts:SKILLS_CLI_REMOVE_BATCH` and wire it through
 * `setBulkProgress` the way `SKILLS_CLI_INSTALL` already does.
 * Cancelled batches keep unprocessed items as `{ outcome: 'cancelled' }`
 * so renderer can preserve selection for retry.
 * @example { items: [{ skillName: 'brainstorming', outcome: 'removed' }] }
 * @example { items: [{ skillName: 'task', outcome: 'cancelled' }] }
 */
export interface CliRemoveSkillsResult {
  /** Per-item outcome, index-aligned with the input `items` array. */
  items: CliRemoveSkillResult[]
}

/**
 * IPC argument for `skills:restoreDeletedSkill` — undo a single tombstoned delete.
 * Main validates the `tombstoneId` against `tombstoneIdSchema` before touching the filesystem.
 * @example { tombstoneId: '1729180800000-theme-generator-a1b2c3d4' }
 */
export interface RestoreDeletedSkillOptions {
  /** Trash entry id returned in the original BulkDeleteResult. */
  tombstoneId: TombstoneId
}

/**
 * Result from restoring a tombstoned skill. Discriminated on `outcome`.
 * Partial restores surface via `symlinksSkipped` (target unreachable or linkPath occupied).
 * @example { outcome: 'restored', symlinksRestored: 3, symlinksSkipped: 0 }
 * @example { outcome: 'restored', symlinksRestored: 2, symlinksSkipped: 1 }
 * @example { outcome: 'error', error: { message: 'Trash entry missing' } }
 */
export type RestoreDeletedSkillResult =
  | { outcome: 'restored'; symlinksRestored: number; symlinksSkipped: number }
  | { outcome: 'error'; error: { message: string; code?: string } }

/**
 * IPC argument for `skills:createSymlinks` — points every target agent's
 * skills directory at a single shared skill source.
 * @example
 * { skillName: 'theme-generator', skillPath: '/Users/me/.agents/skills/theme-generator', agentIds: ['claude-code', 'cursor'] }
 */
export interface CreateSymlinksOptions {
  /** Skill being shared out. @example "theme-generator" */
  skillName: SkillName
  /** Absolute path to the skill source directory (the symlink target). @example "/Users/me/.agents/skills/theme-generator" */
  skillPath: AbsolutePath
  /** Agents that should receive the symlink. */
  agentIds: AgentId[]
}

/**
 * Result from `skills:createSymlinks`.
 * @example { success: true, created: 2, failures: [] }
 * @example { success: false, created: 1, failures: [{ agentId: 'codex', error: 'EEXIST' }] }
 */
export interface CreateSymlinksResult {
  /** true if every requested agent now has a valid symlink. */
  success: boolean
  /** Number of agents for which a symlink was newly created. @example 2 */
  created: number
  /** Per-agent failure list (empty on full success). */
  failures: Array<{ agentId: AgentId; error: string }>
}

/**
 * IPC argument for `skills:copyToAgents` — copies a skill that lives inside
 * one agent's directory into other agents (for the "copy for agent
 * collaboration" flow, where symlinks are intentionally NOT used).
 * @example
 * { skillName: 'my-skill', linkPath: '/Users/me/.claude/skills/my-skill', targetAgentIds: ['cursor', 'windsurf'] }
 */
export interface CopyToAgentsOptions {
  /** Skill name, used as the destination folder name in each target agent. @example "my-skill" */
  skillName: SkillName
  /** Absolute path to the source skill in the originating agent's directory. @example "/Users/me/.claude/skills/my-skill" */
  linkPath: AbsolutePath
  /** Agents that should receive a full copy (not a symlink). */
  targetAgentIds: AgentId[]
}

/**
 * Result from `skills:copyToAgents`.
 * @example { success: true, copied: 2, failures: [] }
 * @example { success: false, copied: 1, failures: [{ agentId: 'codex', error: 'Already exists' }] }
 */
export interface CopyToAgentsResult {
  /** true if every target agent received a copy. */
  success: boolean
  /** Number of agents successfully copied to. @example 2 */
  copied: number
  /** Per-agent failure list (empty on full success). */
  failures: Array<{ agentId: AgentId; error: string }>
}

/**
 * A sync conflict: a real folder already exists at the path where the skill
 * symlink would be created. Surfaced to the user for create-vs-replace choice.
 * @example
 * {
 *   skillName: 'my-skill',
 *   agentId: 'claude-code',
 *   agentName: 'Claude Code',
 *   agentSkillPath: '/Users/me/.claude/skills/my-skill',
 * }
 */
export interface SyncConflict {
  /** Skill whose symlink would collide. @example "my-skill" */
  skillName: SkillName
  /** Agent where the collision was found. */
  agentId: AgentId
  /** Agent display name (same row in AGENT_DEFINITIONS as agentId). */
  agentName: AgentName
  /** Absolute path of the existing folder that blocks symlink creation. @example "/Users/me/.claude/skills/my-skill" */
  agentSkillPath: AbsolutePath
}

/**
 * Result from sync preview (dry run).
 * @example { totalSkills: 5, totalAgents: 3, toCreate: 10, alreadySynced: 5, conflicts: [] }
 */
export interface SyncPreviewResult {
  /** Number of source skills considered. @example 5 */
  totalSkills: number
  /** Number of agents considered. @example 3 */
  totalAgents: number
  /** Symlinks that would be created on execute (excludes conflicts). @example 10 */
  toCreate: number
  /** Symlinks already in place — nothing to do for these. @example 5 */
  alreadySynced: number
  /** Per-agent folders that block creation until the user chooses to replace. */
  conflicts: SyncConflict[]
}

/**
 * Options for executing sync with conflict resolution choices.
 * @example { replaceConflicts: ['/Users/me/.claude/skills/my-skill'] }
 */
export interface SyncExecuteOptions {
  /** Absolute paths of conflicting folders the user explicitly opted to replace with symlinks. */
  replaceConflicts: AbsolutePath[]
}

/**
 * Action type for each item processed during sync execution.
 * - `created`: new symlink was created
 * - `replaced`: existing conflict was overwritten with a symlink
 * - `skipped`: already-synced symlink or user-declined conflict (no filesystem change)
 * - `error`: operation failed; message is carried on the item
 */
export type SyncResultAction = 'created' | 'replaced' | 'skipped' | 'error'

/** Shared fields for every sync result row. */
type SyncResultBase = {
  /** Skill involved in this row. @example "my-skill" */
  skillName: SkillName
  /** Agent display name this row refers to. @example "Claude Code" */
  agentName: AgentName
}

/**
 * Per-item detail from sync execution, used to render a diff of what happened.
 * Discriminated on `action` so error rows always carry a message.
 * @example { skillName: 'my-skill', agentName: 'Claude Code', action: 'created' }
 * @example { skillName: 's', agentName: 'Cursor', action: 'error', error: 'EACCES' }
 */
export type SyncResultItem =
  | (SyncResultBase & { action: 'created' | 'replaced' | 'skipped' })
  | (SyncResultBase & { action: 'error'; error: string })

/**
 * Result from executing sync.
 * @example { success: true, created: 10, replaced: 2, skipped: 5, errors: [], details: [...] }
 */
export interface SyncExecuteResult {
  /** true if every planned operation succeeded (errors.length === 0). */
  success: boolean
  /** Number of newly-created symlinks. @example 10 */
  created: number
  /** Number of existing folders replaced with symlinks (user opted-in). @example 2 */
  replaced: number
  /** Number of already-synced items that were skipped. @example 5 */
  skipped: number
  /** Per-path errors encountered during execution (empty on full success). */
  errors: Array<{ path: AbsolutePath; error: string }>
  /** Per-item action details for displaying a sync diff in the UI. */
  details: SyncResultItem[]
}
