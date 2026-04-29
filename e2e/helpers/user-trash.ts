import { lstatSync, readdirSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'

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
 * Defense-in-depth: refuses to remove any path that does not resolve to a
 * descendant of `USER_TRASH_DIR`. The previous `startsWith` prefix check
 * was bypassable via `..` segments — e.g.
 * `~/.Trash/../Documents/secret` starts with `~/.Trash/` but resolves
 * outside the trash dir. `path.resolve` normalizes the segments first,
 * then `path.relative` confirms containment without prefix-string foot-
 * guns. `diffUserTrash` always returns in-trash paths today, so this
 * guard is a no-op for the supported caller — it exists so a future
 * misuse (passing arbitrary paths) cannot rm-rf outside `~/.Trash`.
 *
 * @example
 * try { ... } finally { cleanupTrashEntries(newPaths) }
 */
export function cleanupTrashEntries(paths: readonly string[]): void {
  const trashRoot = resolve(USER_TRASH_DIR)
  for (const trashedPath of paths) {
    const normalizedTarget = resolve(trashedPath)
    const relativeFromTrashRoot = relative(trashRoot, normalizedTarget)
    const isInsideTrash =
      relativeFromTrashRoot.length > 0 &&
      !relativeFromTrashRoot.startsWith('..') &&
      !isAbsolute(relativeFromTrashRoot)
    if (!isInsideTrash) {
      console.warn(
        `[e2e] Refusing to clean up path outside ~/.Trash: ${trashedPath}`,
      )
      continue
    }
    try {
      rmSync(normalizedTarget, { recursive: true, force: true })
    } catch (err) {
      console.warn(
        `[e2e] Failed to clean up trashed entry ${trashedPath}:`,
        err,
      )
    }
  }
}

/**
 * Determine whether `inspectedPath` is on the same physical volume as the
 * user's `~/.Trash`. macOS `shell.trashItem` (NSWorkspace) routes per-
 * volume: files on the boot volume land in `~/.Trash`, files on other
 * mounted volumes land in `<volume>/.Trashes/<uid>`. Tests that snapshot
 * or diff `~/.Trash` are only valid when the source path lives on the
 * boot volume.
 *
 * In practice macOS `tmpdir()` resolves to `/var/folders/.../T` on the
 * boot APFS volume on every standard dev box, so this returns `true` for
 * the supported configuration. The check exists so a non-standard mount
 * (e.g., `/tmp` on a separate filesystem, or running specs from an
 * external volume) skips the affected specs loudly instead of failing
 * with a misleading "no matching trash entry" message.
 *
 * @param inspectedPath - Absolute path whose volume should be compared
 *   against `USER_TRASH_DIR`. Typical caller passes `isolatedHome`.
 * @returns
 * - `true` when both paths share the same `stat.dev` value.
 * - `false` when the volumes differ OR either `stat` call throws (missing
 *   path, permission denied — both indicate the test should not run).
 *
 * @example
 * test('...', async ({ isolatedHome }) => {
 *   test.skip(
 *     !isSameVolumeAsUserTrash(isolatedHome),
 *     'isolatedHome is on a different volume than ~/.Trash; ' +
 *       'shell.trashItem would route to <volume>/.Trashes/<uid>.',
 *   )
 * })
 */
export function isSameVolumeAsUserTrash(inspectedPath: string): boolean {
  try {
    return statSync(inspectedPath).dev === statSync(USER_TRASH_DIR).dev
  } catch {
    return false
  }
}
