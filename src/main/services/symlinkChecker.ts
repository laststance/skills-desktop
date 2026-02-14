import { lstat, readlink, access } from 'fs/promises'
import { dirname, join, resolve } from 'path'

import type { SymlinkInfo, SymlinkStatus } from '../../shared/types'
import { AGENTS } from '../constants'

/**
 * Result from checking if a path is a symlink or local folder
 */
interface LinkOrLocalResult {
  status: SymlinkStatus
  isLocal: boolean
}

/**
 * Check if a path is a symlink or local folder
 * @param path - Path to check
 * @returns
 * - Symlink: { status: 'valid'|'broken', isLocal: false }
 * - Local folder: { status: 'valid', isLocal: true }
 * - Missing: { status: 'missing', isLocal: false }
 * @example
 * checkLinkOrLocal('/Users/.claude/skills/foo')
 * // => { status: 'valid', isLocal: false } (symlink)
 * // => { status: 'valid', isLocal: true } (real folder)
 */
async function checkLinkOrLocal(path: string): Promise<LinkOrLocalResult> {
  try {
    const stats = await lstat(path)

    if (stats.isSymbolicLink()) {
      // It's a symlink - check if target exists
      // resolve() handles both absolute and relative targets correctly:
      // absolute target → returned as-is, relative → resolved from symlink's directory
      const target = await readlink(path)
      const resolvedTarget = resolve(dirname(path), target)
      try {
        await access(resolvedTarget)
        return { status: 'valid', isLocal: false }
      } catch {
        return { status: 'broken', isLocal: false }
      }
    } else if (stats.isDirectory()) {
      // Real folder = local skill
      return { status: 'valid', isLocal: true }
    }

    // It's a file (not directory), treat as missing
    return { status: 'missing', isLocal: false }
  } catch {
    return { status: 'missing', isLocal: false }
  }
}

/**
 * Check symlink status for a skill across all agents
 * @param skillName - Name of the skill directory
 * @returns Array of symlink info for each agent
 * @example
 * checkSkillSymlinks('theme-generator')
 * // => [{ agentId: 'claude', status: 'valid', isLocal: false, ... }, ...]
 */
export async function checkSkillSymlinks(
  skillName: string,
): Promise<SymlinkInfo[]> {
  const results = await Promise.all(
    AGENTS.map(async (agent) => {
      const linkPath = join(agent.path, skillName)
      const { status, isLocal } = await checkLinkOrLocal(linkPath)

      let targetPath = ''
      if (status !== 'missing' && !isLocal) {
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
        isLocal,
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
    // resolve() handles both absolute and relative targets correctly
    const target = await readlink(linkPath)
    const resolvedTarget = resolve(dirname(linkPath), target)
    try {
      await access(resolvedTarget)
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
