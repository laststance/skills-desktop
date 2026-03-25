import * as fs from 'node:fs/promises'
import { join } from 'node:path'

import { IPC_CHANNELS } from '../../shared/ipc-channels'
import { AGENTS, SOURCE_DIR } from '../constants'
import { getAllowedBases, validatePath } from '../services/pathValidation'
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
   * Remove a skill from a specific agent by removing the symlink or local folder
   * @param options - skillName, agentId, linkPath
   * @returns UnlinkResult with success status and optional error
   */
  typedHandle(IPC_CHANNELS.SKILLS_UNLINK_FROM_AGENT, async (_, options) => {
    const { linkPath } = options

    try {
      const agentBases = AGENTS.map((a) => a.path)
      validatePath(linkPath, agentBases)
      const stats = await fs.lstat(linkPath)
      if (stats.isSymbolicLink()) {
        // Remove symlink
        await fs.unlink(linkPath)
      } else if (stats.isDirectory()) {
        // Remove local skill folder
        await fs.rm(linkPath, { recursive: true, force: true })
      } else {
        return {
          success: false,
          error: 'Cannot remove: path is neither a symlink nor a directory',
        }
      }

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
      const agentBases = AGENTS.map((a) => a.path)
      validatePath(agentPath, agentBases)
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

      // Remove source directory if within SOURCE_DIR boundary
      validatePath(skillPath, [SOURCE_DIR])
      await fs.rm(skillPath, { recursive: true, force: true })

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
    validatePath(skillPath, [SOURCE_DIR])
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

        // Atomic: attempt symlink directly, handle EEXIST
        await fs.symlink(skillPath, linkPath)
        created++
      } catch (error) {
        if (
          error instanceof Error &&
          'code' in error &&
          (error as NodeJS.ErrnoException).code === 'EEXIST'
        ) {
          failures.push({ agentId, error: 'Already exists' })
        } else {
          const message =
            error instanceof Error ? error.message : 'Unknown error occurred'
          failures.push({ agentId, error: message })
        }
      }
    }

    return { success: failures.length === 0, created, failures }
  })

  /**
   * Copy a skill from one agent to other agents.
   * Symlinked skills → create symlink pointing to same source.
   * Local skills → physical copy (fs.cp recursive).
   * @param options - skillName, linkPath (source), targetAgentIds
   * @returns CopyToAgentsResult with copied count and per-agent failures
   * @example
   * // Symlink: creates symlink in target agent pointing to same source
   * // Local: copies folder recursively to target agent
   */
  typedHandle(IPC_CHANNELS.SKILLS_COPY_TO_AGENTS, async (_, options) => {
    const { skillName, linkPath, targetAgentIds } = options
    validatePath(linkPath, getAllowedBases())
    let copied = 0
    const failures: Array<{
      agentId: (typeof targetAgentIds)[number]
      error: string
    }> = []

    // Detect source type
    let isSymlink = false
    let symlinkTarget = ''
    try {
      const stats = await fs.lstat(linkPath)
      if (stats.isSymbolicLink()) {
        isSymlink = true
        symlinkTarget = await fs.readlink(linkPath)
      } else if (!stats.isDirectory()) {
        return {
          success: false,
          copied: 0,
          failures: targetAgentIds.map((id) => ({
            agentId: id,
            error: 'Source is neither a symlink nor a directory',
          })),
        }
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Cannot access source skill'
      return {
        success: false,
        copied: 0,
        failures: targetAgentIds.map((id) => ({
          agentId: id,
          error: message,
        })),
      }
    }

    for (const agentId of targetAgentIds) {
      const agent = AGENTS.find((a) => a.id === agentId)
      if (!agent) {
        failures.push({ agentId, error: 'Agent not found' })
        continue
      }

      const destPath = join(agent.path, skillName)

      try {
        // Ensure agent skills directory exists
        await fs.mkdir(agent.path, { recursive: true })

        // Check if something already exists at the destination
        try {
          await fs.lstat(destPath)
          failures.push({ agentId, error: 'Already exists' })
          continue
        } catch {
          // Nothing exists, proceed
        }

        if (isSymlink) {
          await fs.symlink(symlinkTarget, destPath)
        } else {
          await fs.cp(linkPath, destPath, { recursive: true })
        }
        copied++
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown error occurred'
        failures.push({ agentId, error: message })
      }
    }

    return { success: failures.length === 0, copied, failures }
  })
}
