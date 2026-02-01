import { access, readdir } from 'fs/promises'
import { join } from 'path'

import type { Agent } from '../../shared/types'
import { AGENTS } from '../constants'

import { checkSymlinkStatus } from './symlinkChecker'

/**
 * Scan all supported agents and check their existence
 * @returns Array of Agent objects with existence, skill count, and local skill count
 * @example
 * scanAgents()
 * // => [{ id: 'claude', name: 'Claude Code', exists: true, skillCount: 3, localSkillCount: 1 }]
 */
export async function scanAgents(): Promise<Agent[]> {
  const agents = await Promise.all(
    AGENTS.map(async (agent) => {
      const exists = await checkAgentExists(agent.path)
      const [skillCount, localSkillCount] = exists
        ? await Promise.all([
            countAgentSkills(agent.path),
            countLocalSkills(agent.path),
          ])
        : [0, 0]

      return {
        id: agent.id,
        name: agent.name,
        path: agent.path,
        exists,
        skillCount,
        localSkillCount,
      }
    }),
  )

  // Sort: existing agents first, then alphabetically
  return agents.sort((a, b) => {
    if (a.exists !== b.exists) return a.exists ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

/**
 * Check if an agent's skills directory exists
 * @param agentPath - Path to agent's skills directory
 * @returns true if directory exists
 */
async function checkAgentExists(agentPath: string): Promise<boolean> {
  try {
    await access(agentPath)
    return true
  } catch {
    return false
  }
}

/**
 * Count number of valid skills (symlinks with existing targets) in an agent's skills dir
 * @param agentPath - Path to agent's skills directory
 * @returns Number of valid symlinked skills (broken symlinks and local folders excluded)
 * @example
 * countAgentSkills('/Users/.claude/skills')
 * // => 3 (only symlinks pointing to existing targets)
 */
async function countAgentSkills(agentPath: string): Promise<number> {
  try {
    const entries = await readdir(agentPath, { withFileTypes: true })
    const symlinks = entries.filter((e) => e.isSymbolicLink())

    // Check each symlink's validity
    const validityChecks = await Promise.all(
      symlinks.map(async (entry) => {
        const linkPath = join(agentPath, entry.name)
        const status = await checkSymlinkStatus(linkPath)
        return status === 'valid'
      }),
    )

    return validityChecks.filter(Boolean).length
  } catch {
    return 0
  }
}

/**
 * Count number of local skills (real folders with SKILL.md) in an agent's skills dir
 * @param agentPath - Path to agent's skills directory
 * @returns Number of valid local skills
 * @example
 * countLocalSkills('/Users/.claude/skills')
 * // => 1 (folders with SKILL.md, not symlinks)
 */
async function countLocalSkills(agentPath: string): Promise<number> {
  try {
    const entries = await readdir(agentPath, { withFileTypes: true })
    // Get directories that are NOT symlinks and don't start with '.'
    const dirs = entries.filter(
      (e) => e.isDirectory() && !e.isSymbolicLink() && !e.name.startsWith('.'),
    )

    // Check each has SKILL.md
    const validChecks = await Promise.all(
      dirs.map(async (d) => {
        const skillMd = join(agentPath, d.name, 'SKILL.md')
        try {
          await access(skillMd)
          return true
        } catch {
          return false
        }
      }),
    )

    return validChecks.filter(Boolean).length
  } catch {
    return 0
  }
}
