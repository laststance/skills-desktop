import * as fs from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

import { SOURCE_DIR, TRASH_DIR } from '@/main/constants'
import { manifestSchema } from '@/main/ipc/ipc-schemas'
import { errorCode, isMissingPathError } from '@/main/utils/errorCode'
import { extractErrorMessage } from '@/main/utils/errors'
import type {
  AbsolutePath,
  PruneLockEntriesResult,
  SkillName,
  StaleLockScanResult,
} from '@/shared/types'

import { skillsCliService } from './skillsCliService'

/**
 * Lock schema version the CLI understands. Anything lower is wiped by the CLI
 * on its next read (`skill-lock.ts` `readSkillLock`), so entries in an older
 * file can never trigger a reinstall and are not stale in any harmful sense.
 */
const SUPPORTED_LOCK_VERSION = 3

/** Filename the CLI uses for the global lock, under both path layouts. */
const LOCK_FILE = '.skill-lock.json'

/**
 * How long evicted names sit in the queue before one batched CLI call.
 * A trailing debounce: a bulk delete evicts N tombstones within a few ms of
 * each other, and one `skills remove a b c` beats N spawns that would each
 * read-modify-write the same JSON file with no temp+rename to protect them.
 */
const PRUNE_FLUSH_DELAY_MS = 500

/** Names waiting for the next batched prune. Raw lock keys, never sanitized. */
const pruneQueue = new Set<SkillName>()

/** Handle for the pending debounce, so each new name pushes the flush back. */
let pruneFlushTimer: NodeJS.Timeout | null = null

/**
 * Tail of the serialized lock-write chain. Every operation that makes the CLI
 * rewrite `.skill-lock.json` (install, prune) links onto this so two spawns
 * never interleave a read-modify-write on the same file.
 */
let lockWriteChain: Promise<unknown> = Promise.resolve()

/**
 * Serialize anything that causes the skills CLI to rewrite the global lock.
 * `writeSkillLock` in the CLI is a plain `writeFile` with no temp+rename, and
 * a half-written lock parses as an EMPTY lock, silently dropping every skill
 * the user installed. One chain is cheaper than making the CLI atomic.
 * @param operation - Work to run once no other lock write is in flight.
 * @returns Whatever `operation` resolves to.
 * @example await runLockWrite(() => skillsCliService.install(options))
 */
export async function runLockWrite<T>(operation: () => Promise<T>): Promise<T> {
  const run = lockWriteChain.then(operation, operation)
  // Swallow rejections on the CHAIN only; `run` still rejects for the caller.
  lockWriteChain = run.catch(() => undefined)
  return run
}

/**
 * Resolve the global lock path exactly as the skills CLI does.
 * Read at call time, not cached, because `XDG_STATE_HOME` can differ between
 * the Electron process and the `npx` child we spawn.
 * @returns Absolute path to the lock file the CLI would read.
 * @example getSkillLockPath() // => '/Users/me/.agents/.skill-lock.json'
 */
export function getSkillLockPath(): AbsolutePath {
  const xdgStateHome = process.env.XDG_STATE_HOME
  if (xdgStateHome) {
    return join(xdgStateHome, 'skills', LOCK_FILE)
  }
  return join(homedir(), '.agents', LOCK_FILE)
}

/**
 * Mirror of the CLI's `sanitizeName` (`installer.ts`). The lock is keyed by the
 * raw install name while the directory on disk is the sanitized form, so any
 * key-to-directory comparison has to run this first.
 * @param name - Raw lock key.
 * @returns Directory name the CLI would have created for that key.
 * @example sanitizeName('CE:Review') // => 'ce-review'
 */
export function sanitizeName(name: string): string {
  const sanitized = name
    .toLowerCase()
    .replace(/[^a-z0-9._]+/g, '-')
    .replace(/^[.\-]+|[.\-]+$/g, '')
  return sanitized.substring(0, 255) || 'unnamed-skill'
}

/** Outcome of reading the lock: keys, or an honest "we could not tell". */
type LockReadResult =
  { status: 'ok'; keys: SkillName[] } | { status: 'unavailable' }

/**
 * Read the raw skill keys out of the global lock.
 * A missing file is `ok` with no keys (fresh install). Anything we cannot
 * parse is `unavailable` rather than an empty list — an empty list would be
 * diffed against the disk and reported as "nothing installed", and callers
 * would offer to delete records that may all still be valid.
 * @returns Lock keys, or `unavailable` when the file cannot be trusted.
 * @example await readSkillLockKeys() // => { status: 'ok', keys: ['tdd-workflow'] }
 */
async function readSkillLockKeys(): Promise<LockReadResult> {
  const lockPath = getSkillLockPath()
  let content: string
  try {
    content = await fs.readFile(lockPath, 'utf-8')
  } catch (error) {
    // No lock yet is a normal state; anything else (EACCES, EIO) is not.
    if (isMissingPathError(error)) return { status: 'ok', keys: [] }
    console.error('skillLockService: lock unreadable', {
      code: errorCode(error),
      message: extractErrorMessage(error),
    })
    return { status: 'unavailable' }
  }

  try {
    const parsed: unknown = JSON.parse(content)
    if (!parsed || typeof parsed !== 'object') return { status: 'unavailable' }
    const { version, skills } = parsed as {
      version?: unknown
      skills?: unknown
    }
    if (typeof version !== 'number' || !skills || typeof skills !== 'object') {
      return { status: 'unavailable' }
    }
    // The CLI wipes any lock below its current version, so those entries can
    // never be reinstalled — nothing to prune, and nothing is wrong.
    if (version < SUPPORTED_LOCK_VERSION) return { status: 'ok', keys: [] }
    return { status: 'ok', keys: Object.keys(skills) }
  } catch (error) {
    console.error('skillLockService: lock is not valid JSON', {
      message: extractErrorMessage(error),
    })
    return { status: 'unavailable' }
  }
}

/**
 * True when a path is provably absent, false when it exists OR when we could
 * not find out. A permission or I/O failure must never read as "deleted" —
 * that is the difference between pruning one record and offering to prune all
 * of them.
 * @param path - Absolute path to probe.
 * @returns True only on ENOENT/ENOTDIR.
 * @example await isProvablyAbsent('/Users/me/.agents/skills/gone') // => true
 */
async function isProvablyAbsent(path: AbsolutePath): Promise<boolean> {
  try {
    await fs.stat(path)
    return false
  } catch (error) {
    return isMissingPathError(error)
  }
}

/**
 * Directory names currently staged in the trash, from each entry's manifest.
 * A skill waiting out its undo window still has a lock record doing its job,
 * so it must be excluded from both detection and the prune batch. Local-only
 * tombstones never had a source directory and so never had a lock record.
 * @returns Set of source directory basenames sitting in the trash.
 * @example await readTrashedSourceDirNames() // => Set { 'theme-generator' }
 */
async function readTrashedSourceDirNames(): Promise<Set<string>> {
  const names = new Set<string>()
  let entries: string[]
  try {
    entries = await fs.readdir(TRASH_DIR)
  } catch {
    // No trash dir (or unreadable) means nothing is staged for undo.
    return names
  }

  const manifests = await Promise.all(
    entries.map(async (entryName) => {
      try {
        const raw = await fs.readFile(
          join(TRASH_DIR, entryName, 'manifest.json'),
          'utf-8',
        )
        return manifestSchema.parse(JSON.parse(raw))
      } catch {
        // Foreign file or half-written entry — nothing to exclude from it.
        return null
      }
    }),
  )

  for (const manifest of manifests) {
    if (manifest?.kind === 'source-backed') {
      names.add(basename(manifest.sourcePath))
    }
  }
  return names
}

/**
 * Map each lock key to the directory the CLI would have installed it into,
 * dropping keys whose sanitized form collides with another key's. A collision
 * makes "does this directory exist" ambiguous, and prune is not allowed to
 * guess about deletion.
 * @param keys - Raw lock keys.
 * @returns Unambiguous directory name to lock key pairs.
 * @example buildUniqueDirNameIndex(['a', 'A']) // => Map {}
 */
function buildUniqueDirNameIndex(
  keys: readonly SkillName[],
): Map<string, SkillName> {
  const byDirName = new Map<string, SkillName>()
  const collided = new Set<string>()
  for (const key of keys) {
    const dirName = sanitizeName(key)
    if (byDirName.has(dirName)) {
      collided.add(dirName)
      continue
    }
    byDirName.set(dirName, key)
  }
  for (const dirName of collided) byDirName.delete(dirName)
  return byDirName
}

/**
 * Find the lock key that owns a source directory, if any.
 * The eviction hook only knows the directory it just deleted; the CLI needs
 * the raw key back (`removeSkillFromLock` looks up `lock.skills[name]` by raw
 * name), so the mapping has to be inverted through `sanitizeName`.
 * @param dirName - Basename of the source directory that was removed.
 * @returns The raw lock key, or null when nothing tracks that directory.
 * @example await resolveLockKeyForDirectory('ce-review') // => 'CE:Review'
 */
export async function resolveLockKeyForDirectory(
  dirName: string,
): Promise<SkillName | null> {
  const lock = await readSkillLockKeys()
  if (lock.status !== 'ok') return null
  return buildUniqueDirNameIndex(lock.keys).get(dirName) ?? null
}

/**
 * Find every lock record whose skill is gone from disk for good.
 * Runs when the dashboard asks for a health count. It adds no deletions of its
 * own, but it does drain the prune the trash already queued (see
 * `flushPruneQueue`) so the count describes the lock as it will settle rather
 * than mid-eviction. Returns `unavailable` rather than a count whenever the
 * source directory or the lock itself cannot be read: with one side of the
 * diff missing, every record on the other side looks stale.
 * @returns Raw lock keys safe to prune, or `unavailable`.
 * @example await scanStaleLockEntries() // => { status: 'ok', names: ['old-skill'] }
 */
export async function scanStaleLockEntries(): Promise<StaleLockScanResult> {
  // Settle the queue before reading. A scan fired just after the undo window
  // expires would otherwise report records that are milliseconds away from
  // removal, offering the user a CTA for work already in flight. Only names
  // whose trash entry is already gone can be queued, so this can never cut an
  // undo short. Draining is exact where a timed delay would only be a guess.
  await flushPruneQueue()
  // Read through the same queue every lock write uses, so a concurrent install
  // is never observed half-written.
  const lock = await runLockWrite(readSkillLockKeys)
  if (lock.status !== 'ok') return { status: 'unavailable' }
  if (lock.keys.length === 0) return { status: 'ok', names: [] }

  // Probe the source root first. If it is missing or unreadable, every lookup
  // below would report ENOENT and the whole lock would present as stale.
  try {
    const stats = await fs.stat(SOURCE_DIR)
    if (!stats.isDirectory()) return { status: 'unavailable' }
  } catch (error) {
    console.error('skillLockService: source dir unreadable', {
      code: errorCode(error),
      message: extractErrorMessage(error),
    })
    return { status: 'unavailable' }
  }

  const byDirName = buildUniqueDirNameIndex(lock.keys)
  const trashed = await readTrashedSourceDirNames()

  const names: SkillName[] = []
  await Promise.all(
    Array.from(byDirName, async ([dirName, key]) => {
      // Still restorable from the trash: the record is not stale yet.
      if (trashed.has(dirName)) return
      if (await isProvablyAbsent(join(SOURCE_DIR, dirName))) names.push(key)
    }),
  )

  return { status: 'ok', names: names.sort() }
}

/**
 * Remove lock records by delegating to `skills remove --global -y`.
 *
 * Runs inside `runLockWrite`, and revalidates INSIDE that lock: a name is
 * dropped when its record already went away, and when its directory came back
 * (a reinstall during the undo window would otherwise be destroyed by a delete
 * request that is no longer true). Success is decided by re-reading the lock
 * afterwards, never by the child's exit code — `skills remove` logs per-item
 * failures and still exits 0.
 * @param requested - Raw lock keys to remove.
 * @returns Which names were pruned, skipped as no longer applicable, or failed.
 * @example await pruneLockEntries(['old-skill']) // => { pruned: ['old-skill'], skipped: [], failed: [] }
 */
export async function pruneLockEntries(
  requested: readonly SkillName[],
): Promise<PruneLockEntriesResult> {
  return runLockWrite(async () => {
    const empty: PruneLockEntriesResult = {
      pruned: [],
      skipped: [],
      failed: [],
    }
    if (requested.length === 0) return empty

    const before = await readSkillLockKeys()
    if (before.status !== 'ok') {
      return { ...empty, failed: [...requested] }
    }

    const present = new Set(before.keys)
    const targets: SkillName[] = []
    const skipped: SkillName[] = []
    for (const name of requested) {
      // Already gone from the lock, or the skill is back on disk.
      const stillTracked = present.has(name)
      // react-doctor-disable-next-line react-doctor/async-await-in-loop -- revalidation must stay inside the lock-write mutex; a Promise.all here would still be serialized by it and the batch is at most a screenful of names.
      const gone =
        stillTracked &&
        (await isProvablyAbsent(join(SOURCE_DIR, sanitizeName(name))))
      if (gone) targets.push(name)
      else skipped.push(name)
    }

    if (targets.length === 0) return { ...empty, skipped }

    // Raw keys, not sanitized — the CLI looks the record up by raw name and
    // sanitizes internally when it resolves paths.
    await skillsCliService.removeSkills(targets)

    const after = await readSkillLockKeys()
    if (after.status !== 'ok') {
      return { pruned: [], skipped, failed: targets }
    }
    const survivors = new Set(after.keys)
    return {
      pruned: targets.filter((name) => !survivors.has(name)),
      skipped,
      failed: targets.filter((name) => survivors.has(name)),
    }
  })
}

/**
 * Queue a lock key for the next batched prune. Called from trash eviction, the
 * moment a deletion stops being undoable.
 *
 * Fire-and-forget by design: eviction runs in a detached timer with nothing
 * awaiting it, so a failure is logged and the record is left for the
 * dashboard's stale-entry row to offer again.
 * @param name - Raw lock key whose skill was just evicted.
 * @example queuePrune('theme-generator')
 */
export function queuePrune(name: SkillName): void {
  pruneQueue.add(name)
  if (pruneFlushTimer) clearTimeout(pruneFlushTimer)
  pruneFlushTimer = setTimeout(() => {
    void flushPruneQueue()
  }, PRUNE_FLUSH_DELAY_MS)
}

/**
 * Drain the queue into one CLI call. Split out from `queuePrune` so tests can
 * flush without waiting on the debounce.
 * @returns Promise that resolves once the batch has been attempted.
 * @example await flushPruneQueue()
 */
export async function flushPruneQueue(): Promise<void> {
  if (pruneFlushTimer) {
    clearTimeout(pruneFlushTimer)
    pruneFlushTimer = null
  }
  const batch = Array.from(pruneQueue)
  pruneQueue.clear()
  if (batch.length === 0) return

  const result = await pruneLockEntries(batch)
  if (result.failed.length > 0) {
    console.error('skillLockService: prune failed', {
      failed: result.failed,
      hint: 'lock entries survived `skills remove`; the dashboard will offer them again',
    })
  }
}

/**
 * Test-only helper: drop queued names and any pending debounce so a suite
 * cannot leak a timer or a batch into the next one.
 * Do NOT call from production code.
 */
export function __resetPruneQueueForTests(): void {
  if (pruneFlushTimer) clearTimeout(pruneFlushTimer)
  pruneFlushTimer = null
  pruneQueue.clear()
  lockWriteChain = Promise.resolve()
}
