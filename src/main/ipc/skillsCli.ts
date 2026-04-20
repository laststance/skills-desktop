import { join } from 'node:path'

import { BrowserWindow, type IpcMainInvokeEvent } from 'electron'

import { BULK_PROGRESS_THRESHOLD } from '../../shared/constants'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import type {
  CliRemoveSkillResult,
  CliRemoveSkillsResult,
  InstallProgress,
} from '../../shared/types'
import { CLI_REMOVE_BUSY_CODE } from '../../shared/types'
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
    // Shared cancel endpoint: marketplace install and CLI remove batch both
    // call this channel. requestBatchCancel() also kills running children.
    skillsCliService.requestBatchCancel()
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
    if (skillsCliService.isBusy()) {
      return buildBusyBatchResult(
        options.items.map(({ skillName }) => skillName),
      )
    }

    skillsCliService.resetBatchCancelRequest()

    const total = options.items.length
    const emitProgress = total >= BULK_PROGRESS_THRESHOLD
    const results: CliRemoveSkillResult[] = []

    try {
      for (const [itemIndex, { skillName }] of options.items.entries()) {
        if (skillsCliService.isBatchCancelRequested()) {
          results.push({ skillName, outcome: 'cancelled' })
        } else {
          const removeResult = await removeSkillViaCli(skillName)
          // User cancellation can kill the currently-running child. Normalize
          // that in-flight item to `cancelled` so renderer summaries align
          // with user intent instead of showing a synthetic process error.
          if (
            skillsCliService.isBatchCancelRequested() &&
            removeResult.outcome === 'error'
          ) {
            results.push({ skillName, outcome: 'cancelled' })
          } else {
            results.push(removeResult)
          }
        }
        if (emitProgress) {
          sendDeleteProgressIfWindowAlive(event, itemIndex + 1, total)
        }
      }

      return { items: results } satisfies CliRemoveSkillsResult
    } finally {
      skillsCliService.resetBatchCancelRequest()
    }
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

/**
 * Build an all-error batch result for reject-on-busy policy.
 * @param skillNames - Requested skill names in dispatch order
 * @returns Per-item busy errors preserving order for deterministic UI mapping
 */
function buildBusyBatchResult(
  skillNames: CliRemoveSkillResult['skillName'][],
): CliRemoveSkillsResult {
  return {
    items: skillNames.map((skillName) => ({
      skillName,
      outcome: 'error',
      error: {
        message: 'Another CLI operation is already in progress',
        code: CLI_REMOVE_BUSY_CODE,
      },
    })),
  }
}

/**
 * Emit `skills:deleteProgress` only while the renderer window is still alive.
 * @param event - IPC invoke event carrying sender webContents
 * @param current - 1-based processed item index
 * @param total - Total items in the current batch
 */
function sendDeleteProgressIfWindowAlive(
  event: IpcMainInvokeEvent,
  current: number,
  total: number,
): void {
  // Mirror the SKILLS_CLI_INSTALL guard: a renderer closed mid-batch would
  // otherwise throw on typedSend because webContents is destroyed but
  // event.sender still holds a stale reference.
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win && !win.isDestroyed()) {
    typedSend(event.sender, IPC_CHANNELS.SKILLS_DELETE_PROGRESS, {
      current,
      total,
    })
  }
}
