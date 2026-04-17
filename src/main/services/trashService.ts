import { randomBytes } from 'node:crypto'
import * as fs from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'

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
 * Move a skill source directory + its symlinks into the on-disk trash.
 *
 * Lifecycle:
 * 1. `mkdir(TRASH_DIR)` idempotent (fresh-install safe).
 * 2. Generate `entryName = <unix_ms>-<skillName>-<rand8hex>`.
 * 3. Walk agent dirs, read symlinks, record them, unlink each symlink. On any
 *    non-ENOENT unlink failure: abort before rename, no trash entry created,
 *    source stays in place — surfaces as per-item error in caller.
 * 4. `fs.rename(sourcePath, entryDir/source)`. On EXDEV: fall back to `fs.cp` + `fs.rm`.
 * 5. Write `manifest.json` with `schemaVersion:1`.
 * 6. Schedule TTL evict timer keyed in `evictTimers`.
 *
 * @param skillName - Validated skill name (no path separators)
 * @param sourcePath - Absolute path to the skill source directory (already validated)
 * @returns Tombstone id + cascadeAgents + symlinksRemoved for the caller's result
 * @throws Error with user-facing message when unlink fails with non-ENOENT code
 *   or rename/cp fallback cannot move the source
 * @example
 * const result = await moveToTrash('theme-generator', '/Users/me/.agents/skills/theme-generator')
 * // { tombstoneId: '1729180800000-theme-generator-a1b2c3d4', cascadeAgents: ['cursor'], symlinksRemoved: 1 }
 */
export async function moveToTrash(
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
    // Constrain path to agent dir (skillName already validated, defense in depth).
    try {
      validatePath(linkPath, [agent.path])
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
    const trashError =
      code === 'EXDEV'
        ? await (async () => {
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
          })()
        : code === 'ENOENT'
          ? new TrashError('Skill not found (already deleted?)', code)
          : new TrashError(
              `Failed to move source to trash: ${extractErrorMessage(error)}`,
              code,
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

  // Write manifest.
  const manifest = {
    schemaVersion: 1 as const,
    deletedAt: Date.now(),
    skillName,
    sourcePath,
    symlinks: recordedSymlinks,
  }
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8')

  const id = tombstoneId(entryName)

  // Schedule TTL evict.
  const timer = setTimeout(() => {
    void evict(id)
  }, TRASH_TTL_MS)
  evictTimers.set(id, timer)

  console.info('trashService: moveToTrash', {
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
 * (c) Source path free (no collision with a reinstalled skill).
 *
 * Per-symlink: if target is gone (volume unmounted, source moved) OR the
 * agent's linkPath is occupied by something else → skip that symlink only,
 * count in `symlinksSkipped`; keep going with other links.
 *
 * On success: rename source back, recreate surviving symlinks, remove trash
 * dir, cancel pending evict timer.
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
  const entrySourceDir = join(entryDir, 'source')
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
  } catch (error) {
    return {
      outcome: 'error',
      error: {
        message: 'Trash manifest corrupted',
        code: errorCode(error),
      },
    }
  }

  // Validate sourcePath is within allowed bases (manifest could be tampered).
  // MUST run before the fs.stat probe below so a forged path like `/etc/...`
  // can't even trigger a filesystem existence check — defense in depth.
  try {
    validatePath(manifest.sourcePath, getAllowedBases())
  } catch {
    return {
      outcome: 'error',
      error: { message: 'Invalid source path in manifest' },
    }
  }

  // (c) Source path free.
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

  // Cleanup: remove trash entry + cancel evict timer.
  const pendingTimer = evictTimers.get(id)
  if (pendingTimer) {
    clearTimeout(pendingTimer)
    evictTimers.delete(id)
  }
  await fs.rm(entryDir, { recursive: true, force: true })

  console.info('trashService: restore', {
    tombstoneId: id,
    symlinksRestored,
    symlinksSkipped,
    durationMs: Date.now() - startTime,
  })

  return {
    outcome: 'restored',
    symlinksRestored,
    symlinksSkipped,
  }
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
