import { access, lstat, mkdir, rm, symlink } from 'fs/promises'
import { join } from 'path'

import type {
  SyncConflict,
  SyncExecuteOptions,
  SyncExecuteResult,
  SyncPreviewResult,
  SyncResultItem,
} from '../../shared/types'
import { AGENTS } from '../constants'
import { extractErrorMessage } from '../utils/errors'

import { listValidSourceSkillDirs } from './dirScanner'

/**
 * Get agents whose base directory exists on disk
 * @returns Array of agents with existing directories
 */
async function getExistingAgents(): Promise<
  Array<{ id: string; name: string; path: string }>
> {
  const existing: Array<{ id: string; name: string; path: string }> = []
  for (const agent of AGENTS) {
    try {
      // Check parent dir (e.g. ~/.claude) not skills dir
      const parentDir = join(agent.path, '..')
      await access(parentDir)
      existing.push(agent)
    } catch {
      // Agent directory doesn't exist
    }
  }
  return existing
}

/**
 * Preview sync: detect what would happen without making changes
 * @returns SyncPreviewResult with counts and conflicts
 * @example
 * syncPreview()
 * // => { totalSkills: 5, totalAgents: 3, toCreate: 10, alreadySynced: 5, conflicts: [] }
 */
export async function syncPreview(): Promise<SyncPreviewResult> {
  const skills = await listValidSourceSkillDirs()
  const agents = await getExistingAgents()

  let toCreate = 0
  let alreadySynced = 0
  const conflicts: SyncConflict[] = []

  for (const skill of skills) {
    for (const agent of agents) {
      const linkPath = join(agent.path, skill.name)

      try {
        const stats = await lstat(linkPath)

        if (stats.isSymbolicLink()) {
          alreadySynced++
        } else {
          // Real directory or file = conflict
          conflicts.push({
            skillName: skill.name,
            agentId: agent.id as SyncConflict['agentId'],
            agentName: agent.name as SyncConflict['agentName'],
            agentSkillPath: linkPath,
          })
        }
      } catch {
        // Path doesn't exist = needs creation
        toCreate++
      }
    }
  }

  return {
    totalSkills: skills.length,
    totalAgents: agents.length,
    toCreate,
    alreadySynced,
    conflicts,
  }
}

/**
 * Execute sync: create symlinks and optionally replace conflicts.
 * Tracks per-item details for displaying a sync diff after completion.
 * @param options - replaceConflicts: paths to replace with symlinks
 * @returns SyncExecuteResult with counts, per-item details, and errors
 * @example
 * syncExecute({ replaceConflicts: ['/Users/x/.claude/skills/my-skill'] })
 * // => { success: true, created: 10, replaced: 1, skipped: 5, errors: [], details: [...] }
 */
export async function syncExecute(
  options: SyncExecuteOptions,
): Promise<SyncExecuteResult> {
  const { replaceConflicts } = options
  const replaceSet = new Set(replaceConflicts)

  const skills = await listValidSourceSkillDirs()
  const agents = await getExistingAgents()

  let created = 0
  let replaced = 0
  let skipped = 0
  const errors: SyncExecuteResult['errors'] = []
  const details: SyncResultItem[] = []
  // Track agent dirs we've already mkdir'd so per-skill loop does at most M mkdirs total,
  // while keeping the call inside the per-item try-path (errors become per-item, not global).
  const ensuredAgentDirs = new Set<string>()

  for (const skill of skills) {
    for (const agent of agents) {
      const linkPath = join(agent.path, skill.name)

      try {
        let exists = false
        let isSymlink = false

        try {
          const stats = await lstat(linkPath)
          exists = true
          isSymlink = stats.isSymbolicLink()
        } catch {
          // Path doesn't exist
        }

        if (!exists) {
          if (!ensuredAgentDirs.has(agent.path)) {
            await mkdir(agent.path, { recursive: true })
            ensuredAgentDirs.add(agent.path)
          }
          await symlink(skill.path, linkPath)
          created++
          details.push({
            skillName: skill.name,
            agentName: agent.name,
            action: 'created',
          })
        } else if (isSymlink) {
          skipped++
          details.push({
            skillName: skill.name,
            agentName: agent.name,
            action: 'skipped',
          })
        } else if (replaceSet.has(linkPath)) {
          await rm(linkPath, { recursive: true, force: true })
          await symlink(skill.path, linkPath)
          replaced++
          details.push({
            skillName: skill.name,
            agentName: agent.name,
            action: 'replaced',
          })
        } else {
          // Conflict the user declined to replace. Track as skipped so the dialog
          // can show it per-item, rather than silently folding it into the aggregate.
          skipped++
          details.push({
            skillName: skill.name,
            agentName: agent.name,
            action: 'skipped',
          })
        }
      } catch (error) {
        const msg = extractErrorMessage(error)
        errors.push({ path: linkPath, error: msg })
        details.push({
          skillName: skill.name,
          agentName: agent.name,
          action: 'error',
          error: msg,
        })
      }
    }
  }

  return {
    success: errors.length === 0,
    created,
    replaced,
    skipped,
    errors,
    details,
  }
}
