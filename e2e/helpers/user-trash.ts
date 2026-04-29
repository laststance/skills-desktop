import { lstatSync, readdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * The developer's real `~/.Trash`. macOS `shell.trashItem` is uid-based
 * (NSWorkspace), NOT HOME-env-based, so even tests running under an
 * isolated HOME route trashed entries into this physical directory.
 */
export const USER_TRASH_DIR = join(homedir(), '.Trash')

/**
 * Filter out Finder's async-created bookkeeping entries. macOS writes
 * `.DS_Store` and `.localized` into `~/.Trash` on first access; these
 * appear mid-test for reasons unrelated to our IPC and would inflate
 * the diff. The user-visible entries `shell.trashItem` creates are
 * never dotfiles (basename of the source path).
 */
function isTrashableEntry(entry: string): boolean {
  return !entry.startsWith('.')
}

/**
 * Snapshot the user-visible entries in `~/.Trash`. Returns a `Set` so the
 * post-call diff can use cheap membership checks rather than O(n²) filters.
 *
 * @example
 * const before = snapshotUserTrash()
 * await runIpcThatTrashesSomething()
 * const { newPaths } = diffUserTrash(before)
 */
export function snapshotUserTrash(): Set<string> {
  return new Set(readdirSync(USER_TRASH_DIR).filter(isTrashableEntry))
}

/**
 * Compute the entries that appeared in `~/.Trash` since `before`.
 * Returns both basenames (for human-readable assertion messages) and
 * absolute paths (for content inspection / cleanup).
 *
 * @returns
 * - `newEntries`: basenames of entries created since the snapshot.
 * - `newPaths`: absolute paths to those entries under `USER_TRASH_DIR`.
 *
 * @example
 * const { newEntries, newPaths } = diffUserTrash(before)
 * expect(newEntries).toHaveLength(1)
 * expect(readdirSync(newPaths[0]).sort()).toEqual([...].sort())
 */
export function diffUserTrash(before: Set<string>): {
  newEntries: string[]
  newPaths: string[]
} {
  const after = readdirSync(USER_TRASH_DIR).filter(isTrashableEntry)
  const newEntries = after.filter((entry) => !before.has(entry))
  return {
    newEntries,
    newPaths: newEntries.map((entry) => join(USER_TRASH_DIR, entry)),
  }
}

/**
 * Find the trash entry whose direct children exactly equal the given set of
 * skill basenames. Used by tests that move an agent dir into the developer's
 * real `~/.Trash` to narrow the cleanup target to OUR specific entry — never
 * the full `newPaths` set, which may include unrelated entries dropped by
 * Finder, Time Machine, or the dev's own drag-to-trash.
 *
 * Defensive against three real-data-loss scenarios:
 *  - Empty `expectedSkillNames` matching an empty trash dir (a buggy fixture
 *    that staged zero skills would otherwise rm-rf any empty trash dir from
 *    the diff): returns `undefined` when the expected set is empty.
 *  - `lstat` ENOENT race when Finder/Time Machine evicts a trash entry
 *    between snapshot and inspection: the entry is treated as non-match
 *    instead of throwing.
 *  - `readdir` ENOENT race for the same reason: skipped, not throwing.
 *
 * Cross-validates per-run unique skill names from `preStageLinkedSkills` so
 * even an exact-set basename collision against an unrelated `~/.Trash` dir
 * is statistically excluded.
 *
 * @param newPaths - Absolute paths from `diffUserTrash().newPaths`.
 * @param expectedSkillNames - Exact set of basenames the matched entry's
 *   direct children must equal. Order is not significant; sorted internally.
 * @returns
 * - The first matching path when one or more entries match.
 * - `undefined` when no entry matches OR `expectedSkillNames` is empty.
 *
 * @example
 * const { newPaths } = diffUserTrash(before)
 * const ourEntry = findMatchingTrashedAgentDir(newPaths, ['skill-a1b2-00', 'skill-a1b2-01'])
 * if (ourEntry) cleanupTrashEntries([ourEntry])
 */
export function findMatchingTrashedAgentDir(
  newPaths: readonly string[],
  expectedSkillNames: readonly string[],
): string | undefined {
  if (expectedSkillNames.length === 0) return undefined
  const sortedExpected = [...expectedSkillNames].sort()
  return newPaths.find((entryPath) => {
    let isDir: boolean
    try {
      isDir = lstatSync(entryPath).isDirectory()
    } catch {
      return false
    }
    if (!isDir) return false
    let entryContents: string[]
    try {
      entryContents = readdirSync(entryPath).sort()
    } catch {
      return false
    }
    if (entryContents.length !== sortedExpected.length) return false
    return entryContents.every((name, idx) => name === sortedExpected[idx])
  })
}

/**
 * Best-effort cleanup of trash entries created during a test. Warns rather
 * than throws so a stuck file lock never masks the actual test failure.
 * `rmSync` with `force/recursive` handles both files and directories,
 * matching the shape variation `shell.trashItem` may produce per volume.
 *
 * Defense-in-depth: refuses to remove any path not rooted at
 * `USER_TRASH_DIR`. `diffUserTrash` always returns paths under
 * `USER_TRASH_DIR`, so this guard is a no-op for the supported caller, but
 * it keeps a future misuse (passing arbitrary paths) from `rm -rf`-ing the
 * developer's home dir.
 *
 * @example
 * try { ... } finally { cleanupTrashEntries(newPaths) }
 */
export function cleanupTrashEntries(paths: readonly string[]): void {
  const trashRootPrefix = `${USER_TRASH_DIR}/`
  for (const trashedPath of paths) {
    if (!trashedPath.startsWith(trashRootPrefix)) {
      console.warn(
        `[e2e] Refusing to clean up path outside ~/.Trash: ${trashedPath}`,
      )
      continue
    }
    try {
      rmSync(trashedPath, { recursive: true, force: true })
    } catch (err) {
      console.warn(
        `[e2e] Failed to clean up trashed entry ${trashedPath}:`,
        err,
      )
    }
  }
}
