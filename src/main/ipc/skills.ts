import * as fs from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import type { IpcMainInvokeEvent } from 'electron'
import { match } from 'ts-pattern'

import { BULK_PROGRESS_THRESHOLD } from '../../shared/constants'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import type {
  AbsolutePath,
  BulkDeleteItemResult,
  BulkDeleteResult,
  BulkUnlinkItemResult,
  BulkUnlinkResult,
  RestoreDeletedSkillResult,
  SkillName,
} from '../../shared/types'
import { AGENTS, findAgentById, SOURCE_DIR } from '../constants'
import { getAllowedBases, validatePath } from '../services/pathValidation'
import { scanSkills } from '../services/skillScanner'
import { moveToTrash, restore, TrashError } from '../services/trashService'
import { errorCode } from '../utils/errorCode'
import { extractErrorMessage } from '../utils/errors'

import { typedHandle } from './typedHandle'
import { typedSend } from './typedSend'

/**
 * Derive the canonical source path for a skill. Renderer never passes paths
 * for bulk ops — main always re-derives from SOURCE_DIR + skillName. This
 * closes the "renderer-supplied path" trust boundary (security CRITICAL-2).
 * @param skillName - Validated skill name (no path separators, enforced by Zod)
 * @returns Absolute path inside SOURCE_DIR
 * @example deriveSourcePath('task') // '/Users/me/.agents/skills/task'
 */
function deriveSourcePath(skillName: SkillName): string {
  return join(SOURCE_DIR, skillName)
}

/**
 * Unlink or remove a single link-path inside an agent directory. Shared by the
 * single-unlink handler and the batch-unlink handler so both behave identically.
 * @param agentPath - Validated agent skills directory (trust root)
 * @param skillName - Validated skill name (no separators)
 * @returns { success: boolean, error?: string; code?: string }
 * @example removeFromAgent('/Users/me/.cursor/skills', 'task')
 */
async function removeFromAgent(
  agentPath: AbsolutePath,
  skillName: SkillName,
): Promise<
  { success: true } | { success: false; error: string; code?: string }
> {
  const linkPath = join(agentPath, skillName)
  try {
    // Use getAllowedBases() instead of [agentPath] because validatePath
    // realpath-follows linkPath. For a legitimate agent symlink the realpath
    // lands in SOURCE_DIR (source-backed) or another agent dir (cross-agent
    // copy), both of which are valid bases. Restricting to [agentPath] alone
    // would false-positive every symlinked-skill unlink.
    validatePath(linkPath, getAllowedBases())
  } catch (error) {
    return {
      success: false,
      error: extractErrorMessage(error, 'Invalid link path'),
    }
  }
  let stats: Awaited<ReturnType<typeof fs.lstat>>
  try {
    stats = await fs.lstat(linkPath)
  } catch (error) {
    const code = errorCode(error)
    if (code === 'ENOENT') {
      // Already gone — treat as success (idempotent).
      return { success: true }
    }
    return {
      success: false,
      error: extractErrorMessage(error),
      code,
    }
  }

  try {
    // Discriminate on file-stat kind: symlink → unlink, local directory →
    // refuse (bulk unlink is non-destructive; user must go through bulk
    // Delete), everything else (files, sockets, etc.) → refuse as unsupported.
    const kindResult = await match({
      isSymlink: stats.isSymbolicLink(),
      isDirectory: stats.isDirectory(),
    })
      .with({ isSymlink: true }, async () => {
        await fs.unlink(linkPath)
        return { success: true } as const
      })
      .with({ isSymlink: false, isDirectory: true }, async () => ({
        success: false as const,
        error:
          'Cannot unlink a local skill. Use Delete to move it to trash instead.',
      }))
      .otherwise(async () => ({
        success: false as const,
        error: 'Cannot remove: path is neither a symlink nor a directory',
      }))
    return kindResult
  } catch (error) {
    return {
      success: false,
      error: extractErrorMessage(error),
      code: errorCode(error),
    }
  }
}

/**
 * Register IPC handlers for skills operations
 */
export function registerSkillsHandlers(): void {
  typedHandle(IPC_CHANNELS.SKILLS_GET_ALL, async () => {
    return scanSkills()
  })

  /**
   * Remove a skill from a specific agent by removing the symlink or local folder
   * @param options - skillName, agentId, linkPath
   * @returns UnlinkResult with success status and optional error
   */
  typedHandle(IPC_CHANNELS.SKILLS_UNLINK_FROM_AGENT, async (_, options) => {
    const { linkPath } = options

    try {
      // Allow agent dirs (for local skills) AND SOURCE_DIR (for symlinked skills).
      // validatePath calls realpathSync, which follows the symlink to its source
      // in ~/.agents/skills/. Without SOURCE_DIR in the allowed bases, every
      // symlinked-skill unlink fails with "Path traversal attempt detected".
      validatePath(linkPath, getAllowedBases())
      const stats = await fs.lstat(linkPath)
      // Discriminate on file-stat kind: symlink → unlink, directory → rm -rf
      // (destructive is OK here because the single-unlink handler has its own
      // confirmation UX in the renderer), else → refuse.
      const unlinkResult = await match({
        isSymlink: stats.isSymbolicLink(),
        isDirectory: stats.isDirectory(),
      })
        .with({ isSymlink: true }, async () => {
          await fs.unlink(linkPath)
          return { success: true } as const
        })
        .with({ isSymlink: false, isDirectory: true }, async () => {
          await fs.rm(linkPath, { recursive: true, force: true })
          return { success: true } as const
        })
        .otherwise(async () => ({
          success: false as const,
          error: 'Cannot remove: path is neither a symlink nor a directory',
        }))

      return unlinkResult
    } catch (error) {
      return { success: false, error: extractErrorMessage(error) }
    }
  })

  /**
   * Delete a specific agent's entire skills folder
   * @param options - agentId, agentPath
   * @returns RemoveAllFromAgentResult with item count removed
   */
  typedHandle(IPC_CHANNELS.SKILLS_REMOVE_ALL_FROM_AGENT, async (_, options) => {
    const { agentPath } = options

    try {
      const agentBases = AGENTS.map((a) => a.path)
      validatePath(agentPath, agentBases)
      // Count entries before deletion for reporting
      let removedCount = 0
      try {
        const entries = await fs.readdir(agentPath)
        removedCount = entries.length
      } catch {
        // Directory may not exist or be unreadable
      }

      // Delete the entire agent skills directory
      await fs.rm(agentPath, { recursive: true, force: true })

      return { success: true, removedCount }
    } catch (error) {
      return {
        success: false,
        removedCount: 0,
        error: extractErrorMessage(error),
      }
    }
  })

  /**
   * Delete a single skill by delegating to trashService so the single-delete
   * path shares the same trash/undo/eviction code as batch delete.
   *
   * `sourcePath = join(SOURCE_DIR, skillName)` is derived server-side; the
   * renderer never passes a path (security CRITICAL-2 closed, asymmetry with
   * the bulk handler resolved).
   * @param options - { skillName }
   * @returns DeleteSkillResult with symlinksRemoved + cascadeAgents
   */
  typedHandle(IPC_CHANNELS.SKILLS_DELETE, async (_, options) => {
    const { skillName } = options
    const sourcePath = deriveSourcePath(skillName)

    try {
      validatePath(sourcePath, [SOURCE_DIR])
    } catch (error) {
      return {
        success: false,
        symlinksRemoved: 0,
        cascadeAgents: [],
        error: extractErrorMessage(error),
      }
    }

    try {
      const { cascadeAgents, symlinksRemoved } = await moveToTrash(
        skillName,
        sourcePath,
      )
      return {
        success: true,
        symlinksRemoved,
        cascadeAgents,
      }
    } catch (error) {
      return {
        success: false,
        symlinksRemoved: 0,
        cascadeAgents: [],
        error:
          error instanceof TrashError
            ? error.message
            : extractErrorMessage(error),
      }
    }
  })

  /**
   * Batch delete N skills. Runs serially (for...of await) per reviewer #21 so
   * that per-item tombstone creation, agent symlink walks, and manifest writes
   * don't race each other on the same filesystem.
   *
   * Progress: emits \`skills:deleteProgress\` after each item when N >= 10 so the
   * SelectionToolbar can show "Deleting 3 of 12". Smaller batches skip the
   * event to avoid toast churn.
   * @param options - items: Array<{ skillName }>
   * @returns BulkDeleteResult with per-item discriminated outcome
   */
  typedHandle(
    IPC_CHANNELS.SKILLS_DELETE_BATCH,
    async (event: IpcMainInvokeEvent, options) => {
      const { items } = options
      const total = items.length
      const emitProgress = total >= BULK_PROGRESS_THRESHOLD
      const results: BulkDeleteItemResult[] = []

      for (const [itemIndex, { skillName }] of items.entries()) {
        const sourcePath = deriveSourcePath(skillName)

        try {
          validatePath(sourcePath, [SOURCE_DIR])
        } catch (error) {
          results.push({
            skillName,
            outcome: 'error',
            error: { message: extractErrorMessage(error) },
          })
          if (emitProgress) {
            typedSend(event.sender, IPC_CHANNELS.SKILLS_DELETE_PROGRESS, {
              current: itemIndex + 1,
              total,
            })
          }
          continue
        }

        try {
          const {
            tombstoneId: id,
            cascadeAgents,
            symlinksRemoved,
          } = await moveToTrash(skillName, sourcePath)
          results.push({
            skillName,
            outcome: 'deleted',
            tombstoneId: id,
            symlinksRemoved,
            cascadeAgents,
          })
        } catch (error) {
          const message =
            error instanceof TrashError
              ? error.message
              : extractErrorMessage(error)
          const code =
            error instanceof TrashError ? error.code : errorCode(error)
          results.push({
            skillName,
            outcome: 'error',
            error: code ? { message, code } : { message },
          })
        }

        if (emitProgress) {
          typedSend(event.sender, IPC_CHANNELS.SKILLS_DELETE_PROGRESS, {
            current: itemIndex + 1,
            total,
          })
        }
      }

      const result: BulkDeleteResult = { items: results }
      return result
    },
  )

  /**
   * Batch unlink N skills from a single agent. Unlink is benign (it only
   * removes one symlink/folder, doesn't touch the source), so no trash entry
   * is created. Runs serially for predictable error reporting.
   * @param options - agentId, items
   * @returns BulkUnlinkResult with per-item discriminated outcome
   */
  typedHandle(
    IPC_CHANNELS.SKILLS_UNLINK_MANY_FROM_AGENT,
    async (_, options) => {
      const { agentId, items } = options
      const agent = findAgentById(agentId)
      const results: BulkUnlinkItemResult[] = []

      if (!agent) {
        // No agent resolved — emit an error row per requested skill so the
        // renderer can mark each one failed individually.
        for (const { skillName } of items) {
          results.push({
            skillName,
            outcome: 'error',
            error: { message: 'Agent not found' },
          })
        }
        const result: BulkUnlinkResult = { items: results }
        return result
      }

      for (const { skillName } of items) {
        const outcome = await removeFromAgent(agent.path, skillName)
        if (outcome.success) {
          results.push({ skillName, outcome: 'unlinked' })
        } else {
          results.push({
            skillName,
            outcome: 'error',
            error: outcome.code
              ? { message: outcome.error, code: outcome.code }
              : { message: outcome.error },
          })
        }
      }

      const result: BulkUnlinkResult = { items: results }
      return result
    },
  )

  /**
   * Restore a tombstoned skill from the on-disk trash. Delegates fully to
   * trashService.restore() so the main-process logic lives in one place.
   * Zod validates \`tombstoneId\` format at the IPC boundary (path-traversal
   * block) before trashService joins it under TRASH_DIR.
   * @param options - tombstoneId (already validated by tombstoneIdSchema)
   * @returns RestoreDeletedSkillResult (discriminated on outcome)
   */
  typedHandle(
    IPC_CHANNELS.SKILLS_RESTORE_DELETED,
    async (_, options): Promise<RestoreDeletedSkillResult> => {
      return restore(options.tombstoneId)
    },
  )

  /**
   * Create symlinks for a skill to multiple agents
   * @param options - skillName, skillPath, agentIds
   * @returns CreateSymlinksResult with created count and per-agent failures
   */
  typedHandle(IPC_CHANNELS.SKILLS_CREATE_SYMLINKS, async (_, options) => {
    const { skillName, skillPath, agentIds } = options
    // Allow source skills AND local skills that live inside an agent directory.
    // The renderer's "Add" button is shown in global view for both flavors,
    // so restricting to [SOURCE_DIR] would reject every local-skill add with
    // "Path traversal attempt detected". The per-iteration validation below
    // still constrains each constructed linkPath to its target agent dir.
    validatePath(skillPath, getAllowedBases())
    let created = 0
    const failures: Array<{
      agentId: (typeof agentIds)[number]
      error: string
    }> = []

    for (const agentId of agentIds) {
      const agent = findAgentById(agentId)
      if (!agent) {
        failures.push({ agentId, error: 'Agent not found' })
        continue
      }

      const linkPath = join(agent.path, skillName)
      // Defense in depth: ensure the constructed link path stays inside the
      // target agent directory (skillName must not contain \`../\`).
      try {
        validatePath(linkPath, [agent.path])
      } catch {
        failures.push({ agentId, error: 'Invalid skill name' })
        continue
      }

      try {
        // Ensure agent skills directory exists
        await fs.mkdir(agent.path, { recursive: true })

        // Atomic: attempt symlink directly, handle EEXIST
        await fs.symlink(skillPath, linkPath)
        created++
      } catch (error) {
        if (errorCode(error) === 'EEXIST') {
          failures.push({ agentId, error: 'Already exists' })
        } else {
          failures.push({ agentId, error: extractErrorMessage(error) })
        }
      }
    }

    return { success: failures.length === 0, created, failures }
  })

  /**
   * Copy a skill source into other agents.
   * Symlinked sources → create symlink pointing to same resolved target.
   * Directory sources → physical copy while preserving nested symlinks.
   * @param options - skillName, sourcePath, targetAgentIds
   * @returns CopyToAgentsResult with copied count and per-agent failures
   * @example
   * // Symlink source: creates symlink in target agent pointing to same source
   * // Directory source: copies folder recursively to target agent
   */
  typedHandle(IPC_CHANNELS.SKILLS_COPY_TO_AGENTS, async (_, options) => {
    const { skillName, sourcePath, targetAgentIds } = options
    validatePath(sourcePath, getAllowedBases())
    let copied = 0
    const failures: Array<{
      agentId: (typeof targetAgentIds)[number]
      error: string
    }> = []

    // Detect source type. Discriminate on file-stat kind:
    //   symlink   → record target so we replicate the link
    //   directory → physical copy path (isSymlink stays false)
    //   other     → reject all targets with a per-agent failure row
    let isSymlink = false
    let symlinkTarget = ''
    try {
      const stats = await fs.lstat(sourcePath)
      const detectionOutcome = await match({
        isSymlink: stats.isSymbolicLink(),
        isDirectory: stats.isDirectory(),
      })
        .with({ isSymlink: true }, async () => {
          // `readlink` returns the raw target, which can be relative to the
          // symlink's own directory. Resolve it against `dirname(sourcePath)`
          // so validation and replication see an absolute filesystem path
          // rather than a cwd-relative string.
          const rawTarget = await fs.readlink(sourcePath)
          const resolvedTarget = resolve(dirname(sourcePath), rawTarget)
          // Validate the resolved symlink target is within allowed bases.
          // After the CREATE_SYMLINKS fix, symlinks may legitimately point at
          // either SOURCE_DIR (source skills) or another agent's dir (local
          // skills linked across agents), so [SOURCE_DIR] alone is too strict.
          validatePath(resolvedTarget, getAllowedBases())
          return { kind: 'symlink' as const, target: resolvedTarget }
        })
        .with({ isSymlink: false, isDirectory: true }, async () => ({
          kind: 'directory' as const,
        }))
        .otherwise(async () => ({ kind: 'invalid' as const }))

      if (detectionOutcome.kind === 'invalid') {
        return {
          success: false,
          copied: 0,
          failures: targetAgentIds.map((id) => ({
            agentId: id,
            error: 'Source is neither a symlink nor a directory',
          })),
        }
      }
      if (detectionOutcome.kind === 'symlink') {
        isSymlink = true
        symlinkTarget = detectionOutcome.target
      }
    } catch (error) {
      return {
        success: false,
        copied: 0,
        failures: targetAgentIds.map((id) => ({
          agentId: id,
          error: extractErrorMessage(error, 'Cannot access source skill'),
        })),
      }
    }

    for (const agentId of targetAgentIds) {
      const agent = findAgentById(agentId)
      if (!agent) {
        failures.push({ agentId, error: 'Agent not found' })
        continue
      }

      const destPath = join(agent.path, skillName)

      try {
        // Ensure agent skills directory exists
        await fs.mkdir(agent.path, { recursive: true })

        // Check if something already exists at the destination
        try {
          await fs.lstat(destPath)
          failures.push({ agentId, error: 'Already exists' })
          continue
        } catch {
          // Nothing exists, proceed
        }

        if (isSymlink) {
          await fs.symlink(symlinkTarget, destPath)
        } else {
          await fs.cp(sourcePath, destPath, {
            recursive: true,
            verbatimSymlinks: true,
          })
        }
        copied++
      } catch (error) {
        failures.push({ agentId, error: extractErrorMessage(error) })
      }
    }

    return { success: failures.length === 0, copied, failures }
  })
}
