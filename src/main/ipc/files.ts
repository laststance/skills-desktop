import { IPC_CHANNELS } from '../../shared/ipc-channels'
import { listSkillFiles, readSkillFile } from '../services/fileReader'
import { getAllowedBases, validatePath } from '../services/pathValidation'

import { typedHandle } from './typedHandle'

/**
 * Register IPC handlers for file operations
 */
export function registerFilesHandlers(): void {
  typedHandle(IPC_CHANNELS.FILES_LIST, async (_, skillPath) => {
    const validated = validatePath(skillPath, getAllowedBases())
    return listSkillFiles(validated)
  })

  typedHandle(IPC_CHANNELS.FILES_READ, async (_, filePath) => {
    const validated = validatePath(filePath, getAllowedBases())
    return readSkillFile(validated)
  })
}
