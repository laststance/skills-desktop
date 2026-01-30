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
  skillCount: number
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
}

/**
 * Symlink status type
 * - valid: Symlink exists and points to valid target
 * - broken: Symlink exists but target is missing
 * - missing: No symlink for this agent
 */
export type SymlinkStatus = 'valid' | 'broken' | 'missing'

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
