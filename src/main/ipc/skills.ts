import { ipcMain } from 'electron'

import { IPC_CHANNELS } from '../../shared/ipc-channels'
import { scanSkills } from '../services/skillScanner'

/**
 * Register IPC handlers for skills operations
 */
export function registerSkillsHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.SKILLS_GET_ALL, async () => {
    return scanSkills()
  })
}
