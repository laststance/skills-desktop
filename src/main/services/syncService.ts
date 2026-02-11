import { access, lstat, mkdir, readdir, rm, symlink } from 'fs/promises'
import { join } from 'path'

import type {
  SyncConflict,
  SyncExecuteOptions,
  SyncExecuteResult,
  SyncPreviewResult,
} from '../../shared/types'
import { AGENTS, SOURCE_DIR } from '../constants'

/**
 * Check if a directory is a valid skill (has SKILL.md)
 * @param dirPath - Path to the directory
 * @returns True if SKILL.md exists
 */
async function isValidSkillDir(dirPath: string): Promise<boolean> {
  try {
    await access(join(dirPath, 'SKILL.md'))
    return true
  } catch {
    return false
  }
}

/**
 * Get names of all valid source skills in ~/.agents/skills/
 * @returns Array of skill directory names
 */
async function getSourceSkillNames(): Promise<
  Array<{ name: string; path: string }>
> {
  try {
    const entries = await readdir(SOURCE_DIR, { withFileTypes: true })
    const skillDirs = entries.filter(
      (e) => e.isDirectory() && !e.name.startsWith('.'),
    )

    const results: Array<{ name: string; path: string }> = []
    for (const dir of skillDirs) {
      const skillPath = join(SOURCE_DIR, dir.name)
      if (await isValidSkillDir(skillPath)) {
        results.push({ name: dir.name, path: skillPath })
      }
    }
    return results
  } catch {
    return []
  }
}

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
  const skills = await getSourceSkillNames()
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
 * Execute sync: create symlinks and optionally replace conflicts
 * @param options - replaceConflicts: paths to replace with symlinks
 * @returns SyncExecuteResult with created/replaced counts and errors
 * @example
 * syncExecute({ replaceConflicts: ['/Users/x/.claude/skills/my-skill'] })
 * // => { success: true, created: 10, replaced: 1, errors: [] }
 */
export async function syncExecute(
  options: SyncExecuteOptions,
): Promise<SyncExecuteResult> {
  const { replaceConflicts } = options
  const replaceSet = new Set(replaceConflicts)

  const skills = await getSourceSkillNames()
  const agents = await getExistingAgents()

  let created = 0
  let replaced = 0
  const errors: SyncExecuteResult['errors'] = []

  for (const skill of skills) {
    for (const agent of agents) {
      const linkPath = join(agent.path, skill.name)

      try {
        // Ensure agent skills directory exists
        await mkdir(agent.path, { recursive: true })

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
          // Create new symlink
          await symlink(skill.path, linkPath)
          created++
        } else if (isSymlink) {
          // Already synced, skip
        } else if (replaceSet.has(linkPath)) {
          // Conflict approved for replacement
          await rm(linkPath, { recursive: true, force: true })
          await symlink(skill.path, linkPath)
          replaced++
        }
        // else: conflict not approved, skip
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown error occurred'
        errors.push({ path: linkPath, error: message })
      }
    }
  }

  return {
    success: errors.length === 0,
    created,
    replaced,
    errors,
  }
}
