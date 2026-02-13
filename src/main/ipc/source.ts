import { IPC_CHANNELS } from '../../shared/ipc-channels'
import { getSourceStats } from '../services/skillScanner'

import { typedHandle } from './typedHandle'

/**
 * Register IPC handlers for source directory operations
 */
export function registerSourceHandlers(): void {
  typedHandle(IPC_CHANNELS.SOURCE_GET_STATS, async () => {
    return getSourceStats()
  })
}
