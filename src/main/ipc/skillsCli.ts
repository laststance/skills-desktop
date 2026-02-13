import { BrowserWindow } from 'electron'

import { IPC_CHANNELS } from '../../shared/ipc-channels'
import type { InstallProgress } from '../../shared/types'
import { skillsCliService } from '../services/skillsCliService'

import { typedHandle } from './typedHandle'

/**
 * Register IPC handlers for Skills CLI (Marketplace) operations
 */
export function registerSkillsCliHandlers(): void {
  typedHandle(IPC_CHANNELS.SKILLS_CLI_SEARCH, async (_, query) => {
    return skillsCliService.search(query)
  })

  typedHandle(IPC_CHANNELS.SKILLS_CLI_INSTALL, async (event, options) => {
    // Forward progress events to renderer
    const progressHandler = (progress: InstallProgress) => {
      const window = BrowserWindow.fromWebContents(event.sender)
      if (window && !window.isDestroyed()) {
        event.sender.send(IPC_CHANNELS.SKILLS_CLI_PROGRESS, progress)
      }
    }

    skillsCliService.on('progress', progressHandler)

    try {
      return await skillsCliService.install(options)
    } finally {
      skillsCliService.removeListener('progress', progressHandler)
    }
  })

  typedHandle(IPC_CHANNELS.SKILLS_CLI_REMOVE, async (_, skillName) => {
    return skillsCliService.remove(skillName)
  })

  typedHandle(IPC_CHANNELS.SKILLS_CLI_CANCEL, () => {
    skillsCliService.cancel()
  })
}
