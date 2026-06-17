import { randomUUID } from 'node:crypto'
import { constants, type Stats } from 'node:fs'
import * as fs from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

import type { IpcMainInvokeEvent } from 'electron'
import { shell } from 'electron'
import { match } from 'ts-pattern'

import {
  AGENTS,
  SOURCE_DIR,
  findAgentById,
  isSharedAgentPath,
} from '@/main/constants'
import {
  filesystemIdentityFromStats,
  isReviewedEntryUnchanged,
  isSameFilesystemIdentity,
} from '@/main/services/filesystemIdentity'
import { getAllowedBases, validatePath } from '@/main/services/pathValidation'
import { scanSkills } from '@/main/services/skillScanner'
import { isValidSkillDir } from '@/main/services/skillValidation'
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
  FilesystemEntryIdentity,
  SkillName,
} from '@/shared/types'

import { typedHandle } from './typedHandle'
import { typedSend } from './typedSend'

type AgentPathRemovalResult =
  | { success: true }
  | { success: false; error: string; code?: string }

/**
 * Normalize a caught error into the IPC error shape, preferring TrashError's own message/code over generic extraction, so TrashError-aware normalization lives in one place across the skills delete/clear catch blocks.
 * @param error - The caught error (unknown type).
 * @returns `{ message, code }` where code is undefined when none is available.
 * @example describeError(new TrashError('busy', 'EBUSY')) // => { message: 'busy', code: 'EBUSY' }
 */
function describeError(error: unknown): { message: string; code?: string } {
  return {
    message:
      error instanceof TrashError ? error.message : extractErrorMessage(error),
    code: error instanceof TrashError ? error.code : errorCode(error),
  }
}

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
 * Build a hidden sibling path for identity-bound destructive OS Trash commits.
 * @param reviewedPath - Original reviewed path that will be quarantined.
 * @param label - Operation label used in the hidden basename.
 * @returns Hidden same-directory path for atomic rename before commit.
 * @example buildQuarantinePath('/Users/me/.cursor/skills/task', 'unlink')
 */
function buildQuarantinePath(
  reviewedPath: AbsolutePath,
  label: string,
): AbsolutePath {
  return join(
    dirname(reviewedPath),
    `${basename(reviewedPath)}.${label}-${randomUUID()}`,
  ) as AbsolutePath
}

/**
 * Restore a quarantined path after validation or OS Trash fails. The lstat
 * pre-check + per-type guards prevent clobbering a recreated file/symlink or a
 * non-empty directory; only an empty dir recreated in the race can be replaced.
 * @param quarantinePath - Hidden same-directory path currently holding the entry.
 * @param originalPath - Original reviewed path to restore.
 * @returns true when restoration succeeds or the quarantine is already gone.
 * @example restoreQuarantinedPath('/Users/me/.cursor/skills/.task.unlink-id', '/Users/me/.cursor/skills/task')
 */
async function restoreQuarantinedPath(
  quarantinePath: AbsolutePath,
  originalPath: AbsolutePath,
): Promise<boolean> {
  try {
    await fs.lstat(originalPath)
    return false
  } catch (error) {
    if (!isMissingPathError(error)) return false
  }

  let quarantineStats: Stats
  try {
    quarantineStats = await fs.lstat(quarantinePath)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return true
    return false
  }

  try {
    if (quarantineStats.isSymbolicLink()) {
      const target = await fs.readlink(quarantinePath)
      await fs.symlink(target, originalPath)
      await fs.unlink(quarantinePath)
      return true
    }

    if (quarantineStats.isDirectory()) {
      // Atomic same-directory restore (buildQuarantinePath keeps both paths in
      // the same dir, so rename can't hit EXDEV). Replaces the previous cp+rm,
      // which could leave a half-copied tree at originalPath on a mid-copy
      // failure (ENOSPC/EACCES). The lstat pre-check makes originalPath absent
      // in the common case. In the narrow race where another process recreates
      // it first: a *non-empty* dir makes rename fail ENOTEMPTY → caught →
      // false (no-clobber preserved); an *empty* dir is silently replaced, but
      // it holds no data so nothing is lost. POSIX rename has no portable
      // no-replace flag (renameat2/renamex_np need native bindings), and
      // cp+rm's partial-tree failure is strictly worse, so rename stands.
      await fs.rename(quarantinePath, originalPath)
      return true
    }

    // File and symlink restores intentionally keep copy-then-unlink with
    // COPYFILE_EXCL / symlink's implicit EEXIST: there is a real
    // (if narrow) race where originalPath is recreated as a file/symlink after
    // the pre-check, and plain rename would SILENTLY overwrite it — exactly the
    // same-path replacement this PR exists to defend against.
    if (quarantineStats.isFile()) {
      await fs.copyFile(quarantinePath, originalPath, constants.COPYFILE_EXCL)
      await fs.unlink(quarantinePath)
      return true
    }

    return false
  } catch {
    return false
  }
}

/**
 * Move a reviewed filesystem entry to OS Trash only after quarantined identity revalidation; used when a parent folder must keep protected siblings.
 * @param entryPath - Reviewed file, symlink, or directory path to trash.
 * @param reviewedIdentity - Filesystem identity captured before the quarantine rename.
 * @param options - Human-readable stale error, directory requirement, and optional skill-directory validation.
 * @returns void when the quarantined reviewed entry reaches OS Trash.
 * @example
 * await trashReviewedFilesystemEntry('/Users/me/.cursor/skills/task', identity, { staleMessage: 'Reviewed entry changed', requireDirectory: false, validateSkillDirectory: false })
 */
async function trashReviewedFilesystemEntry(
  entryPath: AbsolutePath,
  reviewedIdentity: FilesystemEntryIdentity,
  options: {
    staleMessage: string
    requireDirectory: boolean
    validateSkillDirectory: boolean
  },
): Promise<void> {
  const quarantinePath = buildQuarantinePath(entryPath, 'trash')
  await fs.rename(entryPath, quarantinePath)

  try {
    const quarantinedStats = await fs.lstat(quarantinePath)
    if (
      (options.requireDirectory &&
        (!quarantinedStats.isDirectory() ||
          quarantinedStats.isSymbolicLink())) ||
      !isSameFilesystemIdentity(quarantinedStats, reviewedIdentity)
    ) {
      const restored = await restoreQuarantinedPath(quarantinePath, entryPath)
      throw new Error(
        restored
          ? options.staleMessage
          : `${options.staleMessage}; quarantined folder could not be restored from ${quarantinePath}`,
      )
    }
    if (
      options.validateSkillDirectory &&
      !(await isValidSkillDir(quarantinePath))
    ) {
      const restored = await restoreQuarantinedPath(quarantinePath, entryPath)
      throw new Error(
        restored
          ? 'Reviewed local skill folder is no longer a valid skill.'
          : `Reviewed local skill folder is no longer a valid skill; quarantined folder could not be restored from ${quarantinePath}`,
      )
    }

    await shell.trashItem(quarantinePath)
  } catch (error) {
    const restored = await restoreQuarantinedPath(quarantinePath, entryPath)
    if (!restored) {
      throw new Error(
        `${extractErrorMessage(error)}; quarantined folder could not be restored from ${quarantinePath}`,
      )
    }
    throw error
  }
}

/**
 * Move a reviewed directory to OS Trash only after quarantined identity revalidation.
 * @param directoryPath - Reviewed directory path to trash.
 * @param reviewedIdentity - Filesystem identity captured at review time.
 * @param options - Human-readable stale error and optional skill-directory validation.
 * @returns void when the quarantined reviewed directory reaches OS Trash.
 * @example await trashReviewedDirectory('/Users/me/.cursor/skills/task', identity, { staleMessage: 'Reviewed local skill folder changed since review', validateSkillDirectory: true })
 */
async function trashReviewedDirectory(
  directoryPath: AbsolutePath,
  reviewedIdentity: FilesystemEntryIdentity,
  options: {
    staleMessage: string
    validateSkillDirectory: boolean
  },
): Promise<void> {
  await trashReviewedFilesystemEntry(directoryPath, reviewedIdentity, {
    ...options,
    requireDirectory: true,
  })
}

/**
 * Normalize renderer-provided protected slots to direct children of the selected agent directory so only reviewed protected entries can survive deletion.
 * @param agentPath - Selected agent skills directory from main-process constants.
 * @param protectedSkillPaths - Renderer-scanned protected slots for this agent.
 * @returns Resolved direct-child paths that should remain in place.
 * @example normalizeProtectedAgentSlotPaths('/Users/me/.cursor/skills', ['/Users/me/.cursor/skills/task'])
 */
function normalizeProtectedAgentSlotPaths(
  agentPath: AbsolutePath,
  protectedSkillPaths: AbsolutePath[],
): ReadonlySet<string> {
  return new Set(
    protectedSkillPaths.map((slotPath) =>
      resolve(assertAgentSlotPath(slotPath, agentPath)),
    ),
  )
}

/**
 * Trash one unprotected direct child of an agent skills folder after capturing its current identity; this leaves protected siblings untouched.
 * @param entryPath - Direct child inside the reviewed agent skills folder.
 * @returns True when an entry was removed, false when it was already gone.
 * @example await trashUnprotectedAgentEntry('/Users/me/.cursor/skills/unlocked')
 */
async function trashUnprotectedAgentEntry(
  entryPath: AbsolutePath,
): Promise<boolean> {
  let entryStats: Stats
  try {
    entryStats = await fs.lstat(entryPath)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return false
    throw error
  }

  await trashReviewedFilesystemEntry(
    entryPath,
    filesystemIdentityFromStats(entryStats),
    {
      staleMessage: 'Reviewed agent skills folder entry changed since review.',
      requireDirectory: false,
      validateSkillDirectory: false,
    },
  )
  return true
}

/**
 * Remove an agent symlink path after the caller has already validated and
 * lstat'd it. Directories are refused here so destructive local-folder removal
 * remains isolated to the single-unlink confirmation path.
 * @param linkPath - Validated path inside an agent skills directory
 * @param stats - `lstat` result for linkPath
 * @param reviewedTargetPath - Target path captured when the symlink row was reviewed.
 * @returns Structured IPC result for renderer toast handling
 * @example
 * removeLinkPathByKind('/Users/me/.cursor/skills/task', stats, '/Users/me/.agents/skills/task')
 */
async function removeLinkPathByKind(
  linkPath: AbsolutePath,
  stats: Stats,
  reviewedTargetPath?: AbsolutePath,
): Promise<AgentPathRemovalResult> {
  return match({
    isSymlink: stats.isSymbolicLink(),
    isDirectory: stats.isDirectory(),
  })
    .with({ isSymlink: true }, async () => {
      if (!reviewedTargetPath) {
        return {
          success: false as const,
          error: 'Refusing to unlink a symlink without reviewed target path.',
          code: 'ESTALE',
        }
      }
      const quarantinePath = buildQuarantinePath(linkPath, 'unlink')
      try {
        await fs.rename(linkPath, quarantinePath)
      } catch (error) {
        if (errorCode(error) === 'ENOENT') return { success: true } as const
        throw error
      }
      try {
        const rawTarget = await fs.readlink(quarantinePath)
        const resolvedTarget = await resolveRawSymlinkTarget(
          quarantinePath,
          rawTarget,
        )
        if (resolve(resolvedTarget) !== resolve(reviewedTargetPath)) {
          const restored = await restoreQuarantinedPath(
            quarantinePath,
            linkPath,
          )
          return {
            success: false as const,
            error: restored
              ? 'Reviewed symlink target changed since review.'
              : `Reviewed symlink target changed since review; quarantined symlink could not be restored from ${quarantinePath}`,
            code: 'ESTALE',
          }
        }
        await fs.unlink(quarantinePath)
      } catch (error) {
        const restored = await restoreQuarantinedPath(quarantinePath, linkPath)
        if (!restored) {
          throw new Error(
            `${extractErrorMessage(error)}; quarantined symlink could not be restored from ${quarantinePath}`,
          )
        }
        throw error
      }
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
 * @param reviewedTargetPath - Renderer-reviewed symlink target path, required when current slot is a symlink.
 * @returns Structured IPC result for bulk unlink reporting.
 * @example removeReviewedPathFromAgent('/Users/me/.cursor/skills', '/Users/me/.cursor/skills/folder-name', '/Users/me/.agents/skills/folder-name')
 */
async function removeReviewedPathFromAgent(
  agentPath: AbsolutePath,
  linkPath: AbsolutePath,
  reviewedTargetPath?: AbsolutePath,
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
    return await removeLinkPathByKind(
      reviewedLinkPath,
      stats,
      reviewedTargetPath,
    )
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

    assertAgentSlotPath(item.linkPath, agent.path)

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
    const { message, code } = describeError(error)
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
      // react-doctor-disable-next-line react-doctor/async-await-in-loop -- short-circuiting probe over AGENTS: returns the first agent's blocker and continues otherwise, so parallelizing would lose first-blocker-wins ordering and early-exit.
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

  assertAgentSlotPath(reviewedLink.linkPath, agent.path)

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
  // Hoisted above the try so a mid-loop throw (e.g. source reappears between
  // adjacent agent unlinks) still reports the unlinks already committed to disk.
  const cascadeAgents: AgentId[] = []
  try {
    const blocker = await findOrphanCleanupBlocker(item.skillName)
    if (blocker) {
      throw new TrashError(blocker, 'ESTALE')
    }

    for (const reviewedLink of item.agents) {
      cascadeAgents.push(
        // react-doctor-disable-next-line react-doctor/async-await-in-loop -- each iteration unlinks a symlink and pushes to the shared cascadeAgents array; serial run is required so a mid-loop throw still reports the unlinks already committed.
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
    const { message, code } = describeError(error)
    // Surface any partial cleanup so the summary mirrors disk state instead of
    // reporting zero removed when N-1 of N agents already unlinked.
    return {
      skillName: item.skillName,
      outcome: 'error',
      error: code ? { message, code } : { message },
      ...(cascadeAgents.length > 0
        ? { symlinksRemoved: cascadeAgents.length, cascadeAgents }
        : {}),
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
    const { agentId, linkPath } = options

    try {
      const agent = findAgentById(agentId)
      if (!agent) {
        return { success: false, error: 'Agent not found' }
      }

      const derivedLinkPath = assertAgentSlotPath(linkPath, agent.path)

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
        if (options.confirmedLocalDirectoryDelete !== true) {
          return {
            success: false,
            error:
              'Refusing to delete a local skill without explicit confirmation.',
          }
        }
        // Pre-rename gate: catch a same-path replacement before quarantining,
        // including the reused-inode case dev+ino alone misses on ext4/CI.
        if (
          !isReviewedEntryUnchanged(stats, options.reviewedDirectoryIdentity)
        ) {
          return {
            success: false,
            error: 'Reviewed local skill folder changed since review.',
          }
        }
        if (!(await isValidSkillDir(derivedLinkPath))) {
          return {
            success: false,
            error: 'Reviewed local skill folder is no longer a valid skill.',
          }
        }

        // Quarantine before OS Trash so the commit acts on the reviewed folder,
        // not a same-path replacement created after the dialog opened.
        await trashReviewedDirectory(
          derivedLinkPath,
          options.reviewedDirectoryIdentity,
          {
            staleMessage: 'Reviewed local skill folder changed since review.',
            validateSkillDirectory: true,
          },
        )
        return { success: true }
      }

      return await removeLinkPathByKind(
        derivedLinkPath,
        stats,
        options.confirmedLocalDirectoryDelete === true
          ? undefined
          : options.targetPath,
      )
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
   * @param options - agentId, agentPath, and reviewed directory identity.
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
        agent.path,
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

      // Idempotent missing-dir handling: lstat first because shell.trashItem
      // throws ENOENT and follows no reviewed identity by itself.
      let stats: Stats
      try {
        stats = await fs.lstat(derivedAgentPath)
      } catch (error) {
        if (errorCode(error) === 'ENOENT') {
          return { success: true, removedCount: 0 }
        }
        throw error
      }
      if (!stats.isDirectory() || stats.isSymbolicLink()) {
        return {
          success: false,
          removedCount: 0,
          error: 'Reviewed agent skills path is no longer a real directory.',
        }
      }
      // Pre-rename gate: catch a same-path replacement before quarantining,
      // including the reused-inode case dev+ino alone misses on ext4/CI.
      if (!isReviewedEntryUnchanged(stats, options.filesystemIdentity)) {
        return {
          success: false,
          removedCount: 0,
          error: 'Reviewed agent skills folder changed since review.',
        }
      }

      const protectedSlotPaths = normalizeProtectedAgentSlotPaths(
        derivedAgentPath,
        options.protectedSkillPaths ?? [],
      )
      let entries: string[] = []
      try {
        entries = await fs.readdir(derivedAgentPath)
      } catch (error) {
        if (protectedSlotPaths.size > 0) {
          throw new Error(
            `Cannot inspect protected skills before deleting folder: ${extractErrorMessage(error)}`,
          )
        }
        // Directory may be unreadable (permissions) — proceed to trash anyway
      }

      const protectedExistingPaths = new Set(
        entries
          .map((entryName) => resolve(join(derivedAgentPath, entryName)))
          .filter((entryPath) => protectedSlotPaths.has(entryPath)),
      )

      if (protectedExistingPaths.size > 0) {
        let removedCount = 0
        for (const entryName of entries) {
          const entryPath = join(derivedAgentPath, entryName) as AbsolutePath
          // Protected entries stay in place so the folder remains usable.
          if (protectedExistingPaths.has(resolve(entryPath))) continue

          // react-doctor-disable-next-line react-doctor/async-await-in-loop -- serial filesystem mutations preserve predictable Trash ordering and stop on the first protected-folder delete failure.
          const removed = await trashUnprotectedAgentEntry(entryPath)
          if (removed) removedCount++
        }

        return {
          success: true,
          removedCount,
          preservedCount: protectedExistingPaths.size,
        }
      }

      // Move to OS trash instead of hard-rm, but only after quarantining the
      // exact reviewed skills folder to close same-path replacement races.
      await trashReviewedDirectory(
        derivedAgentPath,
        options.filesystemIdentity,
        {
          staleMessage: 'Reviewed agent skills folder changed since review.',
          validateSkillDirectory: false,
        },
      )

      return { success: true, removedCount: entries.length }
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
   * `moveToTrash(skillName, skillPath, filesystemIdentity)` validates the
   * reviewed row path so metadata names cannot redirect deletion to a same-name
   * folder or same-path replacement.
   * @param options - Reviewed skill name, path, and filesystem identity.
   * @returns DeleteSkillResult with symlinksRemoved + cascadeAgents
   */
  typedHandle(IPC_CHANNELS.SKILLS_DELETE, async (_, options) => {
    const { skillName, skillPath } = options
    try {
      const { cascadeAgents, symlinksRemoved } = await moveToTrash(
        skillName,
        skillPath,
        options.filesystemIdentity,
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
   * Batch delete N skills. Runs serially (for...of await) so per-item tombstone
   * creation, agent symlink walks, and manifest writes don't race each other.
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

      for (const [
        itemIndex,
        { skillName, skillPath, filesystemIdentity },
      ] of items.entries()) {
        try {
          // react-doctor-disable-next-line react-doctor/async-await-in-loop -- runs serially so per-item tombstone/symlink/manifest writes don't race; moveToTrash calls share mutable trash + manifest state.
          const moveResult = await moveToTrash(
            skillName,
            skillPath,
            filesystemIdentity,
          )
          results.push({
            skillName,
            outcome: 'deleted',
            tombstoneId: moveResult.tombstoneId,
            symlinksRemoved: moveResult.symlinksRemoved,
            cascadeAgents: moveResult.cascadeAgents,
          })
        } catch (error) {
          const { message, code } = describeError(error)
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
      // react-doctor-disable-next-line react-doctor/async-await-in-loop -- each item revalidates and unlinks cascading symlinks on disk; parallelizing fans out lstat/unlink fds (EMFILE) and loses ordered reporting for no local-fs gain.
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
        // react-doctor-disable-next-line react-doctor/async-await-in-loop -- each item revalidates and unlinks a broken slot on disk; concurrent runs risk fd fan-out and lose ordered result reporting.
        results.push(await clearReviewedBrokenSymlinkSlot(item))
      }
      return { items: results }
    },
  )

  /**
   * Batch unlink N skills from a single agent. Unlink is benign (it only
   * removes one symlink/folder, doesn't touch the source), so no trash entry
   * is created. Runs serially for predictable error reporting.
   * @param options - agentId and reviewed linkPath+targetPath items.
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

      for (const { skillName, linkPath, targetPath } of items) {
        // react-doctor-disable-next-line react-doctor/async-await-in-loop -- runs serially for predictable error reporting; removeReviewedPathFromAgent mutates the agent's symlink/folder per item.
        const outcome = await removeReviewedPathFromAgent(
          agent.path,
          linkPath,
          targetPath,
        )
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
        // react-doctor-disable-next-line react-doctor/async-await-in-loop -- iteration mutates the shared created counter and failures array (mkdir + symlink); the gain for the bounded set of local symlinks is imperceptible.
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
        // react-doctor-disable-next-line react-doctor/async-await-in-loop -- iteration mutates shared copied/failures and runs recursive fs.cp per agent; parallel recursive copies risk EMFILE for negligible local-fs benefit.
        await fs.mkdir(agent.path, { recursive: true })

        // Check if something already exists at the destination
        try {
          await fs.lstat(destPath)
          failures.push({ agentId, error: 'Already exists' })
          continue
        } catch (error) {
          if (errorCode(error) !== 'ENOENT') {
            failures.push({
              agentId,
              error: extractErrorMessage(
                error,
                'Cannot verify destination path',
              ),
            })
            continue
          }
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
