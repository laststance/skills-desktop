import { join } from 'node:path'

import { BrowserWindow } from 'electron'

import { BULK_PROGRESS_THRESHOLD } from '../../shared/constants'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import type {
  CliRemoveSkillResult,
  CliRemoveSkillsResult,
  InstallProgress,
} from '../../shared/types'
import { SOURCE_DIR } from '../constants'
import { validatePath } from '../services/pathValidation'
import { skillsCliService } from '../services/skillsCliService'
import { extractErrorMessage } from '../utils/errors'

import { typedHandle } from './typedHandle'
import { typedSend } from './typedSend'

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

    try {
      return await skillsCliService.install(options)
    } finally {
      skillsCliService.removeListener('progress', progressHandler)
    }
  })

  typedHandle(IPC_CHANNELS.SKILLS_CLI_CANCEL, () => {
    skillsCliService.cancel()
  })

  /**
   * Deregister a single skill from `~/.agents/.skill-lock.json` via
   * `npx skills remove`. The CLI owns the lock-file schema, so we never
   * touch it directly.
   * @param options - { skillName }
   * @returns CliRemoveSkillResult (discriminated on outcome)
   */
  typedHandle(IPC_CHANNELS.SKILLS_CLI_REMOVE, async (_, options) => {
    return removeSkillViaCli(options.skillName)
  })

  /**
   * Batch-deregister N skills via sequential CLI spawns. Runs serially
   * because `npx skills remove` rewrites the shared `.skill-lock.json`
   * on every call — parallel spawns would race the lock file.
   *
   * Emits `SKILLS_DELETE_PROGRESS` after each item when the batch is big
   * enough to justify UI progress (>= BULK_PROGRESS_THRESHOLD). Each spawn
   * takes ~600ms–2s, so without this a 20-item batch looks hung.
   * @param options - { items: Array<{ skillName }> }
   * @returns CliRemoveSkillsResult with per-item discriminated outcome
   */
  typedHandle(IPC_CHANNELS.SKILLS_CLI_REMOVE_BATCH, async (event, options) => {
    const total = options.items.length
    const emitProgress = total >= BULK_PROGRESS_THRESHOLD
    const results: CliRemoveSkillResult[] = []

    for (const [itemIndex, { skillName }] of options.items.entries()) {
      results.push(await removeSkillViaCli(skillName))
      if (emitProgress) {
        typedSend(event.sender, IPC_CHANNELS.SKILLS_DELETE_PROGRESS, {
          current: itemIndex + 1,
          total,
        })
      }
    }

    return { items: results } satisfies CliRemoveSkillsResult
  })
}

/**
 * Defense in depth: Zod's `skillNameString` already rejects path separators,
 * but we re-validate the derived source path stays inside SOURCE_DIR before
 * spawning — a bug in Zod would still not allow escaping the trust root.
 */
async function removeSkillViaCli(
  skillName: CliRemoveSkillResult['skillName'],
): Promise<CliRemoveSkillResult> {
  try {
    validatePath(join(SOURCE_DIR, skillName), [SOURCE_DIR])
  } catch (error) {
    return {
      skillName,
      outcome: 'error',
      error: { message: extractErrorMessage(error, 'Invalid skill name') },
    }
  }
  return skillsCliService.remove(skillName)
}
