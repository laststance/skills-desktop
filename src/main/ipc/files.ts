import { IPC_CHANNELS } from '../../shared/ipc-channels'
import {
  listSkillFiles,
  readBinaryFile,
  readSkillFile,
} from '../services/fileReader'
import { getAllowedBases, validatePath } from '../services/pathValidation'

import { typedHandle } from './typedHandle'

/**
 * Register IPC handlers for file operations.
 * Every handler funnels its input through `validatePath` first, so
 * callers from the renderer cannot escape the allowed base directories
 * (skill source + agent skills dirs). See pathValidation.ts for the
 * realpath-based traversal check.
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

  typedHandle(IPC_CHANNELS.FILES_READ_BINARY, async (_, filePath) => {
    const validated = validatePath(filePath, getAllowedBases())
    return readBinaryFile(validated)
  })
}
