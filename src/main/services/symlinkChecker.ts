import { lstat, readlink, access } from 'fs/promises'
import { join } from 'path'

import type { SymlinkInfo, SymlinkStatus } from '../../shared/types'
import { AGENTS } from '../constants'

/**
 * Check symlink status for a skill across all agents
 * @param skillName - Name of the skill directory
 * @returns Array of symlink info for each agent
 * @example
 * checkSkillSymlinks('theme-generator')
 * // => [{ agentId: 'claude', status: 'valid', ... }, ...]
 */
export async function checkSkillSymlinks(
  skillName: string,
): Promise<SymlinkInfo[]> {
  const results = await Promise.all(
    AGENTS.map(async (agent) => {
      const linkPath = join(agent.path, skillName)
      const status = await checkSymlinkStatus(linkPath)

      let targetPath = ''
      if (status !== 'missing') {
        try {
          targetPath = await readlink(linkPath)
        } catch {
          // Could not read link target
        }
      }

      return {
        agentId: agent.id,
        agentName: agent.name,
        status,
        targetPath,
        linkPath,
      }
    }),
  )

  return results
}

/**
 * Check the status of a single symlink
 * @param linkPath - Path to the potential symlink
 * @returns Status: 'valid' | 'broken' | 'missing'
 * @example
 * checkSymlinkStatus('/Users/.claude/skills/foo')
 * // => 'valid' (if symlink exists and target exists)
 */
export async function checkSymlinkStatus(
  linkPath: string,
): Promise<SymlinkStatus> {
  try {
    const stats = await lstat(linkPath)

    if (!stats.isSymbolicLink()) {
      // It's a real directory/file, not a symlink
      return 'missing'
    }

    // Check if target exists
    const target = await readlink(linkPath)
    try {
      await access(target)
      return 'valid'
    } catch {
      return 'broken'
    }
  } catch {
    return 'missing'
  }
}

/**
 * Count symlinks per status for a skill
 * @param symlinks - Array of symlink info
 * @returns Count of valid symlinks
 * @example
 * countValidSymlinks([{ status: 'valid' }, { status: 'missing' }])
 * // => 1
 */
export function countValidSymlinks(symlinks: SymlinkInfo[]): number {
  return symlinks.filter((s) => s.status === 'valid').length
}
