import { IPC_CHANNELS } from '../../shared/ipc-channels'
import { listSkillFiles, readSkillFile } from '../services/fileReader'

import { typedHandle } from './typedHandle'

/**
 * Register IPC handlers for file operations
 */
export function registerFilesHandlers(): void {
  typedHandle(IPC_CHANNELS.FILES_LIST, async (_, skillPath) => {
    return listSkillFiles(skillPath)
  })

  typedHandle(IPC_CHANNELS.FILES_READ, async (_, filePath) => {
    return readSkillFile(filePath)
  })
}
