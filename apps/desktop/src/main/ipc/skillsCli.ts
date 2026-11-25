import { BrowserWindow } from 'electron'

import { runLockWrite } from '@/main/services/skillLockService'
import { skillManager } from '@/main/services/skillManager'
import { IPC_CHANNELS } from '@/shared/ipc-channels'
import type { InstallProgress, SkillInstallOutcome } from '@/shared/types'

import { typedHandle } from './typedHandle'

/**
 * AbortControllers of every in-flight install, including ones still queued
 * behind the lock-write mutex. `skills:cli:cancel` sweeps the whole set —
 * the semantic the CLI subprocess version implemented with a process sweep
 * plus a cancel generation counter. In-process, the same coverage falls out
 * of the signal itself: a queued install re-checks it the moment the mutex
 * opens, and the fetch layer is wired to it while the install runs.
 */
const activeInstallControllers = new Set<AbortController>()

/**
 * Register IPC handlers for skill marketplace operations. Channel names keep
 * their historical `skills:cli:*` shape so the preload and renderer surface
 * does not move, but everything behind them is the in-process skill manager —
 * no `npx skills` subprocess exists anymore (docs/adr/0003).
 */
export function registerSkillsCliHandlers(): void {
  typedHandle(IPC_CHANNELS.SKILLS_CLI_SEARCH, async (_, query) => {
    return skillManager.search(query)
  })

  typedHandle(IPC_CHANNELS.SKILLS_CLI_INSTALL, async (event, options) => {
    const controller = new AbortController()
    activeInstallControllers.add(controller)

    // Forward structured progress to the invoking renderer while it lives.
    const onProgress = (progress: InstallProgress): void => {
      const window = BrowserWindow.fromWebContents(event.sender)
      if (window && !window.isDestroyed()) {
        event.sender.send(IPC_CHANNELS.SKILLS_CLI_PROGRESS, progress)
      }
    }

    try {
      // Serialized against prune: both rewrite .skill-lock.json with
      // read-modify-write cycles that must never interleave.
      return await runLockWrite(async (): Promise<SkillInstallOutcome> => {
        // The user backed out while this install waited its turn behind the
        // mutex: the cancel sweep already aborted the controller, and without
        // this re-check the queue would drain into installing what they
        // cancelled.
        if (controller.signal.aborted) {
          return {
            success: false,
            results: [],
            userMessage: 'Installation cancelled.',
          }
        }
        return skillManager.install({
          source: options.repo,
          skillNames: options.skills,
          agents: options.agents,
          onProgress,
          signal: controller.signal,
        })
      })
    } finally {
      activeInstallControllers.delete(controller)
    }
  })

  typedHandle(IPC_CHANNELS.SKILLS_CLI_CANCEL, () => {
    for (const controller of activeInstallControllers) {
      controller.abort()
    }
  })
}
