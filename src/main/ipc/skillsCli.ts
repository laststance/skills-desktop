import { BrowserWindow } from 'electron'

import { runLockWrite } from '@/main/services/skillLockService'
import { skillsCliService } from '@/main/services/skillsCliService'
import { IPC_CHANNELS } from '@/shared/ipc-channels'
import type { InstallProgress } from '@/shared/types'

import { typedHandle } from './typedHandle'

/**
 * Register IPC handlers for Skills CLI (Marketplace) operations
 */
export function registerSkillsCliHandlers(): void {
  typedHandle(IPC_CHANNELS.SKILLS_CLI_SEARCH, async (_, query) => {
    return skillsCliService.search(query)
  })

  typedHandle(IPC_CHANNELS.SKILLS_CLI_INSTALL, async (event, options) => {
    // Forward progress events to renderer
    const progressHandler = (progress: InstallProgress) => {
      const window = BrowserWindow.fromWebContents(event.sender)
      if (window && !window.isDestroyed()) {
        event.sender.send(IPC_CHANNELS.SKILLS_CLI_PROGRESS, progress)
      }
    }

    skillsCliService.on('progress', progressHandler)

    // Captured before queueing: `cancel()` only reaches children that have
    // already spawned, and this install may sit behind a prune for a while.
    const queuedAtCancelGeneration = skillsCliService.cancelGeneration

    try {
      // Serialized against prune: both make the CLI rewrite .skill-lock.json,
      // and `writeSkillLock` has no temp+rename — an interleaved write parses
      // as an EMPTY lock, dropping every skill the user installed.
      return await runLockWrite(async () => {
        // The user closed the install dialog while we waited our turn. Without
        // this check the cancel hits an empty process set and is silently
        // dropped, then the queue drains and installs what they backed out of.
        if (skillsCliService.cancelGeneration !== queuedAtCancelGeneration) {
          return {
            success: false,
            stdout: '',
            stderr: 'Installation cancelled before it started.',
            code: null,
          }
        }
        return skillsCliService.install(options)
      })
    } finally {
      skillsCliService.removeListener('progress', progressHandler)
    }
  })

  typedHandle(IPC_CHANNELS.SKILLS_CLI_CANCEL, () => {
    skillsCliService.cancel()
  })
}
