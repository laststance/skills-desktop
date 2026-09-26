import { scanAgents } from '@/main/services/agentScanner'
import { removeEmptyAgentFolder } from '@/main/services/emptyAgentFolderService'
import { IPC_CHANNELS } from '@/shared/ipc-channels'

import { typedHandle } from './typedHandle'

/**
 * Register IPC handlers for agents operations
 */
export function registerAgentsHandlers(): void {
  typedHandle(IPC_CHANNELS.AGENTS_GET_ALL, async () => {
    return scanAgents()
  })
  typedHandle(IPC_CHANNELS.AGENTS_REMOVE_EMPTY_FOLDER, async (_, options) => {
    return removeEmptyAgentFolder(options)
  })
}
