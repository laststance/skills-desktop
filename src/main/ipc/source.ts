import { ipcMain } from 'electron'

import { IPC_CHANNELS } from '../../shared/ipc-channels'
import { getSourceStats } from '../services/skillScanner'

/**
 * Register IPC handlers for source directory operations
 */
export function registerSourceHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.SOURCE_GET_STATS, async () => {
    return getSourceStats()
  })
}
