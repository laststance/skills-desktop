import * as fs from 'node:fs/promises'
import { join } from 'node:path'

import { IPC_CHANNELS } from '../../shared/ipc-channels'
import { AGENTS, SOURCE_DIR } from '../constants'
import { scanSkills } from '../services/skillScanner'

import { typedHandle } from './typedHandle'

/**
 * Register IPC handlers for skills operations
 */
export function registerSkillsHandlers(): void {
  typedHandle(IPC_CHANNELS.SKILLS_GET_ALL, async () => {
    return scanSkills()
  })

  /**
   * Unlink a skill from a specific agent by removing the symlink
   * @param options - skillName, agentId, linkPath
   * @returns UnlinkResult with success status and optional error
   */
  typedHandle(IPC_CHANNELS.SKILLS_UNLINK_FROM_AGENT, async (_, options) => {
    const { linkPath } = options

    try {
      // Verify the path is a symlink (not a real directory)
      const stats = await fs.lstat(linkPath)
      if (!stats.isSymbolicLink()) {
        return {
          success: false,
          error: 'Cannot unlink: path is not a symlink (may be a local skill)',
        }
      }

      // Remove the symlink
      await fs.unlink(linkPath)
      return { success: true }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error occurred'
      return { success: false, error: message }
    }
  })

  /**
   * Delete a specific agent's entire skills folder
   * @param options - agentId, agentPath
   * @returns RemoveAllFromAgentResult with item count removed
   */
  typedHandle(IPC_CHANNELS.SKILLS_REMOVE_ALL_FROM_AGENT, async (_, options) => {
    const { agentPath } = options

    try {
      // Count entries before deletion for reporting
      let removedCount = 0
      try {
        const entries = await fs.readdir(agentPath)
        removedCount = entries.length
      } catch {
        // Directory may not exist or be unreadable
      }

      // Delete the entire agent skills directory
      await fs.rm(agentPath, { recursive: true, force: true })

      return { success: true, removedCount }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error occurred'
      return { success: false, removedCount: 0, error: message }
    }
  })

  /**
   * Delete a skill entirely: remove all agent symlinks/copies, then source dir
   * @param options - skillName, skillPath
   * @returns DeleteSkillResult with symlinks removed count
   */
  typedHandle(IPC_CHANNELS.SKILLS_DELETE, async (_, options) => {
    const { skillName, skillPath } = options
    let symlinksRemoved = 0

    try {
      // Remove symlinks and local copies across all agents
      for (const agent of AGENTS) {
        const agentSkillPath = join(agent.path, skillName)
        try {
          const stats = await fs.lstat(agentSkillPath)
          if (stats.isSymbolicLink()) {
            await fs.unlink(agentSkillPath)
            symlinksRemoved++
          } else if (stats.isDirectory()) {
            await fs.rm(agentSkillPath, { recursive: true, force: true })
          }
        } catch {
          // Agent skill path doesn't exist, skip
        }
      }

      // Remove source directory if under SOURCE_DIR
      if (skillPath.startsWith(SOURCE_DIR)) {
        await fs.rm(skillPath, { recursive: true, force: true })
      }

      return { success: true, symlinksRemoved }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error occurred'
      return { success: false, symlinksRemoved, error: message }
    }
  })

  /**
   * Create symlinks for a skill to multiple agents
   * @param options - skillName, skillPath, agentIds
   * @returns CreateSymlinksResult with created count and per-agent failures
   */
  typedHandle(IPC_CHANNELS.SKILLS_CREATE_SYMLINKS, async (_, options) => {
    const { skillName, skillPath, agentIds } = options
    let created = 0
    const failures: Array<{
      agentId: (typeof agentIds)[number]
      error: string
    }> = []

    for (const agentId of agentIds) {
      const agent = AGENTS.find((a) => a.id === agentId)
      if (!agent) {
        failures.push({ agentId, error: 'Agent not found' })
        continue
      }

      const linkPath = join(agent.path, skillName)

      try {
        // Ensure agent skills directory exists
        await fs.mkdir(agent.path, { recursive: true })

        // Check if something already exists at the link path
        try {
          await fs.lstat(linkPath)
          failures.push({ agentId, error: 'Already exists' })
          continue
        } catch {
          // Nothing exists, proceed with symlink creation
        }

        await fs.symlink(skillPath, linkPath)
        created++
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown error occurred'
        failures.push({ agentId, error: message })
      }
    }

    return { success: failures.length === 0, created, failures }
  })
}
