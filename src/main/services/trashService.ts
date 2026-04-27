import { randomBytes } from 'node:crypto'
import * as fs from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'

import { match } from 'ts-pattern'
import type { z } from 'zod'

import { UNDO_WINDOW_MS } from '../../shared/constants'
import type {
  AbsolutePath,
  AgentId,
  RestoreDeletedSkillResult,
  SkillName,
  TombstoneId,
  UnixTimestampMs,
} from '../../shared/types'
import { tombstoneId } from '../../shared/types'
import { AGENTS, SOURCE_DIR } from '../constants'
import { manifestSchema } from '../ipc/ipc-schemas'
import { errorCode } from '../utils/errorCode'
import { extractErrorMessage } from '../utils/errors'

import { getAllowedBases, validatePath } from './pathValidation'

/** Root of the on-disk trash. Created lazily on first delete. */
const TRASH_DIR = join(homedir(), '.agents', '.trash')

/**
 * Stable error code for a manifest that cannot be parsed (bad JSON or fails
 * Zod). Lets tests assert on `error.code` instead of free-form message text.
 */
const ERR_MANIFEST_CORRUPT = 'EMANIFEST_CORRUPT'

/** How long a tombstone lives before being evicted in-session (ms). Matches E1 undo window. */
const TRASH_TTL_MS = UNDO_WINDOW_MS

/** Max age for startup-cleanup to preserve orphaned entries across restarts (ms). */
const STARTUP_CLEANUP_MAX_AGE_MS = 24 * 60 * 60 * 1000

/** Concurrency bound for the startup cleanup sweep. */
const STARTUP_CLEANUP_CONCURRENCY = 4

/** Number of random bytes in the `rand8hex` suffix (4 bytes = 8 hex chars). */
const RAND_SUFFIX_BYTES = 4

/**
 * In-process map of scheduled evict timers. Keys are tombstone ids; values are
 * the NodeJS timer handle so explicit restore/evict can cancel the TTL timer.
 * @example
 * evictTimers.set(id, setTimeout(() => evict(id), TRASH_TTL_MS))
 */
const evictTimers = new Map<TombstoneId, NodeJS.Timeout>()

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
}

/**
 * Record of a real (non-symlink) skill folder under an agent dir that was
 * moved into the trash. Used for local-only skills (no `~/.agents/skills/<name>`
 * source exists; the skill lives directly in one or more agent directories).
 */
export interface RecordedLocalCopy {
  agentId: AgentId
  linkPath: AbsolutePath
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
      try {
        await fs.rename(stagedPath, copy.linkPath)
      } catch (renameError) {
        if (errorCode(renameError) === 'EXDEV') {
          await fs.cp(stagedPath, copy.linkPath, { recursive: true })
          await fs.rm(stagedPath, { recursive: true, force: true })
        } else {
          throw renameError
        }
      }
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
 * Walk every configured agent directory and find real (non-symlink) folders
 * matching `skillName`. Used by `moveToTrash` when `~/.agents/skills/<name>`
 * has no source dir but the skill exists as a local copy in one or more agents.
 *
 * Symlinks are deliberately ignored here — for local-only delete we only move
 * real directories. A stray symlink pointing at one of those copies will become
 * broken after delete and is surfaced by the next scan as a "broken" entry.
 *
 * @param skillName - Validated skill name (no separators)
 * @returns Per-agent local copy records, ordered by AGENTS iteration
 */
async function scanLocalCopies(
  skillName: SkillName,
): Promise<RecordedLocalCopy[]> {
  const copies: RecordedLocalCopy[] = []
  for (const agent of AGENTS) {
    const linkPath = join(agent.path, skillName)
    try {
      // For real directories validation can use [agent.path] specifically —
      // unlike symlinks, realpath stops at the directory itself, which lives
      // inside the agent's allowed base.
      validatePath(linkPath, [agent.path])
    } catch {
      continue
    }
    let stats: Awaited<ReturnType<typeof fs.lstat>>
    try {
      stats = await fs.lstat(linkPath)
    } catch (error) {
      if (errorCode(error) === 'ENOENT') continue
      // Permission error or other — log and skip this agent rather than abort
      // the whole scan; the user can retry once they've fixed perms.
      console.warn('trashService: scanLocalCopies lstat failed', {
        agentId: agent.id,
        linkPath,
        code: errorCode(error),
        message: extractErrorMessage(error),
      })
      continue
    }
    if (stats.isDirectory() && !stats.isSymbolicLink()) {
      copies.push({ agentId: agent.id, linkPath: linkPath as AbsolutePath })
    }
  }
  return copies
}

/**
 * Move a skill into the on-disk trash. The skill may be:
 * - **source-backed**: `~/.agents/skills/<name>` exists; agent entries are
 *   symlinks pointing at it. Move source + unlink every symlink.
 * - **local-only**: no source dir; one or more agents hold the skill as a real
 *   folder. Move every real folder into `<entryDir>/local-copies/<agentId>/`.
 *
 * Both flows write a v2 manifest with a `kind` discriminator that `restore()`
 * matches on. TTL eviction is scheduled regardless of kind.
 *
 * @param skillName - Validated skill name (no path separators, enforced by Zod)
 * @returns Tombstone id + cascadeAgents + symlinksRemoved for the caller's result
 * @throws TrashError when the skill cannot be located in either form, or any
 *   filesystem op fails non-recoverably mid-move
 * @example
 * // source-backed
 * const result = await moveToTrash('theme-generator')
 * // { tombstoneId: '1729...-theme-generator-a1b2c3d4', cascadeAgents: ['cursor'], symlinksRemoved: 1 }
 * @example
 * // local-only (skill lives in ~/.claude/skills/architecture-decision-records)
 * const result = await moveToTrash('architecture-decision-records')
 * // { tombstoneId: '1729...-architecture-decision-records-...', cascadeAgents: ['claude'], symlinksRemoved: 1 }
 */
export async function moveToTrash(skillName: SkillName): Promise<{
  tombstoneId: TombstoneId
  cascadeAgents: AgentId[]
  symlinksRemoved: number
}> {
  // Construct sourcePath from the (Zod-validated) skill name and re-check it
  // against SOURCE_DIR for defense in depth — even though the renderer never
  // passes a path, this keeps the file's invariants self-evident if a future
  // caller forgets to validate.
  const sourcePath = join(SOURCE_DIR, skillName) as AbsolutePath
  validatePath(sourcePath, [SOURCE_DIR])

  // Probe the source dir. If it exists, source-backed flow. Otherwise scan
  // agent dirs for local copies and dispatch to local-only flow if found.
  let sourceExists = false
  try {
    await fs.stat(sourcePath)
    sourceExists = true
  } catch (error) {
    const code = errorCode(error)
    if (code !== 'ENOENT') {
      throw new TrashError(
        `Failed to inspect skill source: ${extractErrorMessage(error)}`,
        code,
      )
    }
  }

  if (sourceExists) {
    return moveSourceBackedToTrash(skillName, sourcePath)
  }

  const localCopies = await scanLocalCopies(skillName)
  if (localCopies.length === 0) {
    throw new TrashError('Skill not found (already deleted?)', 'ENOENT')
  }
  return moveLocalOnlyToTrash(skillName, localCopies)
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
): Promise<{
  tombstoneId: TombstoneId
  cascadeAgents: AgentId[]
  symlinksRemoved: number
}> {
  const startTime = Date.now()
  await fs.mkdir(TRASH_DIR, { recursive: true, mode: 0o755 })

  const entryName = buildEntryName(skillName)
  const entryDir = join(TRASH_DIR, entryName)
  const entrySourceDir = join(entryDir, 'source')
  const manifestPath = join(entryDir, 'manifest.json')

  // Walk agents, collect + remove symlinks. Abort on non-ENOENT unlink failure.
  const recordedSymlinks: RecordedSymlink[] = []
  const cascadeAgentIds: AgentId[] = []
  for (const agent of AGENTS) {
    const linkPath = join(agent.path, skillName)
    // Use getAllowedBases() — validatePath realpath-follows linkPath. A valid
    // source-backed symlink resolves into SOURCE_DIR, which isn't under the
    // individual agent.path. Restricting to [agent.path] alone would false-
    // positive every legitimate symlink and silently skip cascade cleanup.
    try {
      validatePath(linkPath, getAllowedBases())
    } catch {
      continue
    }

    let stats: Awaited<ReturnType<typeof fs.lstat>>
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

    if (stats.isSymbolicLink()) {
      let target: string
      try {
        target = await fs.readlink(linkPath)
      } catch (error) {
        const code = errorCode(error)
        if (code === 'ENOENT') continue
        throw new TrashError(
          `Failed to read symlink target: ${extractErrorMessage(error)}`,
          code,
        )
      }
      try {
        await fs.unlink(linkPath)
      } catch (error) {
        const code = errorCode(error)
        if (code === 'ENOENT') {
          // Race: file disappeared between lstat and unlink. Record best-effort, continue.
          recordedSymlinks.push({ agentId: agent.id, linkPath, target })
          cascadeAgentIds.push(agent.id)
          continue
        }
        throw new TrashError(
          `Failed to remove symlinks: ${extractErrorMessage(error)}`,
          code,
        )
      }
      recordedSymlinks.push({ agentId: agent.id, linkPath, target })
      cascadeAgentIds.push(agent.id)
    }
    // Non-symlink directories inside agent dirs are "local skills" — leave them
    // alone. The skill being deleted owns the SOURCE_DIR copy only.
  }

  // Atomically move source → trash entry. On EXDEV, copy + remove.
  // If the move fails, the symlinks we already unlinked would otherwise be
  // lost. Best-effort re-create them before re-throwing so the user is not
  // left with a half-deleted skill (source still on disk but agents unlinked).
  await fs.mkdir(entryDir, { recursive: true })
  try {
    await fs.rename(sourcePath, entrySourceDir)
  } catch (error) {
    const code = errorCode(error)
    // Discriminate on the errno code:
    //   EXDEV  → cross-device rename; fall back to copy + remove (returns null on success)
    //   ENOENT → source already gone
    //   other  → generic failure surfacing the underlying message
    const trashError = await match(code)
      .with('EXDEV', async () => {
        try {
          await fs.cp(sourcePath, entrySourceDir, { recursive: true })
          await fs.rm(sourcePath, { recursive: true, force: true })
          return null
        } catch (fallbackError) {
          return new TrashError(
            `Failed to move source to trash (cross-device): ${extractErrorMessage(fallbackError)}`,
            errorCode(fallbackError),
          )
        }
      })
      .with(
        'ENOENT',
        async () => new TrashError('Skill not found (already deleted?)', code),
      )
      .otherwise(
        async () =>
          new TrashError(
            `Failed to move source to trash: ${extractErrorMessage(error)}`,
            code,
          ),
      )

    if (trashError !== null) {
      // Rollback: re-create symlinks we unlinked earlier, and drop the empty
      // trash entry dir. Errors are logged, never masked over the real cause.
      await rollbackRemovedSymlinks(recordedSymlinks)
      await fs.rm(entryDir, { recursive: true, force: true }).catch(() => {
        // entryDir cleanup is best-effort — caller already has the real error.
      })
      throw trashError
    }
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

    // Step 1: move the source back. Mirror the forward EXDEV fallback.
    let restoreSourceFailed = false
    try {
      await fs.rename(entrySourceDir, sourcePath)
    } catch (reverseMoveError) {
      if (errorCode(reverseMoveError) === 'EXDEV') {
        try {
          await fs.cp(entrySourceDir, sourcePath, { recursive: true })
          await fs.rm(entrySourceDir, { recursive: true, force: true })
        } catch (reverseCopyError) {
          restoreSourceFailed = true
          console.error(
            'trashService: manifest write rollback — failed to restore source (cross-device)',
            {
              skillName,
              entryName,
              code: errorCode(reverseCopyError),
              message: extractErrorMessage(reverseCopyError),
            },
          )
        }
      } else {
        restoreSourceFailed = true
        console.error(
          'trashService: manifest write rollback — failed to restore source',
          {
            skillName,
            entryName,
            code: errorCode(reverseMoveError),
            message: extractErrorMessage(reverseMoveError),
          },
        )
      }
    }

    // Step 2: re-create the symlinks we removed. Best-effort; already logs per link.
    await rollbackRemovedSymlinks(recordedSymlinks)

    // Step 3: drop the empty (or partial) trash entry dir.
    await fs.rm(entryDir, { recursive: true, force: true }).catch(() => {
      // entry cleanup is best-effort — caller already has the real error.
    })

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
): Promise<{
  tombstoneId: TombstoneId
  cascadeAgents: AgentId[]
  symlinksRemoved: number
}> {
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
    try {
      await fs.rename(copy.linkPath, stagedPath)
      moved.push(copy)
    } catch (error) {
      const code = errorCode(error)
      // EXDEV across volumes — fall back to cp + rm. ENOENT means the copy
      // disappeared mid-flight (race); skip and continue rather than abort.
      const recoveryOutcome = await match(code)
        .with('EXDEV', async () => {
          try {
            await fs.cp(copy.linkPath, stagedPath, { recursive: true })
            await fs.rm(copy.linkPath, { recursive: true, force: true })
            return { kind: 'moved' as const }
          } catch (fallbackError) {
            return {
              kind: 'fatal' as const,
              error: new TrashError(
                `Failed to move local copy (cross-device, agent=${copy.agentId}): ${extractErrorMessage(fallbackError)}`,
                errorCode(fallbackError),
              ),
            }
          }
        })
        .with('ENOENT', async () => ({ kind: 'race-skip' as const }))
        .otherwise(async () => ({
          kind: 'fatal' as const,
          error: new TrashError(
            `Failed to move local copy (agent=${copy.agentId}): ${extractErrorMessage(error)}`,
            code,
          ),
        }))

      if (recoveryOutcome.kind === 'fatal') {
        const unrestoredCopies = await rollbackMovedLocalCopies(entryDir, moved)
        if (unrestoredCopies.length === 0) {
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
        const strandedAgents = unrestoredCopies
          .map((copy) => copy.agentId)
          .join(', ')
        throw new TrashError(
          `${recoveryOutcome.error.message}; ${unrestoredCopies.length} local copy/copies stranded in ${entryDir}/local-copies (agents: ${strandedAgents})`,
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
    localCopies: moved,
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
  // MUST run before the fs.stat probe below so a forged path like `/etc/...`
  // can't even trigger a filesystem existence check — defense in depth.
  try {
    validatePath(manifest.sourcePath, [SOURCE_DIR])
  } catch {
    return {
      outcome: 'error',
      error: { message: 'Invalid source path in manifest' },
    }
  }

  // Source path free?
  try {
    await fs.stat(manifest.sourcePath)
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

  // Rename source back.
  try {
    await fs.rename(entrySourceDir, manifest.sourcePath)
  } catch (error) {
    const code = errorCode(error)
    if (code === 'EXDEV') {
      try {
        await fs.cp(entrySourceDir, manifest.sourcePath, { recursive: true })
        await fs.rm(entrySourceDir, { recursive: true, force: true })
      } catch (fallbackError) {
        return {
          outcome: 'error',
          error: {
            message: extractErrorMessage(fallbackError),
            code: errorCode(fallbackError),
          },
        }
      }
    } else {
      return {
        outcome: 'error',
        error: { message: extractErrorMessage(error), code },
      }
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
    // Re-validate target stays inside SOURCE_DIR. `target` is the raw string
    // `fs.readlink` returned at delete-time — it may be absolute or relative
    // to the symlink's own directory (kernel resolution contract). A tampered
    // manifest could otherwise steer restore into planting links at '/etc/...'.
    const resolvedTarget = isAbsolute(link.target)
      ? link.target
      : resolve(dirname(link.linkPath), link.target)
    try {
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
      await fs.mkdir(agent.path, { recursive: true })
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
 * Per-copy collisions or unknown agents skip cleanly — partial restores are
 * still reported as `outcome: 'restored'` with `symlinksSkipped > 0`.
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
      try {
        await fs.rename(stagedPath, copy.linkPath)
      } catch (renameError) {
        if (errorCode(renameError) === 'EXDEV') {
          await fs.cp(stagedPath, copy.linkPath, { recursive: true })
          await fs.rm(stagedPath, { recursive: true, force: true })
        } else {
          throw renameError
        }
      }
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
 * Shared restore postlude: cancel pending evict timer + remove the trash entry
 * directory. Best-effort; called after both source-backed and local-only
 * restorations succeed past their per-record loop.
 */
async function finalizeRestore(
  id: TombstoneId,
  entryDir: string,
): Promise<void> {
  const pendingTimer = evictTimers.get(id)
  if (pendingTimer) {
    clearTimeout(pendingTimer)
    evictTimers.delete(id)
  }
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
  for (const entryName of entries) {
    const ms = parseDeletedAtFromEntryName(entryName)
    if (ms === null) {
      // Unparseable name = foreign file; do not touch.
      continue
    }
    if (ms < cutoff) toSweep.push(entryName)
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
