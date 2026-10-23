import {
  listSkillFiles,
  readBinaryFile,
  readSkillFile,
} from '@/main/services/fileReader'
import { getAllowedBases, validatePath } from '@/main/services/pathValidation'
import {
  skillFilesScheduler,
  readSkillFileDetailed,
} from '@/main/services/skillFiles'
import { IPC_CHANNELS } from '@/shared/ipc-channels'
import { unavailableSkillFiles } from '@/shared/skillFiles'

import { typedHandle } from './typedHandle'

/**
 * Register IPC handlers for file operations.
 * Every handler funnels its input through `validatePath` first, so
 * callers from the renderer cannot escape the allowed base directories
 * (skill source + agent skills dirs). See pathValidation.ts for the
 * realpath-based traversal check.
 */
export function registerFilesHandlers(): void {
  const scheduler = skillFilesScheduler
  const owners = new WeakMap<Electron.WebContents, Set<string>>()
  /** Registers sender cleanup once and namespaces requests by the calling frame.
   * @example const owner = listingOwner(event)
   */
  const listingOwner = (event: Electron.IpcMainInvokeEvent): string => {
    const owner = `${event.sender.id}:${event.frameId}`
    let frames = owners.get(event.sender)
    if (!frames) {
      frames = new Set<string>()
      owners.set(event.sender, frames)
      event.sender.once('destroyed', () => {
        for (const frame of owners.get(event.sender) ?? [])
          scheduler.cancel(frame)
      })
    }
    frames.add(owner)
    return owner
  }
  typedHandle(IPC_CHANNELS.FILES_LIST_DETAILED, async (event, request) => {
    const owner = listingOwner(event)
    try {
      const root = validatePath(request.root, getAllowedBases())
      return await scheduler.list(owner, { ...request, root })
    } catch {
      return unavailableSkillFiles('denied')
    }
  })
  typedHandle(IPC_CHANNELS.FILES_CANCEL_LIST, (event, request) => {
    scheduler.cancel(`${event.sender.id}:${event.frameId}`, request)
  })
  typedHandle(IPC_CHANNELS.FILES_READ_DETAILED, async (_, root, path) => {
    try {
      const validatedRoot = validatePath(root, getAllowedBases())
      // Validate the target but preserve its lexical segments for nested-symlink checks.
      validatePath(path, getAllowedBases())
      return await readSkillFileDetailed(validatedRoot, path)
    } catch {
      return { status: 'error', code: 'denied' }
    }
  })
  typedHandle(IPC_CHANNELS.FILES_LIST, async (event, skillPath) => {
    const validated = validatePath(skillPath, getAllowedBases())
    return listSkillFiles(validated, listingOwner(event))
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
