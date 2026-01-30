import { ipcMain } from 'electron'

import { IPC_CHANNELS } from '../../shared/ipc-channels'
import { scanAgents } from '../services/agentScanner'

/**
 * Register IPC handlers for agents operations
 */
export function registerAgentsHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.AGENTS_GET_ALL, async () => {
    return scanAgents()
  })
}
