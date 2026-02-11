import type { AgentId, AgentName } from './constants'
export type { AgentId, AgentName } from './constants'

/**
 * Skill entity representing an installed skill
 */
export interface Skill {
  name: string
  description: string
  path: string
  symlinkCount: number
  symlinks: SymlinkInfo[]
}

/**
 * AI agent that can use skills
 */
export interface Agent {
  id: AgentId
  name: AgentName
  path: string
  exists: boolean
  /** Number of valid symlinked skills */
  skillCount: number
  /** Number of local skills (real folders, not symlinks) */
  localSkillCount: number
}

/**
 * Information about a symlink between skill and agent
 */
export interface SymlinkInfo {
  agentId: AgentId
  agentName: AgentName
  status: SymlinkStatus
  targetPath: string
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
 * Statistics for the source directory
 */
export interface SourceStats {
  path: string
  skillCount: number
  totalSize: string
  lastModified: string
}

/**
 * Skill metadata from SKILL.md frontmatter
 */
export interface SkillMetadata {
  name: string
  description: string
}

/**
 * File info for skill directory contents
 */
export interface SkillFile {
  name: string
  path: string
  extension: string
  size: number
}

/**
 * File content with metadata
 */
export interface SkillFileContent {
  name: string
  content: string
  extension: string
  lineCount: number
}

/**
 * Update information from electron-updater
 */
export interface UpdateInfo {
  version: string
  releaseNotes?: string
}

/**
 * Download progress information
 */
export interface DownloadProgress {
  percent: number
  bytesPerSecond: number
  total: number
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
  /** Skills.sh URL */
  url: string
  /** Install count (may not be available from all sources) */
  installCount?: number
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
 * Options for removing all symlinks from a specific agent
 * @example
 * { agentId: 'claude-code', agentPath: '/Users/x/.claude/skills' }
 */
export interface RemoveAllFromAgentOptions {
  agentId: AgentId
  agentPath: string
}

/**
 * Result from removing all symlinks from an agent
 * @example
 * { success: true, removedCount: 5 }
 */
export interface RemoveAllFromAgentResult {
  success: boolean
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
 * Result from executing sync
 * @example
 * { success: true, created: 10, replaced: 2, errors: [] }
 */
export interface SyncExecuteResult {
  success: boolean
  created: number
  replaced: number
  errors: Array<{ path: string; error: string }>
}
