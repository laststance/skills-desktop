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
  id: string
  name: string
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
  agentId: string
  agentName: string
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
  agents: string[]
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
