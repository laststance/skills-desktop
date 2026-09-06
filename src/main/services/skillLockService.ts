import * as fs from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

import { z } from 'zod'

import { MANUAL_RECOVERY_MARKER, SOURCE_DIR, TRASH_DIR } from '@/main/constants'
import { manifestSchema, tombstoneIdSchema } from '@/main/ipc/ipc-schemas'
import { errorCode, isMissingPathError } from '@/main/utils/errorCode'
import { extractErrorMessage } from '@/main/utils/errors'
import { AGENT_DEFINITIONS } from '@/shared/constants'
import type {
  AbsolutePath,
  PruneLockEntriesResult,
  SkillName,
  StaleLockScanResult,
  UnprunableLockEntry,
} from '@/shared/types'

import { skillsCliService } from './skillsCliService'

/**
 * Lock schema version the CLI understands. Anything lower is wiped by the CLI
 * on its next read (`skill-lock.ts` `readSkillLock`), so entries in an older
 * file can never trigger a reinstall and are not stale in any harmful sense.
 */
const SUPPORTED_LOCK_VERSION = 3

/**
 * The slice of the CLI's global lock this app depends on. Values are unknown on
 * purpose: only the keys matter here, and pinning the record's value shape would
 * make us reject locks the CLI itself is happy to read.
 */
const skillLockSchema = z.object({
  version: z.number(),
  skills: z.record(z.string(), z.unknown()),
})

/** Filename the CLI uses for the global lock, under both path layouts. */
const LOCK_FILE = '.skill-lock.json'

/** Directory-name cap the CLI's `sanitizeName` applies (`installer.ts`). */
const MAX_DIR_NAME_LENGTH = 255

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
  return sanitized.substring(0, MAX_DIR_NAME_LENGTH) || 'unnamed-skill'
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
    const parsed = skillLockSchema.safeParse(JSON.parse(content))
    if (!parsed.success) return { status: 'unavailable' }
    // The CLI wipes any lock below its current version, so those entries can
    // never be reinstalled — nothing to prune, and nothing is wrong.
    if (parsed.data.version < SUPPORTED_LOCK_VERSION) {
      return { status: 'ok', keys: [] }
    }
    // A newer CLI wrote a format this build has never seen. Its keys may not
    // map onto directories the way `sanitizeName` assumes here, so this is the
    // same "one side of the comparison is missing" case as an unreadable file:
    // report nothing rather than prune against a guess.
    if (parsed.data.version > SUPPORTED_LOCK_VERSION) {
      return { status: 'unavailable' }
    }
    return { status: 'ok', keys: Object.keys(parsed.data.skills) }
  } catch (error) {
    console.error('skillLockService: lock is not valid JSON', {
      message: extractErrorMessage(error),
    })
    return { status: 'unavailable' }
  }
}

/** Whether a skill's source directory is gone, still there, or unknowable. */
type SourcePresence = 'absent' | 'present' | 'unknown'

/**
 * Probes a skill's source directory; both the scan and the prune revalidation
 * call it before treating a lock record as stale. Three-valued on purpose — a
 * permission or I/O failure must never read as "deleted", and must not read as
 * "still installed" either, because that is a benign no-op the UI hides.
 * @param path - Absolute path to probe.
 * @returns
 * - `'absent'`: ENOENT/ENOTDIR, the path provably cannot exist
 * - `'present'`: the stat succeeded
 * - `'unknown'`: any other error (EACCES, EIO, ELOOP) — we could not find out
 * @example await probeSourcePresence('/Users/me/.agents/skills/gone') // => 'absent'
 */
async function probeSourcePresence(
  path: AbsolutePath,
): Promise<SourcePresence> {
  try {
    await fs.stat(path)
    return 'present'
  } catch (error) {
    return isMissingPathError(error) ? 'absent' : 'unknown'
  }
}

/** Outcome of reading the trash: staged directory names, or "we could not tell". */
type TrashReadResult =
  { status: 'ok'; dirNames: Set<string> } | { status: 'unavailable' }

/**
 * True when a trash entry carries the terminal manual-recovery marker.
 * Read by {@link readTrashedSourceDirNames} before the manifest, because both
 * source-backed writers of the marker run BEFORE the manifest exists.
 * @param entryDir - Trash entry directory under `TRASH_DIR`.
 * @returns true only on proof the marker is there.
 * @example await isManualRecoveryEntry('/Users/me/.agents/.trash/2026-...') // => false
 */
async function isManualRecoveryEntry(entryDir: string): Promise<boolean> {
  try {
    await fs.access(join(entryDir, MANUAL_RECOVERY_MARKER))
    return true
  } catch {
    // Absent, or unreadable. Neither is proof of a terminal entry, so fall
    // through to the caller's manifest read — that path already fails closed.
    return false
  }
}

/**
 * Directory names currently staged in the trash, from each entry's manifest.
 * A skill waiting out its undo window still has a lock record doing its job, so
 * it must be excluded from detection. Local-only tombstones never had a source
 * directory and so never had a lock record.
 * @returns
 * - `ok` with the staged source-directory basenames when the trash was readable
 * - `ok` with an empty set when there is no trash directory at all (fresh install)
 * - `unavailable` when the trash exists but cannot be read — reporting an empty
 *   set there would flag every skill mid-undo as stale, and Undo would then
 *   restore it with its lock record already pruned
 * @example await readTrashedSourceDirNames() // => { status: 'ok', dirNames: Set { 'theme-generator' } }
 */
async function readTrashedSourceDirNames(): Promise<TrashReadResult> {
  const dirNames = new Set<string>()
  let entries: string[]
  try {
    entries = await fs.readdir(TRASH_DIR)
  } catch (error) {
    // No trash directory is the normal state: nothing is staged for undo.
    if (isMissingPathError(error)) return { status: 'ok', dirNames }
    console.error('skillLockService: trash unreadable', {
      code: errorCode(error),
      message: extractErrorMessage(error),
    })
    return { status: 'unavailable' }
  }

  // Set by the reads below rather than returned, because one blind entry
  // invalidates the whole set, not just its own name.
  let hasUnreadableEntry = false
  const manifests = await Promise.all(
    entries.map(async (entryName) => {
      const entryDir = join(TRASH_DIR, entryName)
      // Checked BEFORE the manifest, and it is load-bearing. Both source-backed
      // writers of this marker (`trashService` at the source-move failure and
      // at the manifest-write rollback) run while no manifest exists yet, so
      // without this the ENOENT below reads as "one of our entries caught
      // mid-write" and takes the whole scan to `unavailable` — permanently,
      // since `startupCleanup` deliberately never sweeps a marked entry.
      //
      // Returning null also stops the entry counting as "still restorable":
      // its automatic restore already failed for good, so holding the lock
      // record alive just lets `skills -g update` reinstall a deleted skill.
      // Where the source is still at its original path (the EXDEV arm), the
      // per-key presence probe already keeps that record out of the stale list.
      if (await isManualRecoveryEntry(entryDir)) return null
      let raw: string
      try {
        raw = await fs.readFile(join(entryDir, 'manifest.json'), 'utf-8')
      } catch (error) {
        // A foreign file in the trash simply has no manifest. Any other read
        // failure is an entry we cannot see into, and it may be the one holding
        // the lock record for a skill still inside its undo window.
        //
        // A MISSING manifest is only benign when the entry is not ours.
        // `moveToTrash` renames the source in BEFORE writing the manifest, so
        // one of our own entries caught in that window reads as ENOENT here —
        // and treating it as foreign would drop a skill whose undo is live.
        // Only our entries carry a parseable tombstone id as their name.
        if (
          isMissingPathError(error) &&
          tombstoneIdSchema.safeParse(entryName).success
        ) {
          hasUnreadableEntry = true
          return null
        }
        if (!isMissingPathError(error)) {
          console.error('skillLockService: trash entry unreadable', {
            entryName,
            code: errorCode(error),
            message: extractErrorMessage(error),
          })
          hasUnreadableEntry = true
        }
        return null
      }
      try {
        return manifestSchema.parse(JSON.parse(raw))
      } catch {
        // Unparseable manifest: Undo reads the same file, so it could not
        // restore this entry either. It is holding nothing back.
        return null
      }
    }),
  )
  if (hasUnreadableEntry) return { status: 'unavailable' }

  for (const manifest of manifests) {
    if (manifest?.kind === 'source-backed') {
      dirNames.add(basename(manifest.sourcePath))
    }
  }
  return { status: 'ok', dirNames }
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
 *
 * Reads inside {@link runLockWrite}: the CLI's own `writeSkillLock` is a plain
 * `writeFile`, so a read racing an install can land on a half-written file and
 * return null. Here that is unrecoverable rather than merely wrong — the trash
 * entry that would re-queue the prune is already evicted, so the record is
 * stranded until the user notices it in the dashboard. Nesting is safe: every
 * `evict` caller is a detached timer or the startup sweep, none of them holding
 * the mutex.
 * @param dirName - Basename of the source directory that was removed.
 * @returns The raw lock key, or null when nothing tracks that directory.
 * @example await resolveLockKeyForDirectory('ce-review') // => 'CE:Review'
 */
export async function resolveLockKeyForDirectory(
  dirName: string,
): Promise<SkillName | null> {
  return runLockWrite(async () => {
    const lock = await readSkillLockKeys()
    if (lock.status !== 'ok') return null
    return buildUniqueDirNameIndex(lock.keys).get(dirName) ?? null
  })
}

/**
 * True when any agent still holds a REAL directory under this skill name.
 *
 * `skills remove --global` deletes `<agent globalSkillsDir>/<name>` for EVERY
 * agent with `rm(recursive, force)` and no symlink check (upstream
 * `remove.ts:267-269` at v1.5.23), and only the universal-source agents point
 * that at `~/.agents/skills` — `claude` resolves to `~/.claude/skills`,
 * `cursor` to `~/.cursor/skills`. A real directory there is the user's own
 * content, which {@link moveToTrash} deliberately preserves when it skips
 * non-symlinks. Delegating anyway would destroy it with no tombstone and no
 * undo, so a name is only ever handed to the CLI once every agent-side path
 * is proven to be a symlink or absent.
 *
 * `lstat`, never `stat`: `stat` follows the link and reports a healthy symlink
 * as a directory, which would refuse every legitimate prune instead.
 * @param dirName - Sanitized directory name, matching what the CLI resolves.
 * @returns true when at least one agent holds real content under this name.
 * @example await holdsRealAgentDirectory('tdd-workflow') // => false
 */
async function holdsRealAgentDirectory(dirName: string): Promise<boolean> {
  const perAgent = await Promise.all(
    AGENT_DEFINITIONS.map(async (agent) => {
      try {
        const stats = await fs.lstat(
          join(homedir(), agent.installDir, 'skills', dirName),
        )
        return !stats.isSymbolicLink()
      } catch (error) {
        // Absent is safe — nothing there to destroy. Anything else is doubt,
        // and doubt must block a delete rather than wave it through.
        return !isMissingPathError(error)
      }
    }),
  )
  return perAgent.includes(true)
}

/**
 * Probe the source root so a missing or unreadable root is never mistaken for
 * "every skill was deleted". Shared by {@link scanStaleLockEntries} and
 * {@link pruneLockEntries} deliberately: when only the scan checked it, the two
 * disagreed — the scan refused to report anything while the prune treated the
 * whole lock as stale and deleted it.
 * @returns true when the root exists and is a directory.
 * @example await isSourceRootReadable() // => true
 */
async function isSourceRootReadable(): Promise<boolean> {
  try {
    const stats = await fs.stat(SOURCE_DIR)
    return stats.isDirectory()
  } catch (error) {
    console.error('skillLockService: source dir unreadable', {
      code: errorCode(error),
      message: extractErrorMessage(error),
    })
    return false
  }
}

/**
 * Find every lock record whose skill is gone from disk for good.
 * Runs when the dashboard asks for a health count. It adds no deletions of its
 * own, but it does drain the prune the trash already queued (see
 * {@link flushPruneQueue}) so the count describes the lock as it will settle rather
 * than mid-eviction. Returns `unavailable` rather than a count whenever the
 * source directory, the trash, or the lock itself cannot be read: with one side
 * of the diff missing, every record on the other side looks stale.
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
  if (lock.keys.length === 0) return { status: 'ok', names: [], unprunable: [] }

  // Probe the source root first. If it is missing or unreadable, every lookup
  // below would report ENOENT and the whole lock would present as stale.
  if (!(await isSourceRootReadable())) return { status: 'unavailable' }

  const byDirName = buildUniqueDirNameIndex(lock.keys)

  // `buildUniqueDirNameIndex` deletes every directory name two keys claim, so
  // a key with no entry there is exactly a collided one. Reported rather than
  // dropped: silently omitting them is what left a colliding pair unprunable
  // with nothing in the UI saying why, while `skills -g update` kept
  // resurrecting both. No extra I/O — the index is already built.
  const collided: UnprunableLockEntry[] = lock.keys
    .filter((key) => !byDirName.has(sanitizeName(key)))
    .map((name) => ({ name, reason: 'name-collision' }))

  // Probe absence FIRST, read the trash SECOND. The order is load-bearing and
  // must not be swapped back: a delete landing mid-scan moves the source dir
  // away and stages a tombstone, so reading the trash first would miss the new
  // entry and then see the directory gone — reporting a skill the user can
  // still Undo as stale. With the trash as the later observation, anything that
  // entered it during the scan is still caught.
  const absentDirNames = new Set<string>()
  await Promise.all(
    Array.from(byDirName.keys(), async (dirName) => {
      // Only provable absence counts. `unknown` stays out of the stale list for
      // the same reason it blocks a prune: doubt is not evidence of deletion.
      if ((await probeSourcePresence(join(SOURCE_DIR, dirName))) === 'absent') {
        absentDirNames.add(dirName)
      }
    }),
  )

  const trashed = await readTrashedSourceDirNames()
  if (trashed.status !== 'ok') return { status: 'unavailable' }

  const stale: SkillName[] = []
  for (const [dirName, key] of byDirName) {
    // Still restorable from the trash: the record is not stale yet.
    if (!absentDirNames.has(dirName) || trashed.dirNames.has(dirName)) continue
    stale.push(key)
  }

  // Runs over the already-proven-stale list ONLY, never the whole lock. Each
  // call is one `lstat` per agent, and this scan fires on a timer and on every
  // refresh — over every key it would be a filesystem storm, over a stale list
  // that is normally empty it costs nothing. The prune keeps its own copy of
  // this check as the TOCTOU backstop; this one exists so the user is told
  // BEFORE clicking a button that would only ever report a failure.
  const holdsAgentCopy = await Promise.all(
    stale.map(async (key) => holdsRealAgentDirectory(sanitizeName(key))),
  )

  const names = stale.filter((_, index) => !holdsAgentCopy[index])
  const unprunable: UnprunableLockEntry[] = [
    ...collided,
    ...stale
      .filter((_, index) => holdsAgentCopy[index])
      .map((name): UnprunableLockEntry => ({ name, reason: 'agent-copy' })),
  ]

  return {
    status: 'ok',
    names: names.sort(),
    // Code-unit order, matching `names.sort()` above. `localeCompare` would
    // order these differently under the renderer's ICU than under the node
    // test lane, which is not something a result shape should depend on.
    unprunable: unprunable.sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    ),
  }
}

/**
 * Remove lock records by delegating to `skills remove --global -y`.
 *
 * Runs inside {@link runLockWrite}, and revalidates INSIDE that lock: a name is
 * dropped when its record already went away, when another key has come to share
 * its directory name, and when its directory came back
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

    // The same root probe the scan performs, for the same reason. Without it an
    // unmounted volume or a renamed root makes every per-skill stat ENOENT, so
    // every requested key looks provably absent and the entire lock is pruned.
    if (!(await isSourceRootReadable())) {
      return { ...empty, failed: [...requested] }
    }

    const tracked = new Set(before.keys)
    // Rebuilt from the lock as it is NOW, not as the scan saw it. Between scan
    // and confirm another key can appear that sanitizes to the same directory,
    // and upstream `removeSkillFromLock` is last-write-wins over sanitized
    // names — delegating then would delete the OTHER record.
    const unambiguousOwners = buildUniqueDirNameIndex(before.keys)
    const targets: SkillName[] = []
    const skipped: SkillName[] = []
    // Records we could neither confirm stale nor clear. They belong in
    // `failed`, never in `skipped`: per {@link PruneLockEntriesResult}
    // `skipped` is a benign no-op the UI reports as "the skill came back",
    // while these are still stale and the user has to see that.
    const unverifiable: SkillName[] = []
    // Kept apart from `unverifiable` even though both end in `failed`: this is
    // "two records claim one directory", a state the user can act on by
    // renaming, not an I/O error that might clear itself. The split is also the
    // seam the scan-side half lands on — see TODOS.md P2, which needs this
    // distinction to reach the dashboard as its own status.
    const collided: SkillName[] = []
    for (const name of requested) {
      // Already gone from the lock — nothing to remove, and nothing is wrong.
      if (!tracked.has(name)) {
        skipped.push(name)
        continue
      }
      // Another key now owns this directory name too, so "does its source
      // exist" no longer answers anything about THIS record.
      if (unambiguousOwners.get(sanitizeName(name)) !== name) {
        collided.push(name)
        continue
      }
      // react-doctor-disable-next-line react-doctor/async-await-in-loop -- revalidation must stay inside the lock-write mutex; a Promise.all here would still be serialized by it and the batch is at most a screenful of names.
      const presence = await probeSourcePresence(
        join(SOURCE_DIR, sanitizeName(name)),
      )
      // The skill came back on disk, so the record is live again.
      if (presence === 'present') skipped.push(name)
      else if (presence === 'absent') targets.push(name)
      else unverifiable.push(name)
    }

    if (targets.length === 0)
      return { ...empty, skipped, failed: [...unverifiable, ...collided] }

    // Absence was probed above; read the trash AFTER it. Same load-bearing
    // order as {@link scanStaleLockEntries} and it must not be swapped: a
    // delete landing mid-revalidation stages a tombstone, and only with the
    // trash as the later observation is that new entry still seen.
    // `moveToTrash` does not join this mutex, so such a delete really can land
    // here — "delete X, reinstall X, delete X again" leaves the first
    // eviction's queued prune pointing at a record the second delete can still
    // restore.
    const trashed = await readTrashedSourceDirNames()
    // Fail closed. The scan reports nothing when the trash is unreadable; here
    // the same doubt must block a delete, never authorize one. The blocked
    // names go to `failed`, not `skipped`: per {@link PruneLockEntriesResult}
    // `skipped` means "dropped before the call" (untracked, or the skill came
    // back) and the UI reports it as a benign no-op, while these records are
    // still stale and unverifiable — the user has to see that.
    if (trashed.status !== 'ok')
      return {
        ...empty,
        skipped,
        failed: [...unverifiable, ...collided, ...targets],
      }

    const removable: SkillName[] = []
    for (const name of targets) {
      // Still restorable: a newer delete of this name is inside its undo
      // window, so pruning now would strand the skill it brings back.
      if (trashed.dirNames.has(sanitizeName(name))) skipped.push(name)
      else removable.push(name)
    }

    if (removable.length === 0)
      return { ...empty, skipped, failed: [...unverifiable, ...collided] }

    // Last line before an irreversible delegation. See
    // {@link holdsRealAgentDirectory}: the CLI would recursively delete this
    // name out of every agent directory, symlink or not.
    const delegable: SkillName[] = []
    const refused: SkillName[] = []
    for (const name of removable) {
      // react-doctor-disable-next-line react-doctor/async-await-in-loop -- the check must stay inside the lock-write mutex, and the batch is at most a screenful of names.
      if (await holdsRealAgentDirectory(sanitizeName(name))) refused.push(name)
      else delegable.push(name)
    }

    if (delegable.length === 0)
      return {
        ...empty,
        skipped,
        failed: [...unverifiable, ...collided, ...refused],
      }

    // Raw keys, not sanitized — the CLI looks the record up by raw name and
    // sanitizes internally when it resolves paths.
    await skillsCliService.removeSkills(delegable)

    const after = await readSkillLockKeys()
    if (after.status !== 'ok') {
      return {
        pruned: [],
        skipped,
        failed: [...unverifiable, ...collided, ...delegable, ...refused],
      }
    }
    const survivors = new Set(after.keys)
    return {
      pruned: delegable.filter((name) => !survivors.has(name)),
      skipped,
      failed: [
        ...unverifiable,
        ...collided,
        ...delegable.filter((name) => survivors.has(name)),
        ...refused,
      ],
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
 * Drain the queue into one CLI call. Split out from {@link queuePrune} so tests can
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
