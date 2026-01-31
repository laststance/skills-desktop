import { ipcMain, type IpcMainInvokeEvent, BrowserWindow } from 'electron'

import { IPC_CHANNELS } from '../../shared/ipc-channels'
import type { InstallOptions, InstallProgress } from '../../shared/types'
import { skillsCliService } from '../services/skillsCliService'

/**
 * Register IPC handlers for Skills CLI (Marketplace) operations
 */
export function registerSkillsCliHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.SKILLS_CLI_SEARCH, async (_, query: string) => {
    return skillsCliService.search(query)
  })

  ipcMain.handle(
    IPC_CHANNELS.SKILLS_CLI_INSTALL,
    async (event: IpcMainInvokeEvent, options: InstallOptions) => {
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
    },
  )

  ipcMain.handle(
    IPC_CHANNELS.SKILLS_CLI_REMOVE,
    async (_, skillName: string) => {
      return skillsCliService.remove(skillName)
    },
  )

  ipcMain.handle(IPC_CHANNELS.SKILLS_CLI_CANCEL, () => {
    skillsCliService.cancel()
  })
}
