import { access, readdir } from 'fs/promises'

import type { Agent } from '../../shared/types'
import { AGENTS } from '../constants'

/**
 * Scan all supported agents and check their existence
 * @returns Array of Agent objects with existence and skill count
 * @example
 * scanAgents()
 * // => [{ id: 'claude', name: 'Claude Code', exists: true, skillCount: 3 }]
 */
export async function scanAgents(): Promise<Agent[]> {
  const agents = await Promise.all(
    AGENTS.map(async (agent) => {
      const exists = await checkAgentExists(agent.path)
      const skillCount = exists ? await countAgentSkills(agent.path) : 0

      return {
        id: agent.id,
        name: agent.name,
        path: agent.path,
        exists,
        skillCount,
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
 * Count number of skills (symlinks or directories) in an agent's skills dir
 * @param agentPath - Path to agent's skills directory
 * @returns Number of skills
 */
async function countAgentSkills(agentPath: string): Promise<number> {
  try {
    const entries = await readdir(agentPath, { withFileTypes: true })
    // Count both directories and symlinks
    return entries.filter((e) => e.isDirectory() || e.isSymbolicLink()).length
  } catch {
    return 0
  }
}
