import { randomBytes } from 'node:crypto'
import { constants, type Stats } from 'node:fs'
import * as fs from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

import { match } from 'ts-pattern'
import type { z } from 'zod'

import { AGENTS, SOURCE_DIR } from '@/main/constants'
import { manifestSchema } from '@/main/ipc/ipc-schemas'
import { errorCode, isMissingPathError } from '@/main/utils/errorCode'
import { extractErrorMessage } from '@/main/utils/errors'
import { UNDO_WINDOW_MS } from '@/shared/constants'
import { tombstoneId } from '@/shared/types'
import type {
  AbsolutePath,
  AgentId,
  FilesystemEntryIdentity,
  RestoreDeletedSkillResult,
  SkillName,
  TombstoneId,
  UnixTimestampMs,
} from '@/shared/types'

import {
  isReviewedEntryUnchanged,
  isSameFilesystemIdentity,
} from './filesystemIdentity'
import { getAllowedBases, validatePath } from './pathValidation'
import { isValidSkillDir } from './skillValidation'
import { resolveRawSymlinkTarget } from './symlinkChecker'

/** Root of the on-disk trash. Created lazily on first delete. */
const TRASH_DIR = join(homedir(), '.agents', '.trash')

/**
 * Stable error code for a manifest that cannot be parsed (bad JSON or fails
 * Zod). Lets tests assert on `error.code` instead of free-form message text.
 */
const ERR_MANIFEST_CORRUPT = 'EMANIFEST_CORRUPT'

/** Stable code for a quarantined cleanup candidate that could not be restored. */
const ERR_CLEANUP_RESTORE_FAILED = 'ECLEANUP_RESTORE_FAILED'

/** How long a tombstone lives before being evicted in-session (ms). Matches E1 undo window. */
const TRASH_TTL_MS = UNDO_WINDOW_MS

/** Max age for startup-cleanup to preserve orphaned entries across restarts (ms). */
const STARTUP_CLEANUP_MAX_AGE_MS = 24 * 60 * 60 * 1000

/** Concurrency bound for the startup cleanup sweep. */
const STARTUP_CLEANUP_CONCURRENCY = 4

/** Number of random bytes in the `rand8hex` suffix (4 bytes = 8 hex chars). */
const RAND_SUFFIX_BYTES = 4

/** Marker file for trash entries that contain data the user must recover by hand. */
const MANUAL_RECOVERY_MARKER = '.manual-recovery'

/**
 * In-process map of scheduled evict timers. Keys are tombstone ids; values are
 * the NodeJS timer handle so explicit restore/evict can cancel the TTL timer.
 * @example
 * evictTimers.set(id, setTimeout(() => evict(id), TRASH_TTL_MS))
 */
const evictTimers = new Map<TombstoneId, NodeJS.Timeout>()

/**
 * Copy a recovery directory without overwriting anything already at destination.
 * @param source - Staged source directory to copy from.
 * @param destination - Destination that must be absent before the copy starts.
 * @returns Promise that resolves only when no destination entry was overwritten.
 * @example await copyDirectoryNoOverwrite('/trash/source', '/Users/me/.agents/skills/task')
 */
async function copyDirectoryNoOverwrite(
  source: string,
  destination: string,
): Promise<void> {
  await fs.cp(source, destination, {
    recursive: true,
    force: false,
    errorOnExist: true,
    verbatimSymlinks: true,
  })
}

/**
 * Restore a moved cleanup candidate without overwriting a recreated destination.
 * @param movedPath - Temporary same-directory path currently holding the entry.
 * @param destination - Original reviewed slot that must still be absent.
 * @returns Promise that resolves after the moved entry is restored and removed.
 * @example await restorePathNoOverwrite('/agent/task.cleanup-id', '/agent/task')
 */
async function restorePathNoOverwrite(
  movedPath: string,
  destination: string,
): Promise<void> {
  const stats = await fs.lstat(movedPath)

  if (stats.isSymbolicLink()) {
    const target = await fs.readlink(movedPath)
    await fs.symlink(target, destination)
    await fs.unlink(movedPath)
    return
  }

  if (stats.isDirectory()) {
    await copyDirectoryNoOverwrite(movedPath, destination)
    await fs.rm(movedPath, { recursive: true, force: true })
    return
  }

  if (stats.isFile()) {
    await fs.copyFile(movedPath, destination, constants.COPYFILE_EXCL)
    await fs.unlink(movedPath)
    return
  }

  throw new TrashError(
    `Cleanup stopped, but the moved entry type cannot be restored safely from ${movedPath}.`,
    'EINVAL',
  )
}

/**
 * Record of a symlink that existed before delete, used to rebuild the agent's
 * skills directory on undo.
 */
export interface RecordedSymlink {
  agentId: AgentId
  linkPath: AbsolutePath
  // `target` is whatever string was passed to `fs.symlink` when the link was
  // created — it may be absolute OR relative. fs.readlink returns it verbatim,
  // so narrowing to AbsolutePath would state a contract readlink cannot guarantee.
  target: string
  /** Resolved target captured for orphan cleanup revalidation; not required in persisted manifests. */
  targetPath?: AbsolutePath
}

/**
 * Record of a real (non-symlink) skill folder under an agent dir that was
 * moved into the trash. Used for local-only skills (no `~/.agents/skills/<name>`
 * source exists; the skill lives directly in one or more agent directories).
 */
export interface RecordedLocalCopy {
  agentId: AgentId
  linkPath: AbsolutePath
  /** Scan-time directory identity, used to reject same-path replacements. */
  filesystemIdentity?: FilesystemEntryIdentity
}

/**
 * Reviewed delete identity after path validation; keeps source-backed and
 * agent-local destructive flows separate so one cannot masquerade as the other.
 */
type DeleteIdentity =
  | {
      kind: 'source'
      filesystemSkillName: SkillName
      sourcePath: AbsolutePath
    }
  | {
      kind: 'agent-local'
      filesystemSkillName: SkillName
      reviewedLocalCopy: RecordedLocalCopy
    }

/**
 * Build a unique trash entry name from skillName + current clock + random suffix.
 * `rand8hex` prevents same-ms collisions on fast machines (reviewer iter-2 HIGH-4).
 * @param skillName - Validated skill name (no path separators)
 * @returns Entry basename safe to use under TRASH_DIR
 * @example buildEntryName('theme-generator') // '1729180800000-theme-generator-a1b2c3d4'
 */
function buildEntryName(skillName: SkillName): string {
  const deletedAtMs = Date.now()
  const randSuffix = randomBytes(RAND_SUFFIX_BYTES).toString('hex')
  return `${deletedAtMs}-${skillName}-${randSuffix}`
}

/**
 * Narrow a path basename back to a SkillName after IPC path validation supplied the parent.
 * @param absolutePath - Reviewed source or agent slot path.
 * @returns Basename safe for name-derived filesystem scans.
 * @example skillNameFromPathBasename('/Users/me/.agents/skills/folder-name')
 */
function skillNameFromPathBasename(absolutePath: AbsolutePath): SkillName {
  const name = basename(absolutePath)
  if (
    name.length === 0 ||
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('\0')
  ) {
    throw new TrashError('Reviewed skill path has an invalid basename')
  }
  return name as SkillName
}

/**
 * Resolve a reviewed renderer path into the filesystem identity used for deletion.
 * @param reviewedSkillPath - Source or local folder path from the reviewed row.
 * @returns Reviewed filesystem identity for the exact destructive flow.
 * @example resolveDeleteIdentity('/Users/me/.agents/skills/folder-basename')
 */
function resolveDeleteIdentity(
  reviewedSkillPath: AbsolutePath,
): DeleteIdentity {
  const normalizedPath = resolve(reviewedSkillPath) as AbsolutePath
  const sourceDir = resolve(SOURCE_DIR)
  if (dirname(normalizedPath) === sourceDir) {
    validatePath(normalizedPath, [SOURCE_DIR])
    return {
      kind: 'source',
      filesystemSkillName: skillNameFromPathBasename(normalizedPath),
      sourcePath: normalizedPath,
    }
  }

  const agent = AGENTS.find(
    (agent) => dirname(normalizedPath) === resolve(agent.path),
  )
  if (agent) {
    validatePath(normalizedPath, [agent.path])
    const filesystemSkillName = skillNameFromPathBasename(normalizedPath)
    return {
      kind: 'agent-local',
      filesystemSkillName,
      reviewedLocalCopy: {
        agentId: agent.id,
        linkPath: normalizedPath,
      },
    }
  }

  throw new TrashError('Reviewed skill path is outside known skill directories')
}

/**
 * Revalidate a reviewed source/local skill folder before moving it to trash.
 * @param reviewedPath - Exact path displayed in the confirmation dialog.
 * @param reviewedIdentity - lstat identity captured when the row was scanned.
 * @returns Current stats when the same valid skill directory is still present.
 * @throws TrashError when the path changed, became invalid, or is not a directory.
 * @example await assertReviewedSkillDirectory('/Users/me/.agents/skills/task', identity)
 */
async function assertReviewedSkillDirectory(
  reviewedPath: AbsolutePath,
  reviewedIdentity: FilesystemEntryIdentity,
): Promise<Stats> {
  let stats: Stats
  try {
    stats = await fs.lstat(reviewedPath)
  } catch (error) {
    const code = errorCode(error)
    throw new TrashError(
      code === 'ENOENT'
        ? 'Reviewed skill folder not found (already changed?)'
        : `Failed to inspect reviewed skill folder: ${extractErrorMessage(error)}`,
      code,
    )
  }

  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new TrashError(
      'Reviewed skill path is no longer a real skill directory',
      'ESTALE',
    )
  }
  // Pre-staging gate: reject a same-path rm+mkdir replacement even when the
  // OS recycled the inode number (ext4/CI), which dev+ino alone would miss.
  if (!isReviewedEntryUnchanged(stats, reviewedIdentity)) {
    throw new TrashError('Reviewed skill folder changed since review', 'ESTALE')
  }
  if (!(await isValidSkillDir(reviewedPath))) {
    throw new TrashError(
      'Reviewed skill directory is no longer a valid skill',
      'ESTALE',
    )
  }

  return stats
}

/**
 * Build a hidden sibling stage path so reviewed entries can be atomically renamed before copy/delete work.
 * @param reviewedPath - Original reviewed directory path.
 * @param label - Short operation label for diagnostics.
 * @returns Hidden path in the same parent directory as the reviewed entry.
 * @example buildSiblingStagePath('/Users/me/.agents/skills/task', 'trash')
 */
function buildSiblingStagePath(
  reviewedPath: AbsolutePath,
  label: string,
): string {
  const suffix = randomBytes(RAND_SUFFIX_BYTES).toString('hex')
  return join(
    dirname(reviewedPath),
    `.${basename(reviewedPath)}.${label}-${suffix}`,
  )
}

/**
 * Verify a staged directory is still the entry the user reviewed before committing a destructive move.
 * @param stagedPath - Directory path after an atomic rename/quarantine step.
 * @param reviewedIdentity - Filesystem identity captured at review time.
 * @param staleMessage - Error shown when the staged entry is not the reviewed one.
 * @returns void after identity and directory-kind checks pass.
 * @example
 * await assertStagedReviewedDirectory('/tmp/.task.stage', reviewedIdentity, 'Reviewed skill folder changed since review')
 */
async function assertStagedReviewedDirectory(
  stagedPath: string,
  reviewedIdentity: FilesystemEntryIdentity,
  staleMessage: string,
): Promise<void> {
  const stagedStats = await fs.lstat(stagedPath)
  if (
    !stagedStats.isDirectory() ||
    stagedStats.isSymbolicLink() ||
    !isSameFilesystemIdentity(stagedStats, reviewedIdentity)
  ) {
    throw new TrashError(staleMessage, 'ESTALE')
  }
}

/**
 * Mark a trash entry as non-evictable because it contains manual recovery data.
 * @param entryDir - Trash entry directory that must survive TTL/startup cleanup.
 * @param reason - Human-readable recovery reason for operators and tests.
 * @returns Promise that resolves after the marker is written or best-effort logged.
 * @example await markManualRecoveryEntry(entryDir, 'source rollback failed')
 */
async function markManualRecoveryEntry(
  entryDir: string,
  reason: string,
): Promise<void> {
  const markerPath = join(entryDir, MANUAL_RECOVERY_MARKER)
  const body = `manual recovery required\nreason: ${reason}\nmarkedAt: ${new Date().toISOString()}\n`
  try {
    await fs.writeFile(markerPath, body, 'utf-8')
  } catch (error) {
    console.warn('trashService: failed to mark manual recovery entry', {
      entryDir,
      code: errorCode(error),
      message: extractErrorMessage(error),
    })
  }
}

/**
 * Check whether startup cleanup must leave a trash entry for manual recovery.
 * @param entryDir - Trash entry directory under TRASH_DIR.
 * @returns true when the marker exists or cannot be checked safely.
 * @example await hasManualRecoveryMarker('/Users/me/.agents/.trash/...')
 */
async function hasManualRecoveryMarker(entryDir: string): Promise<boolean> {
  try {
    await fs.access(join(entryDir, MANUAL_RECOVERY_MARKER))
    return true
  } catch (error) {
    const code = errorCode(error)
    if (code === 'ENOENT') return false
    console.warn('trashService: manual recovery marker check failed', {
      entryDir,
      code,
      message: extractErrorMessage(error),
    })
    return true
  }
}

/**
 * Restore a staged directory without letting same-device rename replace a recreated empty destination.
 * @param source - Staged directory that should be returned to the user-visible slot.
 * @param destination - Destination path that must still be absent when copied.
 * @returns Promise that resolves after source is removed only when the no-overwrite copy succeeds.
 * @example await moveDirectoryNoOverwrite('/tmp/staged', '/Users/me/.claude/skills/task')
 */
async function moveDirectoryNoOverwrite(
  source: string,
  destination: string,
): Promise<void> {
  await copyDirectoryNoOverwrite(source, destination)
  await fs.rm(source, { recursive: true, force: true })
}

interface SourceMoveFailure {
  error: TrashError
  preserveEntryDirForManualRecovery: boolean
}

/**
 * Move a source folder into a trash entry while preserving staged EXDEV recovery copies.
 * @param sourcePath - Reviewed skill source directory to move.
 * @param entrySourceDir - Destination `<entryDir>/source` directory.
 * @returns null on success, otherwise a failure object describing cleanup safety.
 * @example await moveSourceIntoTrashEntry('/Users/me/.agents/skills/x', '/Users/me/.agents/.trash/id/source')
 */
async function moveSourceIntoTrashEntry(
  sourcePath: AbsolutePath,
  entrySourceDir: string,
  reviewedIdentity: FilesystemEntryIdentity,
): Promise<SourceMoveFailure | null> {
  try {
    await fs.rename(sourcePath, entrySourceDir)
    try {
      await assertStagedReviewedDirectory(
        entrySourceDir,
        reviewedIdentity,
        'Reviewed skill folder changed since review',
      )
    } catch (identityError) {
      try {
        await moveDirectoryNoOverwrite(entrySourceDir, sourcePath)
      } catch {
        return {
          preserveEntryDirForManualRecovery: true,
          error:
            identityError instanceof TrashError
              ? identityError
              : new TrashError(
                  `Failed to validate staged source: ${extractErrorMessage(identityError)}`,
                  errorCode(identityError),
                ),
        }
      }
      return {
        preserveEntryDirForManualRecovery: false,
        error:
          identityError instanceof TrashError
            ? identityError
            : new TrashError(
                `Failed to validate staged source: ${extractErrorMessage(identityError)}`,
                errorCode(identityError),
              ),
      }
    }
    return null
  } catch (error) {
    const code = errorCode(error)

    if (code === 'EXDEV') {
      let preserveEntryDirForManualRecovery = false
      const siblingStagePath = buildSiblingStagePath(sourcePath, 'trash-source')
      try {
        // Cross-device fallback still starts with a same-directory rename, so
        // the original reviewed entry is isolated before any copy/remove work.
        await fs.rename(sourcePath, siblingStagePath)
        try {
          await assertStagedReviewedDirectory(
            siblingStagePath,
            reviewedIdentity,
            'Reviewed skill folder changed since review',
          )
        } catch (identityError) {
          await moveDirectoryNoOverwrite(siblingStagePath, sourcePath)
          return {
            preserveEntryDirForManualRecovery: false,
            error:
              identityError instanceof TrashError
                ? identityError
                : new TrashError(
                    `Failed to validate staged source: ${extractErrorMessage(identityError)}`,
                    errorCode(identityError),
                  ),
          }
        }
        await copyDirectoryNoOverwrite(siblingStagePath, entrySourceDir)
        preserveEntryDirForManualRecovery = true
        await fs.rm(siblingStagePath, { recursive: true, force: true })
        return null
      } catch (fallbackError) {
        try {
          await fs.lstat(siblingStagePath)
          await moveDirectoryNoOverwrite(siblingStagePath, sourcePath)
        } catch (restoreError) {
          if (errorCode(restoreError) !== 'ENOENT') {
            preserveEntryDirForManualRecovery = true
          }
        }
        const recoveryHint = preserveEntryDirForManualRecovery
          ? `; source copy preserved in ${entrySourceDir}`
          : ''
        return {
          preserveEntryDirForManualRecovery,
          error: new TrashError(
            `Failed to move source to trash (cross-device): ${extractErrorMessage(fallbackError)}${recoveryHint}`,
            errorCode(fallbackError),
          ),
        }
      }
    }

    if (code === 'ENOENT') {
      return {
        preserveEntryDirForManualRecovery: false,
        error: new TrashError('Skill not found (already deleted?)', code),
      }
    }

    return {
      preserveEntryDirForManualRecovery: false,
      error: new TrashError(
        `Failed to move source to trash: ${extractErrorMessage(error)}`,
        code,
      ),
    }
  }
}

/**
 * Best-effort re-create symlinks that were unlinked during `moveToTrash` when
 * the subsequent rename/copy failed. Keeps going on per-link errors and only
 * logs them — the caller is about to throw the original move error and we
 * must not mask it.
 * @param links - Symlinks recorded (and already removed) before the rename
 * @example
 * // Called when fs.rename(source, trashEntry) throws EACCES:
 * await rollbackRemovedSymlinks(recordedSymlinks)
 */
async function rollbackRemovedSymlinks(
  links: RecordedSymlink[],
): Promise<void> {
  for (const link of links) {
    try {
      await fs.mkdir(dirname(link.linkPath), { recursive: true })
      await fs.symlink(link.target, link.linkPath)
    } catch (error) {
      console.warn('trashService: rollback symlink failed', {
        agentId: link.agentId,
        linkPath: link.linkPath,
        code: errorCode(error),
        message: extractErrorMessage(error),
      })
    }
  }
}

/**
 * Best-effort rename each previously-moved local copy back to its original
 * agent linkPath. Mirrors `rollbackRemovedSymlinks` for the local-only flow.
 * Errors are logged per copy and the function never throws — the caller is
 * about to surface the original failure and that must not be masked.
 *
 * Returns the subset of copies that could NOT be restored. The caller MUST
 * use this list to decide whether the staged trash entry is still the only
 * surviving copy of the data: if any restore failed, the staged folder under
 * `<entryDir>/local-copies/<agentId>/` is the user's only remaining copy and
 * the entryDir MUST NOT be deleted.
 * @param entryDir - Trash entry root (contains `local-copies/<agentId>/`)
 * @param copies - Local copies that were moved during the failing forward pass
 * @returns The copies whose restore failed (empty array means full success)
 */
async function rollbackMovedLocalCopies(
  entryDir: string,
  copies: RecordedLocalCopy[],
): Promise<RecordedLocalCopy[]> {
  const unrestoredCopies: RecordedLocalCopy[] = []
  for (const copy of copies) {
    const stagedPath = join(entryDir, 'local-copies', copy.agentId)
    try {
      await fs.mkdir(dirname(copy.linkPath), { recursive: true })
      await moveDirectoryNoOverwrite(stagedPath, copy.linkPath)
    } catch (error) {
      console.warn('trashService: rollback local copy failed', {
        agentId: copy.agentId,
        linkPath: copy.linkPath,
        code: errorCode(error),
        message: extractErrorMessage(error),
      })
      unrestoredCopies.push(copy)
    }
  }
  return unrestoredCopies
}

/**
 * Tombstoned result from source-backed or local-only delete.
 * @example { kind: 'tombstoned', tombstoneId, cascadeAgents: ['cursor'], symlinksRemoved: 1 }
 */
export type MoveToTrashResult = {
  kind: 'tombstoned'
  tombstoneId: TombstoneId
  cascadeAgents: AgentId[]
  symlinksRemoved: number
}

/**
 * Restore a moved cleanup candidate when post-rename validation finds stale state.
 * @param linkPath - Original agent slot reviewed before cleanup.
 * @param movedPath - Same-directory temporary path created during guarded commit.
 * @returns void after the moved entry is restored or a TrashError explains why it could not be.
 * @example
 * await restoreMovedCleanupCandidate('/agent/skill', '/agent/skill.cleanup-deadbeef')
 */
async function restoreMovedCleanupCandidate(
  linkPath: AbsolutePath,
  movedPath: AbsolutePath,
): Promise<void> {
  try {
    await fs.lstat(linkPath)
    throw new TrashError(
      `Cleanup stopped after the reviewed slot changed. Moved entry left at ${movedPath} because ${linkPath} is occupied.`,
      'ESTALE',
    )
  } catch (error) {
    if (error instanceof TrashError) throw error
    if (!isMissingPathError(error)) {
      throw new TrashError(
        `Cleanup stopped, but ${linkPath} could not be checked before restoring the moved entry: ${extractErrorMessage(error)}`,
        errorCode(error),
      )
    }
  }

  try {
    await restorePathNoOverwrite(movedPath, linkPath)
  } catch (error) {
    throw new TrashError(
      `Cleanup stopped, but the moved entry could not be restored at ${linkPath}: ${extractErrorMessage(error)}`,
      errorCode(error),
    )
  }
}

/**
 * Read and verify the exact reviewed symlink target at the destructive slot.
 * @param options - Reviewed link path, target path, and stale-target message.
 * @returns Raw and resolved target for the still-reviewed symlink.
 * @example
 * await readReviewedDanglingSymlink({ linkPath, targetPath, targetChangedMessage })
 */
export async function readReviewedDanglingSymlink(options: {
  linkPath: AbsolutePath
  targetPath: AbsolutePath
  targetChangedMessage: string
}): Promise<{ rawTarget: string; resolvedTarget: AbsolutePath }> {
  let stats: Stats
  try {
    stats = await fs.lstat(options.linkPath)
  } catch (error) {
    if (isMissingPathError(error)) {
      throw new TrashError('Reviewed cleanup slot is already missing', 'ENOENT')
    }
    throw new TrashError(extractErrorMessage(error), errorCode(error))
  }

  if (!stats.isSymbolicLink()) {
    throw new TrashError(
      'Reviewed cleanup slot is no longer a symlink',
      'ESTALE',
    )
  }

  let rawTarget: string
  try {
    rawTarget = await fs.readlink(options.linkPath)
  } catch (error) {
    if (isMissingPathError(error)) {
      throw new TrashError('Reviewed cleanup slot is already missing', 'ENOENT')
    }
    throw new TrashError(
      'Reviewed cleanup slot is no longer a symlink',
      'ESTALE',
    )
  }

  const resolvedTarget = await resolveRawSymlinkTarget(
    options.linkPath,
    rawTarget,
  )
  if (resolve(resolvedTarget) !== resolve(options.targetPath)) {
    throw new TrashError(options.targetChangedMessage, 'ESTALE')
  }

  return { rawTarget, resolvedTarget }
}

/**
 * Compare paths by filesystem identity when possible, falling back to resolve().
 * @param leftPath - First path to compare.
 * @param rightPath - Second path to compare.
 * @returns true when both paths identify the same filesystem target.
 * @example await pathsReferenceSameTarget('/tmp/a-link-target', '/tmp/a')
 */
async function pathsReferenceSameTarget(
  leftPath: AbsolutePath,
  rightPath: AbsolutePath,
): Promise<boolean> {
  const normalizeForIdentity = async (path: AbsolutePath): Promise<string> => {
    try {
      return await fs.realpath(path)
    } catch {
      return resolve(path)
    }
  }

  return (
    (await normalizeForIdentity(leftPath)) ===
    (await normalizeForIdentity(rightPath))
  )
}

/**
 * Read and verify a source-backed agent symlink still points to the source.
 * @param linkPath - Candidate agent symlink path.
 * @param sourcePath - Source skill directory being moved to trash.
 * @returns Raw and resolved target for manifest recording.
 * @example await readReviewedSourceSymlink(linkPath, sourcePath)
 */
async function readReviewedSourceSymlink(
  linkPath: AbsolutePath,
  sourcePath: AbsolutePath,
): Promise<{ rawTarget: string; resolvedTarget: AbsolutePath }> {
  let stats: Stats
  try {
    stats = await fs.lstat(linkPath)
  } catch (error) {
    if (isMissingPathError(error)) {
      throw new TrashError(
        'Source-backed agent symlink is already missing',
        'ENOENT',
      )
    }
    throw new TrashError(extractErrorMessage(error), errorCode(error))
  }

  if (!stats.isSymbolicLink()) {
    throw new TrashError(
      'Source-backed agent slot is no longer a symlink',
      'ESTALE',
    )
  }

  let rawTarget: string
  try {
    rawTarget = await fs.readlink(linkPath)
  } catch (error) {
    if (isMissingPathError(error)) {
      throw new TrashError(
        'Source-backed agent symlink is already missing',
        'ENOENT',
      )
    }
    throw new TrashError(
      'Source-backed agent slot is no longer a symlink',
      'ESTALE',
    )
  }

  const resolvedTarget = await resolveRawSymlinkTarget(linkPath, rawTarget)
  if (!(await pathsReferenceSameTarget(resolvedTarget, sourcePath))) {
    throw new TrashError(
      'Source-backed agent symlink no longer points to the source being deleted',
      'ESTALE',
    )
  }

  return { rawTarget, resolvedTarget }
}

/**
 * Quarantine, revalidate, then unlink one source-owned agent symlink.
 * @param linkPath - Candidate symlink path under an agent skills directory.
 * @param sourcePath - Source directory whose matching symlinks may be removed.
 * @returns Missing status or the raw target removed for manifest restore.
 * @example await unlinkReviewedSourceSymlink(linkPath, sourcePath)
 */
async function unlinkReviewedSourceSymlink(
  linkPath: AbsolutePath,
  sourcePath: AbsolutePath,
): Promise<'missing' | { outcome: 'unlinked'; target: string }> {
  try {
    await readReviewedSourceSymlink(linkPath, sourcePath)
  } catch (error) {
    if (isMissingPathError(error)) return 'missing'
    throw error
  }

  const movedPath =
    `${linkPath}.cleanup-${randomBytes(4).toString('hex')}` as AbsolutePath

  try {
    await fs.rename(linkPath, movedPath)
  } catch (error) {
    if (isMissingPathError(error)) return 'missing'
    throw new TrashError(extractErrorMessage(error), errorCode(error))
  }

  try {
    const movedReviewed = await readReviewedSourceSymlink(movedPath, sourcePath)
    await fs.unlink(movedPath)
    return { outcome: 'unlinked', target: movedReviewed.rawTarget }
  } catch (error) {
    try {
      await restoreMovedCleanupCandidate(linkPath, movedPath)
    } catch (restoreError) {
      throw new TrashError(
        extractErrorMessage(restoreError),
        ERR_CLEANUP_RESTORE_FAILED,
      )
    }
    throw error
  }
}

/**
 * Assert the reviewed symlink target is still absent and cleanup-safe.
 * @param resolvedTarget - Absolute target path resolved from the reviewed symlink.
 * @param targetExistsMessage - Stale message when the source target reappears.
 * @param targetProbePrefix - Prefix for non-missing probe failures.
 * @returns void when the target remains missing.
 * @example
 * await assertReviewedTargetMissing('/Users/me/.agents/skills/task', 'Target exists', 'Cannot verify target')
 */
export async function assertReviewedTargetMissing(
  resolvedTarget: AbsolutePath,
  targetExistsMessage: string,
  targetProbePrefix: string,
): Promise<void> {
  try {
    await fs.access(resolvedTarget)
    throw new TrashError(targetExistsMessage, 'ESTALE')
  } catch (error) {
    if (error instanceof TrashError) throw error
    if (!isMissingPathError(error)) {
      throw new TrashError(
        `${targetProbePrefix}: ${extractErrorMessage(error)}`,
        errorCode(error),
      )
    }
  }
}

/**
 * Commit cleanup by moving the candidate, validating the moved entry, then unlinking it.
 * @param options - Reviewed path and target messages for final validation.
 * @returns void after the moved, verified symlink is removed.
 * @example
 * await commitReviewedDanglingSymlink({ linkPath, targetPath, targetChangedMessage, targetExistsMessage, targetProbePrefix })
 */
export async function commitReviewedDanglingSymlink(options: {
  linkPath: AbsolutePath
  targetPath: AbsolutePath
  targetChangedMessage: string
  targetExistsMessage: string
  targetProbePrefix: string
}): Promise<void> {
  const movedPath =
    `${options.linkPath}.cleanup-${randomBytes(4).toString('hex')}` as AbsolutePath

  try {
    await fs.rename(options.linkPath, movedPath)
  } catch (error) {
    if (isMissingPathError(error)) return
    throw new TrashError(extractErrorMessage(error), errorCode(error))
  }

  try {
    const movedReviewed = await readReviewedDanglingSymlink({
      linkPath: movedPath,
      targetPath: options.targetPath,
      targetChangedMessage: options.targetChangedMessage,
    })
    await assertReviewedTargetMissing(
      movedReviewed.resolvedTarget,
      options.targetExistsMessage,
      options.targetProbePrefix,
    )
    await fs.unlink(movedPath)
  } catch (error) {
    await restoreMovedCleanupCandidate(options.linkPath, movedPath)
    throw error
  }
}

/**
 * Revalidate and unlink one reviewed dangling symlink while protecting same-path replacements.
 * @param options - Exact reviewed path/target plus messages for stale-target cases.
 * @returns `missing` when the slot was already gone; otherwise `unlinked`.
 * @example
 * await unlinkReviewedDanglingSymlink({ linkPath, targetPath, targetChangedMessage, targetExistsMessage, targetProbePrefix })
 */
export async function unlinkReviewedDanglingSymlink(options: {
  linkPath: AbsolutePath
  targetPath: AbsolutePath
  targetChangedMessage: string
  targetExistsMessage: string
  targetProbePrefix: string
  beforeTargetProbe?: () => Promise<void>
}): Promise<'missing' | 'unlinked'> {
  try {
    const reviewed = await readReviewedDanglingSymlink(options)

    await options.beforeTargetProbe?.()

    await assertReviewedTargetMissing(
      reviewed.resolvedTarget,
      options.targetExistsMessage,
      options.targetProbePrefix,
    )

    const finalReviewed = await readReviewedDanglingSymlink(options)
    await assertReviewedTargetMissing(
      finalReviewed.resolvedTarget,
      options.targetExistsMessage,
      options.targetProbePrefix,
    )

    await commitReviewedDanglingSymlink(options)
  } catch (error) {
    if (isMissingPathError(error)) return 'missing'
    if (error instanceof TrashError) throw error
    const code = errorCode(error)
    // A concurrent folder replacement should never be moved or removed.
    if (code === 'EISDIR' || code === 'EPERM' || code === 'EINVAL') {
      throw new TrashError(
        'Reviewed cleanup slot is no longer a symlink',
        'ESTALE',
      )
    }
    throw new TrashError(extractErrorMessage(error), code)
  }

  return 'unlinked'
}

/**
 * Move a skill into the on-disk trash. The skill may be in one of two states:
 *
 * - **source-backed** (`kind: 'tombstoned'`): `~/.agents/skills/<name>` exists;
 *   agent entries are symlinks pointing at it. Move source + unlink every
 *   symlink. Writes a v2 manifest, schedules TTL evict, supports undo.
 * - **local-only** (`kind: 'tombstoned'`): no source dir; one or more agents
 *   hold the skill as a real folder. Move every real folder into
 *   `<entryDir>/local-copies/<agentId>/`. Writes a v2 manifest, supports undo.
 * Orphan symlink cleanup is intentionally outside this function and uses exact
 * reviewed link+target records, not a source/local delete path.
 *
 * @param skillName - Display skill name selected in the UI.
 * @param reviewedSkillPath - Mandatory reviewed source/local folder path.
 * @param reviewedIdentity - Directory identity captured when the row was reviewed.
 * @returns Tombstoned source-backed or local-only result.
 * @throws TrashError when the skill cannot be located in any form, or any
 *   filesystem op fails non-recoverably mid-move
 * @example
 * // source-backed
 * const result = await moveToTrash('theme-generator', reviewedPath, reviewedIdentity)
 * // { kind: 'tombstoned', tombstoneId: '1729...-theme-generator-a1b2c3d4', cascadeAgents: ['cursor'], symlinksRemoved: 1 }
 * @example
 * // local-only (skill lives in ~/.claude/skills/architecture-decision-records)
 * const result = await moveToTrash('architecture-decision-records', localPath, reviewedIdentity)
 * // { kind: 'tombstoned', tombstoneId: '1729...-architecture-decision-records-...', cascadeAgents: ['claude'], symlinksRemoved: 1 }
 */
export async function moveToTrash(
  skillName: SkillName,
  reviewedSkillPath: AbsolutePath,
  reviewedIdentity: FilesystemEntryIdentity,
): Promise<MoveToTrashResult> {
  // Destructive actions use the reviewed filesystem path when the renderer has
  // one; display metadata can differ from the source/slot folder basename.
  const deleteIdentity = resolveDeleteIdentity(reviewedSkillPath)

  if (deleteIdentity.kind === 'agent-local') {
    await assertReviewedSkillDirectory(
      deleteIdentity.reviewedLocalCopy.linkPath,
      reviewedIdentity,
    )
    // Local rows are reviewed one folder at a time; never sweep sibling agent
    // folders that merely share the same basename.
    return moveLocalOnlyToTrash(skillName, [
      {
        ...deleteIdentity.reviewedLocalCopy,
        filesystemIdentity: reviewedIdentity,
      },
    ])
  }

  const { sourcePath } = deleteIdentity

  // A reviewed source row must still be the same valid directory the user saw.
  await assertReviewedSkillDirectory(sourcePath, reviewedIdentity)

  return moveSourceBackedToTrash(skillName, sourcePath, reviewedIdentity)
}

/**
 * Remove agent symlinks that still point at the reviewed source folder.
 * @param sourcePath - Reviewed source directory being moved to trash.
 * @returns Recorded symlinks plus agent IDs for manifest and UI reporting.
 * @param skillName - Display/metadata name reviewed by the user.
 * @param sourcePath - Reviewed source folder moved to the trash entry.
 * @returns Removed symlink manifest records and affected agent ids.
 * @example await removeSourceBackedAgentSymlinks('metadata-title', '/Users/me/.agents/skills/folder-basename')
 */
async function removeSourceBackedAgentSymlinks(
  skillName: SkillName,
  sourcePath: AbsolutePath,
): Promise<{
  recordedSymlinks: RecordedSymlink[]
  cascadeAgentIds: AgentId[]
}> {
  const sourceFolderName = skillNameFromPathBasename(sourcePath)
  const candidateSlotNames = Array.from(new Set([sourceFolderName, skillName]))
  const recordedSymlinks: RecordedSymlink[] = []
  const cascadeAgentIds: AgentId[] = []
  const cascadeAgentIdSet = new Set<AgentId>()
  const processedLinkPaths = new Set<string>()

  for (const agent of AGENTS) {
    for (const slotName of candidateSlotNames) {
      // fallow-ignore-next-line code-duplication
      const linkPath = join(agent.path, slotName)
      if (processedLinkPaths.has(linkPath)) continue
      processedLinkPaths.add(linkPath)
      // Use getAllowedBases() — validatePath realpath-follows linkPath. A valid
      // source-backed symlink resolves into SOURCE_DIR, which isn't under the
      // individual agent.path. Restricting to [agent.path] alone would false-
      // positive every legitimate symlink and silently skip cascade cleanup.
      try {
        validatePath(linkPath, getAllowedBases())
      } catch {
        continue
      }

      let stats: Stats
      try {
        stats = await fs.lstat(linkPath)
      } catch (error) {
        // Link doesn't exist — roll forward.
        const code = errorCode(error)
        if (code === 'ENOENT') continue
        throw new TrashError(
          `Failed to inspect symlink: ${extractErrorMessage(error)}`,
          code,
        )
      }

      if (!stats.isSymbolicLink()) {
        // Local skills in agent dirs are unrelated to the source-backed delete.
        continue
      }

      let removal: 'missing' | { outcome: 'unlinked'; target: string }
      try {
        removal = await unlinkReviewedSourceSymlink(
          linkPath as AbsolutePath,
          sourcePath,
        )
      } catch (error) {
        const code = errorCode(error)
        if (code === 'ENOENT' || code === 'ESTALE') {
          // Stale/mismatched same-name links belong to another source or changed
          // after scan. Leave them for manual review instead of cascading.
          continue
        }
        await rollbackRemovedSymlinks(recordedSymlinks)
        throw new TrashError(
          `Failed to remove symlinks: ${extractErrorMessage(error)}`,
          code,
        )
      }
      if (removal === 'missing') continue
      recordedSymlinks.push({
        agentId: agent.id,
        linkPath,
        target: removal.target,
      })
      if (!cascadeAgentIdSet.has(agent.id)) {
        cascadeAgentIdSet.add(agent.id)
        cascadeAgentIds.push(agent.id)
      }
    }
  }

  return { recordedSymlinks, cascadeAgentIds }
}

/**
 * Source-backed path of `moveToTrash`. Walks agent dirs, removes symlinks,
 * renames the source dir into the entry, writes a v2 source-backed manifest.
 * Same lifecycle as the original v0.13.x implementation, just gated on the
 * source-existed branch in the wrapper.
 */
async function moveSourceBackedToTrash(
  skillName: SkillName,
  sourcePath: AbsolutePath,
  reviewedIdentity: FilesystemEntryIdentity,
): Promise<Extract<MoveToTrashResult, { kind: 'tombstoned' }>> {
  // fallow-ignore-next-line code-duplication
  const startTime = Date.now()
  await fs.mkdir(TRASH_DIR, { recursive: true, mode: 0o755 })

  const entryName = buildEntryName(skillName)
  const entryDir = join(TRASH_DIR, entryName)
  const entrySourceDir = join(entryDir, 'source')
  const manifestPath = join(entryDir, 'manifest.json')

  // Walk agents, collect + remove symlinks. Abort on non-ENOENT unlink failure.
  const { recordedSymlinks, cascadeAgentIds } =
    await removeSourceBackedAgentSymlinks(skillName, sourcePath)

  // Atomically move source → trash entry. On EXDEV, copy + remove.
  // If the move fails, the symlinks we already unlinked would otherwise be
  // lost. Best-effort re-create them before re-throwing so the user is not
  // left with a half-deleted skill (source still on disk but agents unlinked).
  await fs.mkdir(entryDir, { recursive: true })
  const sourceMoveFailure = await moveSourceIntoTrashEntry(
    sourcePath,
    entrySourceDir,
    reviewedIdentity,
  )
  if (sourceMoveFailure !== null) {
    // Rollback symlinks, but never delete an entry that now holds the recovery
    // copy created by the EXDEV fallback.
    await rollbackRemovedSymlinks(recordedSymlinks)
    if (sourceMoveFailure.preserveEntryDirForManualRecovery) {
      await markManualRecoveryEntry(
        entryDir,
        'source EXDEV fallback copied to trash but removing original failed',
      )
    } else {
      await fs.rm(entryDir, { recursive: true, force: true }).catch(() => {
        // entryDir cleanup is best-effort — caller already has the real error.
      })
    }
    throw sourceMoveFailure.error
  }

  // Write manifest. If this fails after the source was already moved in, we
  // are in a state with no manifest, no evict timer, and removed symlinks —
  // restore would be impossible. Roll back (source → original path, re-create
  // symlinks, drop trash entry) before surfacing the error to the caller.
  const manifest = {
    schemaVersion: 2 as const,
    kind: 'source-backed' as const,
    deletedAt: Date.now(),
    skillName,
    sourcePath,
    symlinks: recordedSymlinks,
  }
  try {
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8')
  } catch (manifestWriteError) {
    const manifestWriteCode = errorCode(manifestWriteError)
    const manifestWriteMessage = extractErrorMessage(manifestWriteError)

    // Step 1: restore the source back without clobbering a recreated slot.
    let restoreSourceFailed = false
    try {
      await moveDirectoryNoOverwrite(entrySourceDir, sourcePath)
    } catch (restoreError) {
      restoreSourceFailed = true
      console.error(
        'trashService: manifest write rollback — failed to restore source',
        {
          skillName,
          entryName,
          code: errorCode(restoreError),
          message: extractErrorMessage(restoreError),
        },
      )
    }

    // Step 2: re-create the symlinks we removed. Best-effort; already logs per link.
    await rollbackRemovedSymlinks(recordedSymlinks)

    // Step 3: drop only fully rolled-back entries. If source restore failed,
    // entrySourceDir is the manual recovery path and must survive this error.
    if (!restoreSourceFailed) {
      await fs.rm(entryDir, { recursive: true, force: true }).catch(() => {
        // entry cleanup is best-effort — caller already has the real error.
      })
    } else {
      await markManualRecoveryEntry(
        entryDir,
        'source manifest rollback failed to restore original path',
      )
    }

    // If we couldn't put the source back the user is in a broken state. Flag
    // it in the thrown error so the caller surfaces "manual recovery" to the UI.
    const prefix = restoreSourceFailed
      ? `Failed to write trash manifest; source is stranded in ${entrySourceDir}`
      : 'Failed to write trash manifest'
    throw new TrashError(
      `${prefix}: ${manifestWriteMessage}`,
      manifestWriteCode,
    )
  }

  const id = tombstoneId(entryName)

  // Schedule TTL evict.
  const timer = setTimeout(() => {
    void evict(id)
  }, TRASH_TTL_MS)
  evictTimers.set(id, timer)

  console.info('trashService: moveToTrash (source-backed)', {
    skillName,
    entryName,
    symlinkCount: recordedSymlinks.length,
    durationMs: Date.now() - startTime,
  })

  return {
    kind: 'tombstoned',
    tombstoneId: id,
    cascadeAgents: cascadeAgentIds,
    symlinksRemoved: recordedSymlinks.length,
  }
}

/**
 * Local-only path of `moveToTrash`. The skill exists only as real folders
 * inside one or more agent dirs (no `~/.agents/skills/<name>` source).
 *
 * Lifecycle:
 * 1. `mkdir(<entryDir>/local-copies)` to host the staged folders.
 * 2. For each `RecordedLocalCopy`, `fs.rename(linkPath → <entryDir>/local-copies/<agentId>)`.
 *    On EXDEV: cp + rm fallback. On per-copy failure: rollback (rename already-moved
 *    copies back to their linkPaths) before throwing.
 * 3. Write v2 local-only manifest. On manifest-write failure: rollback all moved
 *    copies and drop the entry dir.
 * 4. Schedule TTL evict timer.
 *
 * `cascadeAgents` is the list of agents whose local copies were moved;
 * `symlinksRemoved` carries the same count for parity with the source-backed
 * return shape (the renderer treats it as "things removed from agent dirs").
 */
async function moveLocalOnlyToTrash(
  skillName: SkillName,
  localCopies: RecordedLocalCopy[],
): Promise<Extract<MoveToTrashResult, { kind: 'tombstoned' }>> {
  // fallow-ignore-next-line code-duplication
  const startTime = Date.now()
  await fs.mkdir(TRASH_DIR, { recursive: true, mode: 0o755 })

  const entryName = buildEntryName(skillName)
  const entryDir = join(TRASH_DIR, entryName)
  const localCopiesRoot = join(entryDir, 'local-copies')
  const manifestPath = join(entryDir, 'manifest.json')

  await fs.mkdir(localCopiesRoot, { recursive: true })

  // Move each agent's real folder into <entryDir>/local-copies/<agentId>/.
  // Track successfully-moved copies so a mid-loop failure can be rolled back.
  const moved: RecordedLocalCopy[] = []
  for (const copy of localCopies) {
    const stagedPath = join(localCopiesRoot, copy.agentId)
    if (!copy.filesystemIdentity) {
      const unrestoredCopies = await rollbackMovedLocalCopies(entryDir, moved)
      if (unrestoredCopies.length === 0) {
        await fs.rm(entryDir, { recursive: true, force: true }).catch(() => {
          // best-effort cleanup
        })
      } else {
        await markManualRecoveryEntry(
          entryDir,
          'local-only rollback left staged copies in trash',
        )
      }
      throw new TrashError(
        'Reviewed local skill folder is missing filesystem identity',
        'ESTALE',
      )
    }
    const reviewedFilesystemIdentity = copy.filesystemIdentity
    try {
      await fs.rename(copy.linkPath, stagedPath)
      moved.push(copy)
      await assertStagedReviewedDirectory(
        stagedPath,
        reviewedFilesystemIdentity,
        'Reviewed local skill folder changed since review',
      )
    } catch (error) {
      const code = errorCode(error)
      // EXDEV across volumes — fall back to cp + rm. ENOENT means the copy
      // disappeared mid-flight (race); skip and continue rather than abort.
      const recoveryOutcome = await match(code)
        .with('EXDEV', async () => {
          const siblingStagePath = buildSiblingStagePath(
            copy.linkPath,
            `trash-local-${copy.agentId}`,
          )
          let stagedCopyCreated = false
          try {
            // Rename inside the original agent dir first; this binds the copy
            // to the reviewed identity before non-atomic cross-device copy.
            await fs.rename(copy.linkPath, siblingStagePath)
            try {
              await assertStagedReviewedDirectory(
                siblingStagePath,
                reviewedFilesystemIdentity,
                'Reviewed local skill folder changed since review',
              )
            } catch (identityError) {
              await moveDirectoryNoOverwrite(siblingStagePath, copy.linkPath)
              return {
                kind: 'fatal' as const,
                preserveEntryDir: false,
                strandedAgentId: copy.agentId,
                error:
                  identityError instanceof TrashError
                    ? identityError
                    : new TrashError(
                        `Failed to validate staged local copy (agent=${copy.agentId}): ${extractErrorMessage(identityError)}`,
                        errorCode(identityError),
                      ),
              }
            }
            await copyDirectoryNoOverwrite(siblingStagePath, stagedPath)
            stagedCopyCreated = true
            await fs.rm(siblingStagePath, { recursive: true, force: true })
            return { kind: 'moved' as const }
          } catch (fallbackError) {
            try {
              await fs.lstat(siblingStagePath)
              await moveDirectoryNoOverwrite(siblingStagePath, copy.linkPath)
            } catch (restoreError) {
              if (errorCode(restoreError) !== 'ENOENT') {
                stagedCopyCreated = true
              }
            }
            const recoveryHint = stagedCopyCreated
              ? `; staged copy preserved in ${stagedPath}`
              : ''
            return {
              kind: 'fatal' as const,
              preserveEntryDir: stagedCopyCreated,
              strandedAgentId: copy.agentId,
              error: new TrashError(
                `Failed to move local copy (cross-device, agent=${copy.agentId}): ${extractErrorMessage(fallbackError)}${recoveryHint}`,
                errorCode(fallbackError),
              ),
            }
          }
        })
        .with('ENOENT', async () => ({ kind: 'race-skip' as const }))
        .otherwise(async () => ({
          kind: 'fatal' as const,
          preserveEntryDir: false,
          strandedAgentId: copy.agentId,
          error: new TrashError(
            `Failed to move local copy (agent=${copy.agentId}): ${extractErrorMessage(error)}`,
            code,
          ),
        }))

      if (recoveryOutcome.kind === 'fatal') {
        const unrestoredCopies = await rollbackMovedLocalCopies(entryDir, moved)
        if (
          unrestoredCopies.length === 0 &&
          !recoveryOutcome.preserveEntryDir
        ) {
          // All copies restored — safe to drop the staged entry dir.
          await fs.rm(entryDir, { recursive: true, force: true }).catch(() => {
            // best-effort cleanup
          })
          throw recoveryOutcome.error
        }
        // One or more copies could not be restored. The staged folder under
        // <entryDir>/local-copies/<agentId>/ is the ONLY remaining copy of
        // the user's data. Preserve entryDir and surface a recovery hint so
        // the caller (and ultimately the UI) can guide the user to it.
        await markManualRecoveryEntry(
          entryDir,
          'local-only EXDEV fallback or rollback left staged copies in trash',
        )
        const strandedAgents = Array.from(
          new Set([
            ...unrestoredCopies.map((copy) => copy.agentId),
            ...(recoveryOutcome.preserveEntryDir
              ? [recoveryOutcome.strandedAgentId]
              : []),
          ]),
        ).join(', ')
        throw new TrashError(
          `${recoveryOutcome.error.message}; local copy/copies stranded in ${entryDir}/local-copies (agents: ${strandedAgents})`,
          recoveryOutcome.error.code,
        )
      }
      if (recoveryOutcome.kind === 'moved') {
        moved.push(copy)
      }
      // race-skip: copy vanished, leave moved unchanged.
    }
  }

  if (moved.length === 0) {
    // Every copy raced away — nothing to tombstone.
    await fs.rm(entryDir, { recursive: true, force: true }).catch(() => {
      // best-effort cleanup
    })
    throw new TrashError('Skill not found (already deleted?)', 'ENOENT')
  }

  const manifest = {
    schemaVersion: 2 as const,
    kind: 'local-only' as const,
    deletedAt: Date.now(),
    skillName,
    localCopies: moved.map(({ agentId, linkPath }) => ({ agentId, linkPath })),
  }
  try {
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8')
  } catch (manifestWriteError) {
    const manifestWriteCode = errorCode(manifestWriteError)
    const manifestWriteMessage = extractErrorMessage(manifestWriteError)

    const unrestoredCopies = await rollbackMovedLocalCopies(entryDir, moved)
    if (unrestoredCopies.length === 0) {
      // All copies restored — safe to drop the staged entry dir.
      await fs.rm(entryDir, { recursive: true, force: true }).catch(() => {
        // best-effort cleanup
      })
      throw new TrashError(
        `Failed to write trash manifest: ${manifestWriteMessage}`,
        manifestWriteCode,
      )
    }
    // Manifest write failed AND rollback could not restore every copy. The
    // staged folder is the ONLY remaining copy of the user's data — keep
    // entryDir intact so they can recover manually from local-copies/.
    await markManualRecoveryEntry(
      entryDir,
      'local-only manifest rollback left staged copies in trash',
    )
    const strandedAgents = unrestoredCopies
      .map((copy) => copy.agentId)
      .join(', ')
    throw new TrashError(
      `Failed to write trash manifest: ${manifestWriteMessage}; ${unrestoredCopies.length} local copy/copies stranded in ${entryDir}/local-copies (agents: ${strandedAgents})`,
      manifestWriteCode,
    )
  }

  const id = tombstoneId(entryName)
  const timer = setTimeout(() => {
    void evict(id)
  }, TRASH_TTL_MS)
  evictTimers.set(id, timer)

  console.info('trashService: moveToTrash (local-only)', {
    skillName,
    entryName,
    localCopyCount: moved.length,
    durationMs: Date.now() - startTime,
  })

  return {
    kind: 'tombstoned',
    tombstoneId: id,
    cascadeAgents: moved.map((c) => c.agentId),
    symlinksRemoved: moved.length,
  }
}

/**
 * Permanently remove a trash entry (TTL expiry or explicit evict).
 * Idempotent — calling evict twice is safe.
 * @param id - Tombstone id (already validated via Zod at IPC boundary)
 * @example evict(tombstoneId('1729180800000-task-a1b2c3d4'))
 */
export async function evict(id: TombstoneId): Promise<void> {
  const entryDir = join(TRASH_DIR, id)
  const timer = evictTimers.get(id)
  if (timer) {
    clearTimeout(timer)
    evictTimers.delete(id)
  }
  try {
    await fs.rm(entryDir, { recursive: true, force: true })
  } catch (error) {
    console.error('trashService: evict failed', {
      tombstoneId: id,
      code: errorCode(error),
      message: extractErrorMessage(error),
    })
  }
}

/**
 * Restore a tombstoned skill from the on-disk trash.
 *
 * Preconditions checked in order (first failure is fatal for this item):
 * (a) Entry dir exists.
 * (b) Manifest readable + schema-valid (Zod).
 *
 * Dispatches to source-backed or local-only flow based on `manifest.kind`.
 * Per-record skips (collision, missing target, tampered path) are counted in
 * `symlinksSkipped`; the operation is reported as `outcome: 'restored'` even
 * if zero records succeeded — the entry has at least been moved out of trash.
 *
 * @param id - Tombstone id (already validated)
 * @returns RestoreDeletedSkillResult (discriminated union on `outcome`)
 * @example
 * const result = await restore(tombstoneId('1729...'))
 * // { outcome: 'restored', symlinksRestored: 2, symlinksSkipped: 1 }
 */
export async function restore(
  id: TombstoneId,
): Promise<RestoreDeletedSkillResult> {
  const startTime = Date.now()
  const entryDir = join(TRASH_DIR, id)
  const manifestPath = join(entryDir, 'manifest.json')

  // (a) Entry exists.
  try {
    await fs.stat(entryDir)
  } catch (error) {
    const code = errorCode(error)
    if (code === 'ENOENT') {
      return {
        outcome: 'error',
        error: { message: 'Trash entry missing', code },
      }
    }
    return {
      outcome: 'error',
      error: { message: extractErrorMessage(error), code },
    }
  }

  // (b) Manifest readable + parses.
  let manifest: z.infer<typeof manifestSchema>
  try {
    const raw = await fs.readFile(manifestPath, 'utf-8')
    const parsedJson: unknown = JSON.parse(raw)
    manifest = manifestSchema.parse(parsedJson)
  } catch {
    // Use a stable code so tests don't have to regex on the message text
    // (JSON.parse / Zod error codes are not stable across runtimes).
    return {
      outcome: 'error',
      error: {
        message: 'Trash manifest corrupted',
        code: ERR_MANIFEST_CORRUPT,
      },
    }
  }

  // Dispatch on manifest.kind. Both branches own their own cleanup + timer
  // cancellation so the wrapper stays a thin router.
  const result = await match(manifest)
    .with({ kind: 'source-backed' }, async (m) =>
      restoreSourceBacked(id, entryDir, m),
    )
    .with({ kind: 'local-only' }, async (m) =>
      restoreLocalOnly(id, entryDir, m),
    )
    .exhaustive()

  console.info('trashService: restore', {
    tombstoneId: id,
    kind: manifest.kind,
    durationMs: Date.now() - startTime,
  })

  return result
}

/**
 * Restore a source-backed tombstone: rename `<entryDir>/source` back to its
 * original `~/.agents/skills/<name>` path, then walk the manifest's recorded
 * symlinks and recreate each in its agent dir. Per-link skips are counted but
 * never abort the operation.
 */
async function restoreSourceBacked(
  id: TombstoneId,
  entryDir: string,
  manifest: Extract<z.infer<typeof manifestSchema>, { kind: 'source-backed' }>,
): Promise<RestoreDeletedSkillResult> {
  const entrySourceDir = join(entryDir, 'source')

  // Validate sourcePath is within SOURCE_DIR specifically — skill sources
  // always live there. A tampered manifest could otherwise claim sourcePath
  // is in an agent dir and restore would happily plant the files there.
  // MUST run before the lstat probe below so a forged path like `/etc/...`
  // can't even trigger a filesystem existence check — defense in depth.
  try {
    validatePath(manifest.sourcePath, [SOURCE_DIR])
  } catch {
    return {
      outcome: 'error',
      error: { message: 'Invalid source path in manifest' },
    }
  }

  // Source path free? Use lstat so a dangling symlink still blocks restore.
  try {
    await fs.lstat(manifest.sourcePath)
    return {
      outcome: 'error',
      error: {
        message: 'A skill already exists at the original path',
        code: 'EEXIST',
      },
    }
  } catch (error) {
    const code = errorCode(error)
    if (code !== 'ENOENT') {
      return {
        outcome: 'error',
        error: { message: extractErrorMessage(error), code },
      }
    }
    // ENOENT = free, proceed.
  }

  // Restore source back through the same no-overwrite helper as local-only.
  try {
    await moveDirectoryNoOverwrite(entrySourceDir, manifest.sourcePath)
  } catch (error) {
    return {
      outcome: 'error',
      error: { message: extractErrorMessage(error), code: errorCode(error) },
    }
  }

  // Recreate symlinks per-record. Skip collisions or missing targets.
  let symlinksRestored = 0
  let symlinksSkipped = 0
  for (const link of manifest.symlinks) {
    const agent = AGENTS.find((a) => a.id === link.agentId)
    if (!agent) {
      symlinksSkipped++
      continue
    }
    // Re-validate linkPath against agent base (defense against tampered manifest).
    try {
      validatePath(link.linkPath, [agent.path])
    } catch {
      symlinksSkipped++
      continue
    }
    // Ensure the parent exists before resolving relative targets. Devin-style
    // symlinked config parents need a real directory for realpath(dirname).
    try {
      await fs.mkdir(agent.path, { recursive: true })
    } catch {
      symlinksSkipped++
      continue
    }

    // Re-validate target stays inside SOURCE_DIR. Per-link resolver failures
    // skip the link instead of aborting after the source has already restored.
    let resolvedTarget: AbsolutePath
    try {
      resolvedTarget = await resolveRawSymlinkTarget(link.linkPath, link.target)
      validatePath(resolvedTarget, [SOURCE_DIR])
    } catch {
      symlinksSkipped++
      continue
    }
    // Target exists? Use the already-resolved absolute path so relative
    // symlink targets (e.g. '../skills/foo') are checked against the actual
    // location on disk, not accidentally against CWD.
    try {
      await fs.access(resolvedTarget)
    } catch {
      symlinksSkipped++
      continue
    }
    // linkPath free?
    try {
      await fs.lstat(link.linkPath)
      // Something is there; skip.
      symlinksSkipped++
      continue
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') {
        symlinksSkipped++
        continue
      }
    }
    try {
      await fs.symlink(link.target, link.linkPath)
      symlinksRestored++
    } catch {
      symlinksSkipped++
    }
  }

  await finalizeRestore(id, entryDir)

  return {
    outcome: 'restored',
    symlinksRestored,
    symlinksSkipped,
  }
}

/**
 * Restore a local-only tombstone: for each `localCopies[i]`, rename
 * `<entryDir>/local-copies/<agentId>/` back to its original `linkPath`.
 * Per-copy collisions or unknown agents skip cleanly. Partial restores keep
 * the tombstone directory so skipped staged folders stay recoverable by hand.
 *
 * Reuses `symlinksRestored`/`symlinksSkipped` for parity with source-backed
 * — both fields semantically count "agent-side restorations" regardless of
 * whether the underlying op was a symlink or a directory rename.
 */
async function restoreLocalOnly(
  id: TombstoneId,
  entryDir: string,
  manifest: Extract<z.infer<typeof manifestSchema>, { kind: 'local-only' }>,
): Promise<RestoreDeletedSkillResult> {
  let symlinksRestored = 0
  let symlinksSkipped = 0
  const localCopiesRoot = join(entryDir, 'local-copies')

  for (const copy of manifest.localCopies) {
    const agent = AGENTS.find((a) => a.id === copy.agentId)
    if (!agent) {
      symlinksSkipped++
      continue
    }
    // Re-validate linkPath stays inside this agent's base. Tampered manifest
    // could otherwise plant the folder somewhere outside the agent dir.
    try {
      validatePath(copy.linkPath, [agent.path])
    } catch {
      symlinksSkipped++
      continue
    }
    // linkPath free?
    try {
      await fs.lstat(copy.linkPath)
      // Something already exists at the destination; skip rather than overwrite.
      symlinksSkipped++
      continue
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') {
        symlinksSkipped++
        continue
      }
      // ENOENT = free, proceed.
    }
    const stagedPath = join(localCopiesRoot, copy.agentId)
    try {
      await fs.mkdir(agent.path, { recursive: true })
      await moveDirectoryNoOverwrite(stagedPath, copy.linkPath)
      symlinksRestored++
    } catch {
      symlinksSkipped++
    }
  }

  if (symlinksSkipped > 0) {
    // Keep local-copies/<agentId> entries that could not be restored.
    cancelEvictTimer(id)
    await markManualRecoveryEntry(
      entryDir,
      'local-only restore skipped one or more staged copies',
    )
    return {
      outcome: 'restored',
      symlinksRestored,
      symlinksSkipped,
    }
  }

  await finalizeRestore(id, entryDir)

  return {
    outcome: 'restored',
    symlinksRestored,
    symlinksSkipped,
  }
}

/**
 * Cancel the pending trash eviction timer without deleting the trash entry.
 * @param id - Tombstone id whose timer should stop.
 * @returns void
 * @example cancelEvictTimer(tombstoneId('1729-task-deadbeef'))
 */
function cancelEvictTimer(id: TombstoneId): void {
  const pendingTimer = evictTimers.get(id)
  if (pendingTimer) {
    clearTimeout(pendingTimer)
    evictTimers.delete(id)
  }
}

/**
 * Shared restore postlude: cancel pending evict timer + remove the trash entry directory.
 * Best-effort; called after complete source-backed or local-only restorations.
 * @param id - Tombstone id whose timer and entry should be removed.
 * @param entryDir - On-disk trash entry directory to delete.
 * @returns Promise that resolves after the entry directory is removed.
 * @example await finalizeRestore(tombstoneId('1729-task-deadbeef'), '/Users/me/.agents/.trash/1729-task-deadbeef')
 */
async function finalizeRestore(
  id: TombstoneId,
  entryDir: string,
): Promise<void> {
  cancelEvictTimer(id)
  await fs.rm(entryDir, { recursive: true, force: true })
}

/**
 * Sweep orphan trash entries older than 24h on `app.whenReady`.
 * Entries younger than 24h are left alone (the Redux undoToast that paired with
 * them is gone on restart — we can't reconstruct the countdown, so no re-schedule).
 * Runs with concurrency bound 4 so a storm of orphans doesn't stall startup.
 * Errors per entry are caught + logged; sweep continues.
 * @example
 * // In src/main/index.ts on app.whenReady:
 * void startupCleanup()
 */
export async function startupCleanup(): Promise<void> {
  const startTime = Date.now()
  let entries: string[]
  try {
    entries = await fs.readdir(TRASH_DIR)
  } catch (error) {
    const code = errorCode(error)
    if (code === 'ENOENT') return // fresh install, nothing to sweep
    console.error('trashService: startupCleanup failed to read TRASH_DIR', {
      code,
      message: extractErrorMessage(error),
    })
    return
  }

  const cutoff = Date.now() - STARTUP_CLEANUP_MAX_AGE_MS
  // Parse entry name → unix_ms prefix; only sweep old ones.
  const toSweep: string[] = []
  let manualRecoverySkippedCount = 0
  for (const entryName of entries) {
    const ms = parseDeletedAtFromEntryName(entryName)
    if (ms === null) {
      // Unparseable name = foreign file; do not touch.
      continue
    }
    if (ms < cutoff) {
      const entryDir = join(TRASH_DIR, entryName)
      if (await hasManualRecoveryMarker(entryDir)) {
        manualRecoverySkippedCount++
        continue
      }
      toSweep.push(entryName)
    }
  }

  // Manual semaphore at concurrency 4.
  let index = 0
  const workers = Array.from(
    { length: Math.min(STARTUP_CLEANUP_CONCURRENCY, toSweep.length) },
    async () => {
      while (true) {
        const current = index++
        if (current >= toSweep.length) return
        const entryName = toSweep[current]
        try {
          await fs.rm(join(TRASH_DIR, entryName), {
            recursive: true,
            force: true,
          })
        } catch (error) {
          console.warn('trashService: startupCleanup entry skipped', {
            entryName,
            reason: 'rm failed',
            code: errorCode(error),
            message: extractErrorMessage(error),
          })
        }
      }
    },
  )
  await Promise.all(workers)

  console.info('trashService: startupCleanup', {
    sweptCount: toSweep.length,
    manualRecoverySkippedCount,
    totalEntries: entries.length,
    durationMs: Date.now() - startTime,
  })
}

/**
 * Extract the unix-ms prefix from a trash entry basename.
 * @param entryName - Directory name under TRASH_DIR
 * @returns Millisecond epoch or null if unparseable
 * @example parseDeletedAtFromEntryName('1729180800000-task-abc12345') // 1729180800000
 * @example parseDeletedAtFromEntryName('foo-bar') // null
 */
function parseDeletedAtFromEntryName(
  entryName: string,
): UnixTimestampMs | null {
  const dashIndex = entryName.indexOf('-')
  if (dashIndex <= 0) return null
  const prefix = entryName.slice(0, dashIndex)
  if (!/^\d+$/.test(prefix)) return null
  const parsed = Number.parseInt(prefix, 10)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Error raised by `moveToTrash` when a non-recoverable fs op fails mid-delete.
 * Preserves `err.code` so the caller can build a per-item result with the
 * original syscall error code.
 */
export class TrashError extends Error {
  /** Original NodeJS.ErrnoException.code if available (e.g. 'EACCES'). */
  code?: string

  constructor(message: string, code?: string) {
    super(message)
    this.name = 'TrashError'
    this.code = code
  }
}

/**
 * Test-only helper: clear the evict timer map. Prevents tests from leaking
 * NodeJS timers across suites when using fake timers.
 * Do NOT call from production code.
 */
export function __clearEvictTimersForTests(): void {
  for (const timer of evictTimers.values()) {
    clearTimeout(timer)
  }
  evictTimers.clear()
}

/**
 * Test-only helper: exposes the in-process TRASH_DIR so integration tests can
 * point at a `tmpdir()` path without monkey-patching process.env.
 */
export function __getTrashDirForTests(): string {
  return TRASH_DIR
}
