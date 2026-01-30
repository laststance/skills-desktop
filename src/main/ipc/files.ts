import { ipcMain } from 'electron'

import { IPC_CHANNELS } from '../../shared/ipc-channels'
import { listSkillFiles, readSkillFile } from '../services/fileReader'

/**
 * Register IPC handlers for file operations
 */
export function registerFilesHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.FILES_LIST, async (_, skillPath: string) => {
    return listSkillFiles(skillPath)
  })

  ipcMain.handle(IPC_CHANNELS.FILES_READ, async (_, filePath: string) => {
    return readSkillFile(filePath)
  })
}
