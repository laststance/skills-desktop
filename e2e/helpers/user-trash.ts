import { readdirSync, rmSync } from 'node:fs'
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
