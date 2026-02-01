import * as fs from 'node:fs/promises'

import { ipcMain } from 'electron'

import { IPC_CHANNELS } from '../../shared/ipc-channels'
import type { UnlinkFromAgentOptions, UnlinkResult } from '../../shared/types'
import { scanSkills } from '../services/skillScanner'

/**
 * Register IPC handlers for skills operations
 */
export function registerSkillsHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.SKILLS_GET_ALL, async () => {
    return scanSkills()
  })

  /**
   * Unlink a skill from a specific agent by removing the symlink
   * @param options - skillName, agentId, linkPath
   * @returns UnlinkResult with success status and optional error
   */
  ipcMain.handle(
    IPC_CHANNELS.SKILLS_UNLINK_FROM_AGENT,
    async (_, options: UnlinkFromAgentOptions): Promise<UnlinkResult> => {
      const { linkPath } = options

      try {
        // Verify the path is a symlink (not a real directory)
        const stats = await fs.lstat(linkPath)
        if (!stats.isSymbolicLink()) {
          return {
            success: false,
            error:
              'Cannot unlink: path is not a symlink (may be a local skill)',
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
    },
  )
}
