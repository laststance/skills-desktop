import type { Stats } from 'node:fs'
import * as fs from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import type { IpcMainInvokeEvent } from 'electron'
import { shell } from 'electron'
import { match } from 'ts-pattern'

import {
  AGENTS,
  SOURCE_DIR,
  findAgentById,
  isSharedAgentPath,
} from '@/main/constants'
import { getAllowedBases, validatePath } from '@/main/services/pathValidation'
import { scanSkills } from '@/main/services/skillScanner'
import { resolveRawSymlinkTarget } from '@/main/services/symlinkChecker'
import {
  moveToTrash,
  restore,
  TrashError,
  unlinkReviewedDanglingSymlink,
} from '@/main/services/trashService'
import { errorCode, isMissingPathError } from '@/main/utils/errorCode'
import { extractErrorMessage } from '@/main/utils/errors'
import { BULK_PROGRESS_THRESHOLD } from '@/shared/constants'
import { IPC_CHANNELS } from '@/shared/ipc-channels'
import type {
  AbsolutePath,
  AgentId,
  BulkDeleteItemResult,
  BulkDeleteResult,
  ClearBrokenSymlinkSlotItemResult,
  ClearOrphanSymlinkItemResult,
  BulkUnlinkItemResult,
  BulkUnlinkResult,
  RestoreDeletedSkillResult,
  SkillName,
} from '@/shared/types'

import { typedHandle } from './typedHandle'
import { typedSend } from './typedSend'

type AgentPathRemovalResult =
  | { success: true }
  | { success: false; error: string; code?: string }

/**
 * Require a renderer path to name the same derived main-process path.
 * @param rendererPath - Path supplied over IPC for backward-compatible callers
 * @param derivedPath - Path calculated from validated main-process state
 * @param subject - Human-readable path kind for error messages
 * @returns Derived path after exact normalized equality passes
 * @example assertDerivedPathMatch('/a/b', '/a/b/', 'agent path')
 */
function assertDerivedPathMatch(
  rendererPath: AbsolutePath,
  derivedPath: AbsolutePath,
  subject: string,
): AbsolutePath {
  if (resolve(rendererPath) !== resolve(derivedPath)) {
    throw new Error(
      `Renderer ${subject} does not match the selected agent slot.`,
    )
  }
  return derivedPath
}

/**
 * Require a reviewed linkPath to be one direct child of the selected agent skills dir.
 * @param rendererPath - Agent-side slot path reviewed in the renderer.
 * @param agentPath - Selected agent skills directory from main-process constants.
 * @returns Normalized rendererPath once its parent matches the selected agent dir.
 * @example assertAgentSlotPath('/Users/me/.cursor/skills/slot', '/Users/me/.cursor/skills')
 */
function assertAgentSlotPath(
  rendererPath: AbsolutePath,
  agentPath: AbsolutePath,
): AbsolutePath {
  const normalizedPath = resolve(rendererPath)
  if (dirname(normalizedPath) !== resolve(agentPath)) {
    throw new Error(
      'Renderer link path does not match the selected agent slot.',
    )
  }
  return normalizedPath as AbsolutePath
}

/**
 * Remove an agent symlink path after the caller has already validated and
 * lstat'd it. Directories are refused here so destructive local-folder removal
 * remains isolated to the single-unlink confirmation path.
 * @param linkPath - Validated path inside an agent skills directory
 * @param stats - `lstat` result for linkPath
 * @returns Structured IPC result for renderer toast handling
 * @example
 * removeLinkPathByKind('/Users/me/.cursor/skills/task', stats)
 */
async function removeLinkPathByKind(
  linkPath: AbsolutePath,
  stats: Stats,
): Promise<AgentPathRemovalResult> {
  return match({
    isSymlink: stats.isSymbolicLink(),
    isDirectory: stats.isDirectory(),
  })
    .with({ isSymlink: true }, async () => {
      await fs.unlink(linkPath)
      return { success: true } as const
    })
    .with(
      { isSymlink: false, isDirectory: true },
      async () =>
        ({
          success: false as const,
          error:
            'Cannot unlink a local skill. Use Delete to move it to trash instead.',
        }) satisfies AgentPathRemovalResult,
    )
    .otherwise(async () => ({
      success: false as const,
      error: 'Cannot remove: path is neither a symlink nor a directory',
    }))
}

/**
 * Remove the exact reviewed agent slot after validating it belongs to selected agent.
 * @param agentPath - Selected agent skills directory from main constants.
 * @param linkPath - Renderer-reviewed slot path to remove.
 * @returns Structured IPC result for bulk unlink reporting.
 * @example removeReviewedPathFromAgent('/Users/me/.cursor/skills', '/Users/me/.cursor/skills/folder-name')
 */
async function removeReviewedPathFromAgent(
  agentPath: AbsolutePath,
  linkPath: AbsolutePath,
): Promise<
  { success: true } | { success: false; error: string; code?: string }
> {
  let reviewedLinkPath: AbsolutePath
  try {
    reviewedLinkPath = assertAgentSlotPath(linkPath, agentPath)
    // Use getAllowedBases() instead of [agentPath] because validatePath
    // realpath-follows linkPath. For a legitimate agent symlink the realpath
    // lands in SOURCE_DIR (source-backed) or another agent dir (cross-agent
    // copy), both of which are valid bases. Restricting to [agentPath] alone
    // would false-positive every symlinked-skill unlink.
    validatePath(reviewedLinkPath, getAllowedBases())
  } catch (error) {
    return {
      success: false,
      error: extractErrorMessage(error, 'Invalid link path'),
    }
  }
  let stats: Stats
  try {
    stats = await fs.lstat(reviewedLinkPath)
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
    return await removeLinkPathByKind(reviewedLinkPath, stats)
  } catch (error) {
    return {
      success: false,
      error: extractErrorMessage(error),
      code: errorCode(error),
    }
  }
}

/**
 * Removes one reviewed broken symlink slot after rechecking exact slot path and target identity.
 * @param item - Reviewed broken-slot target from Symlink Health cleanup.
 * @returns Per-slot unlink result.
 * @example
 * await clearReviewedBrokenSymlinkSlot({ agentId: 'codex', linkName: 'task', linkPath: '/Users/me/.codex/skills/task', targetPath: '/Users/me/.agents/skills/task' })
 */
async function clearReviewedBrokenSymlinkSlot(item: {
  agentId: AgentId
  linkName: SkillName
  linkPath: AbsolutePath
  targetPath: AbsolutePath
}): Promise<ClearBrokenSymlinkSlotItemResult> {
  try {
    const agent = findAgentById(item.agentId)
    if (!agent) throw new TrashError('Agent not found', 'ENOENT')

    const expectedLinkPath = resolve(agent.path, item.linkName)
    if (resolve(item.linkPath) !== expectedLinkPath) {
      throw new TrashError(
        'Reviewed broken link path no longer matches agent slot',
        'ESTALE',
      )
    }

    validatePath(dirname(item.linkPath), [agent.path])

    let stats: Stats
    try {
      stats = await fs.lstat(item.linkPath)
    } catch (error) {
      if (isMissingPathError(error)) {
        return {
          agentId: item.agentId,
          skillName: item.linkName,
          linkPath: item.linkPath,
          outcome: 'unlinked',
        }
      }
      throw new TrashError(extractErrorMessage(error), errorCode(error))
    }

    if (!stats.isSymbolicLink()) {
      throw new TrashError(
        'Reviewed broken slot is no longer a symlink',
        'ESTALE',
      )
    }

    await unlinkReviewedDanglingSymlink({
      linkPath: item.linkPath,
      targetPath: item.targetPath,
      targetChangedMessage:
        'Reviewed broken link target changed. Rescan before cleanup.',
      targetExistsMessage:
        'Reviewed broken link target now exists. Rescan before cleanup.',
      targetProbePrefix: 'Cannot verify broken link target',
    })
    return {
      agentId: item.agentId,
      skillName: item.linkName,
      linkPath: item.linkPath,
      outcome: 'unlinked',
    }
  } catch (error) {
    const message =
      error instanceof TrashError ? error.message : extractErrorMessage(error)
    const code = error instanceof TrashError ? error.code : errorCode(error)
    return {
      agentId: item.agentId,
      skillName: item.linkName,
      linkPath: item.linkPath,
      outcome: 'error',
      error: code ? { message, code } : { message },
    }
  }
}

/**
 * Finds live filesystem entries that make orphan-only cleanup unsafe for one skill name.
 * @param skillName - Agent-side skill directory name selected in the cleanup dialog.
 * @returns Null when only symlinks/missing slots remain; otherwise a user-facing stale-plan reason.
 * @example
 * await findOrphanCleanupBlocker('abandoned') // => null
 */
async function findOrphanCleanupBlocker(
  skillName: SkillName,
): Promise<string | null> {
  const sourcePath = join(SOURCE_DIR, skillName)
  try {
    await fs.lstat(sourcePath)
    return 'Source skill exists. Rescan before cleanup.'
  } catch (error) {
    if (!isMissingPathError(error)) {
      return `Cannot verify source skill: ${extractErrorMessage(error)}`
    }
  }

  for (const agent of AGENTS) {
    const agentSkillPath = join(agent.path, skillName)
    try {
      const stats = await fs.lstat(agentSkillPath)
      if (stats.isSymbolicLink()) continue
      if (stats.isDirectory()) {
        return `${agent.name} has a local skill folder. Rescan before cleanup.`
      }
      return `${agent.name} has a non-symlink entry. Rescan before cleanup.`
    } catch (error) {
      if (isMissingPathError(error)) continue
      return `Cannot verify ${agent.name}: ${extractErrorMessage(error)}`
    }
  }

  return null
}

/**
 * Removes one reviewed orphan symlink after rechecking the exact agent slot and dangling target.
 * @param skillName - Skill name whose source is expected to be absent.
 * @param reviewedLink - Agent and link path reviewed by the renderer.
 * @returns Removed agent id when the link was unlinked or already gone.
 * @example
 * await clearReviewedOrphanLink('abandoned', { agentId: 'codex', linkPath: '/Users/me/.codex/skills/abandoned' })
 */
async function clearReviewedOrphanLink(
  skillName: SkillName,
  reviewedLink: {
    agentId: AgentId
    linkPath: AbsolutePath
    targetPath: AbsolutePath
  },
): Promise<AgentId> {
  const agent = findAgentById(reviewedLink.agentId)
  if (!agent) {
    throw new TrashError('Agent not found', 'ENOENT')
  }

  const expectedLinkPath = resolve(agent.path, skillName)
  if (resolve(reviewedLink.linkPath) !== expectedLinkPath) {
    throw new TrashError(
      'Reviewed link path no longer matches agent slot',
      'ESTALE',
    )
  }

  validatePath(dirname(reviewedLink.linkPath), [agent.path])

  let stats: Stats
  try {
    stats = await fs.lstat(reviewedLink.linkPath)
  } catch (error) {
    if (isMissingPathError(error)) return agent.id
    throw new TrashError(extractErrorMessage(error), errorCode(error))
  }
  if (!stats.isSymbolicLink()) {
    throw new TrashError(
      'Reviewed orphan slot is no longer a symlink',
      'ESTALE',
    )
  }

  await unlinkReviewedDanglingSymlink({
    linkPath: reviewedLink.linkPath,
    targetPath: reviewedLink.targetPath,
    targetChangedMessage:
      'Reviewed orphan link target changed. Rescan before cleanup.',
    targetExistsMessage:
      'Reviewed orphan link target now exists. Rescan before cleanup.',
    targetProbePrefix: 'Cannot verify orphan target',
    beforeTargetProbe: async () => {
      const blocker = await findOrphanCleanupBlocker(skillName)
      if (blocker) {
        throw new TrashError(blocker, 'ESTALE')
      }
    },
  })

  return agent.id
}

/**
 * Clears one reviewed orphan record without ever calling source-delete paths.
 * @param item - Skill name plus the exact orphan agent links selected in the dialog.
 * @returns Per-item cleanup outcome for the dialog summary.
 * @example
 * await clearReviewedOrphanRecord({ skillName: 'abandoned', agents: [{ agentId: 'codex', linkPath: '/Users/me/.codex/skills/abandoned', targetPath: '/Users/me/.agents/skills/abandoned' }] })
 */
async function clearReviewedOrphanRecord(item: {
  skillName: SkillName
  agents: Array<{
    agentId: AgentId
    linkPath: AbsolutePath
    targetPath: AbsolutePath
  }>
}): Promise<ClearOrphanSymlinkItemResult> {
  try {
    const blocker = await findOrphanCleanupBlocker(item.skillName)
    if (blocker) {
      throw new TrashError(blocker, 'ESTALE')
    }

    const cascadeAgents: AgentId[] = []
    for (const reviewedLink of item.agents) {
      cascadeAgents.push(
        await clearReviewedOrphanLink(item.skillName, reviewedLink),
      )
    }

    return {
      skillName: item.skillName,
      outcome: 'orphan-cleared',
      symlinksRemoved: cascadeAgents.length,
      cascadeAgents,
    }
  } catch (error) {
    const message =
      error instanceof TrashError ? error.message : extractErrorMessage(error)
    const code = error instanceof TrashError ? error.code : errorCode(error)
    return {
      skillName: item.skillName,
      outcome: 'error',
      error: code ? { message, code } : { message },
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
    const { agentId, linkPath, confirmedLocalDirectoryDelete = false } = options

    try {
      const agent = findAgentById(agentId)
      if (!agent) {
        return { success: false, error: 'Agent not found' }
      }

      const derivedLinkPath = assertAgentSlotPath(
        linkPath,
        agent.path as AbsolutePath,
      )

      // Allow agent dirs (for local skills) AND SOURCE_DIR (for symlinked skills).
      // validatePath calls realpathSync, which follows the symlink to its source
      // in ~/.agents/skills/. Without SOURCE_DIR in the allowed bases, every
      // symlinked-skill unlink fails with "Path traversal attempt detected".
      validatePath(derivedLinkPath, getAllowedBases())
      let stats: Stats
      try {
        stats = await fs.lstat(derivedLinkPath)
      } catch (error) {
        if (errorCode(error) === 'ENOENT') {
          // Already gone — match bulk unlink's idempotent no-op behavior.
          return { success: true }
        }
        throw error
      }

      if (stats.isDirectory() && !stats.isSymbolicLink()) {
        if (!confirmedLocalDirectoryDelete) {
          return {
            success: false,
            error:
              'Refusing to delete a local skill without explicit confirmation.',
          }
        }

        // Local skill deletion arrives from UnlinkDialog's destructive confirm
        // action. Move to OS Trash instead of recursively deleting bytes so a
        // mistaken confirmation is still recoverable at the filesystem level.
        await shell.trashItem(derivedLinkPath)
        return { success: true }
      }

      return await removeLinkPathByKind(derivedLinkPath, stats)
    } catch (error) {
      return { success: false, error: extractErrorMessage(error) }
    }
  })

  /**
   * Delete a specific agent's entire skills folder. Moves the directory to the
   * OS trash (macOS Finder Trash) so accidents are recoverable.
   *
   * Rejects paths that alias SOURCE_DIR or are shared across multiple agent
   * rows (see `SHARED_AGENT_PATHS`). Without this guard a "delete Cline" click
   * would wipe `~/.agents/skills` and cascade into every universal agent —
   * the exact v0.13.0 regression that motivated this handler rewrite.
   *
   * @param options - agentId, agentPath
   * @returns RemoveAllFromAgentResult with item count removed
   */
  typedHandle(IPC_CHANNELS.SKILLS_REMOVE_ALL_FROM_AGENT, async (_, options) => {
    const { agentId, agentPath } = options

    try {
      const agent = findAgentById(agentId)
      if (!agent) {
        return {
          success: false,
          removedCount: 0,
          error: 'Agent not found',
        }
      }

      const derivedAgentPath = assertDerivedPathMatch(
        agentPath,
        agent.path as AbsolutePath,
        'agent path',
      )

      const agentBases = AGENTS.map((a) => a.path)
      // validatePath throws on traversal attempts. We discard the return
      // value intentionally: SHARED_AGENT_PATHS is keyed by the resolve()-
      // normalized join() form, NOT by realpath, to avoid macOS firmlink
      // (/var → /private/var) false negatives. isSharedAgentPath handles
      // symlink aliases itself via its realpathSync fallback. Using the
      // derived raw agent path for trashItem is also safer: trashItem on a
      // symlink moves the symlink, not its target.
      validatePath(derivedAgentPath, agentBases)

      if (isSharedAgentPath(derivedAgentPath)) {
        return {
          success: false,
          removedCount: 0,
          error:
            'Refusing to delete a shared skills folder. This directory is used by the Universal source and/or multiple agents — deleting it would cascade beyond the selected agent.',
        }
      }

      // Idempotent missing-dir handling: `shell.trashItem` throws ENOENT,
      // unlike the old `fs.rm({ force: true })` this handler used to call.
      // Short-circuit when the dir is already gone so double-clicks and
      // out-of-band deletes don't surface as errors.
      try {
        await fs.access(derivedAgentPath)
      } catch {
        return { success: true, removedCount: 0 }
      }

      // Count entries before deletion for reporting
      let removedCount = 0
      try {
        const entries = await fs.readdir(derivedAgentPath)
        removedCount = entries.length
      } catch {
        // Directory may be unreadable (permissions) — proceed to trash anyway
      }

      // Move to OS trash instead of hard-rm so accidents can be restored from
      // Finder > Trash.
      await shell.trashItem(derivedAgentPath)

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
   * `moveToTrash(skillName, skillPath)` validates the reviewed row path so
   * metadata names cannot redirect deletion to a same-name folder.
   * @param options - { skillName, skillPath }
   * @returns DeleteSkillResult with symlinksRemoved + cascadeAgents
   */
  typedHandle(IPC_CHANNELS.SKILLS_DELETE, async (_, options) => {
    const { skillName, skillPath } = options
    try {
      const { cascadeAgents, symlinksRemoved } = await moveToTrash(
        skillName,
        skillPath,
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
   * @param options - items: Array<{ skillName, skillPath }>
   * @returns BulkDeleteResult with per-item discriminated outcome
   */
  typedHandle(
    IPC_CHANNELS.SKILLS_DELETE_BATCH,
    async (event: IpcMainInvokeEvent, options) => {
      const { items } = options
      const total = items.length
      const emitProgress = total >= BULK_PROGRESS_THRESHOLD
      const results: BulkDeleteItemResult[] = []

      for (const [itemIndex, { skillName, skillPath }] of items.entries()) {
        try {
          const moveResult = await moveToTrash(skillName, skillPath)
          results.push({
            skillName,
            outcome: 'deleted',
            tombstoneId: moveResult.tombstoneId,
            symlinksRemoved: moveResult.symlinksRemoved,
            cascadeAgents: moveResult.cascadeAgents,
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
   * Clear reviewed orphan symlinks without calling the source-delete path.
   * Revalidates the exact agent slots in main so a stale renderer plan cannot
   * delete live source skills or unrelated local folders.
   * @param options - orphan records and exact agent link paths reviewed by the user
   * @returns Per-orphan cleanup outcomes with no tombstones
   * @example clearOrphanSymlinks({ items: [{ skillName: 'abandoned', agents: [...] }] })
   */
  typedHandle(IPC_CHANNELS.SKILLS_CLEAR_ORPHAN_SYMLINKS, async (_, options) => {
    const results: ClearOrphanSymlinkItemResult[] = []
    for (const item of options.items) {
      results.push(await clearReviewedOrphanRecord(item))
    }
    return { items: results }
  })

  /**
   * Clear reviewed broken symlink slots with exact main-process revalidation.
   * Unlike generic unlink, this cleanup-only path refuses live, changed, or
   * inaccessible targets so restored user links are never removed.
   * @param options - exact broken slots selected in Symlink Health cleanup
   * @returns Per-slot unlink outcomes
   * @example clearBrokenSymlinkSlots({ items: [{ agentId: 'codex', linkName: 'task', linkPath, targetPath }] })
   */
  typedHandle(
    IPC_CHANNELS.SKILLS_CLEAR_BROKEN_SYMLINK_SLOTS,
    async (_, options) => {
      const results: ClearBrokenSymlinkSlotItemResult[] = []
      for (const item of options.items) {
        results.push(await clearReviewedBrokenSymlinkSlot(item))
      }
      return { items: results }
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

      for (const { skillName, linkPath } of items) {
        const outcome = await removeReviewedPathFromAgent(agent.path, linkPath)
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
          // symlink's physical parent. Resolve through realpath(dirname) so
          // symlinked config roots like Devin's ~/.config stay valid.
          const rawTarget = await fs.readlink(sourcePath)
          const resolvedTarget = await resolveRawSymlinkTarget(
            sourcePath,
            rawTarget,
          )
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
