import { IPC_CHANNELS } from '../../shared/ipc-channels'
import { scanAgents } from '../services/agentScanner'

import { typedHandle } from './typedHandle'

/**
 * Register IPC handlers for agents operations
 */
export function registerAgentsHandlers(): void {
  typedHandle(IPC_CHANNELS.AGENTS_GET_ALL, async () => {
    return scanAgents()
  })
}
