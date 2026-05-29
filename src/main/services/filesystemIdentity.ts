import type { Stats } from 'node:fs'

import type { FilesystemEntryIdentity } from '@/shared/types'

/**
 * Convert Node fs.Stats into the small identity payload reviewed by destructive UI.
 * @param stats - lstat/stat result for the reviewed filesystem entry.
 * @returns Serializable identity used to reject same-path replacements.
 * @example filesystemIdentityFromStats(await fs.lstat('/path/to/skill'))
 */
export function filesystemIdentityFromStats(
  stats: Stats,
): FilesystemEntryIdentity {
  return {
    kind: stats.isSymbolicLink()
      ? 'symlink'
      : stats.isDirectory()
        ? 'directory'
        : stats.isFile()
          ? 'file'
          : 'other',
    dev: stats.dev,
    ino: stats.ino,
    size: stats.size,
    ctimeMs: stats.ctimeMs,
    mtimeMs: stats.mtimeMs,
  }
}

/**
 * Rename-stable identity check (device + inode) used AFTER we have renamed the
 * reviewed entry into a quarantine/stage path — rename preserves dev+ino but
 * bumps ctime, so a timestamp-strict check would false-positive there.
 * Does NOT catch a same-path rm+mkdir replacement on filesystems that recycle
 * inode numbers (ext4 / CI Linux); use {@link isReviewedEntryUnchanged} at
 * pre-operation gates where an in-place replacement must be rejected.
 * @param current - Current lstat/stat result for the destructive path.
 * @param reviewed - Identity captured when the user reviewed the row.
 * @returns True when the same path still points at the reviewed object.
 * @example isSameFilesystemIdentity(await fs.lstat(path), reviewedIdentity)
 */
export function isSameFilesystemIdentity(
  current: Stats,
  reviewed: FilesystemEntryIdentity,
): boolean {
  const currentIdentity = filesystemIdentityFromStats(current)
  return isSameFilesystemEntryIdentity(currentIdentity, reviewed)
}

/**
 * Serialized-identity form of {@link isSameFilesystemIdentity} (rename-stable,
 * dev+ino). See that function for when to use the lenient vs strict check.
 * @param current - Current serialized filesystem identity.
 * @param reviewed - Reviewed serialized filesystem identity.
 * @returns True when both records describe the same filesystem entry.
 * @example isSameFilesystemEntryIdentity(currentIdentity, reviewedIdentity)
 */
export function isSameFilesystemEntryIdentity(
  currentIdentity: FilesystemEntryIdentity,
  reviewed: FilesystemEntryIdentity,
): boolean {
  if (currentIdentity.kind !== reviewed.kind) return false

  // Only trust the dev+ino fast path when BOTH sides carry a real inode. A
  // 0/0 sentinel means inode info was unavailable at capture; comparing it
  // would spuriously fail (or pass) so fall back to the stat heuristic below.
  if (
    currentIdentity.dev !== 0 &&
    currentIdentity.ino !== 0 &&
    reviewed.dev !== 0 &&
    reviewed.ino !== 0
  ) {
    return (
      currentIdentity.dev === reviewed.dev &&
      currentIdentity.ino === reviewed.ino
    )
  }

  return (
    currentIdentity.dev === reviewed.dev &&
    currentIdentity.size === reviewed.size &&
    currentIdentity.ctimeMs === reviewed.ctimeMs &&
    currentIdentity.mtimeMs === reviewed.mtimeMs
  )
}

/**
 * Strict pre-operation gate: the reviewed path is still the same object AND was
 * not replaced in place since review. Exists because dev+ino alone is defeated
 * by inode-number reuse — ext4 (and thus GitHub Actions Linux) recycles a freed
 * inode number on `rm`+`mkdir`, so a same-path replacement can otherwise pass
 * the dev+ino check and get the wrong directory deleted. A recreated inode
 * always carries a fresh ctime (the kernel reinitializes it on allocation),
 * so adding ctime equality catches the replacement on every filesystem.
 * MUST be called BEFORE any rename — `rename` bumps ctime and would
 * false-positive; post-rename re-checks use {@link isSameFilesystemIdentity}.
 * @param current - Current lstat/stat result for the still-original reviewed path.
 * @param reviewed - Identity captured when the user reviewed the row.
 * @returns True only when both the dev+ino identity and ctime match the review.
 * @example isReviewedEntryUnchanged(await fs.lstat(reviewedPath), reviewedIdentity)
 */
export function isReviewedEntryUnchanged(
  current: Stats,
  reviewed: FilesystemEntryIdentity,
): boolean {
  return isReviewedEntryUnchangedIdentity(
    filesystemIdentityFromStats(current),
    reviewed,
  )
}

/**
 * Serialized-identity form of {@link isReviewedEntryUnchanged}. Layers a ctime
 * check on top of the rename-stable identity so a reused-inode replacement is
 * rejected; the dev=ino=0 fallback already compares ctime, so this only adds
 * the guard to the inode-present branch.
 * @param currentIdentity - Current serialized identity of the still-original path.
 * @param reviewed - Reviewed serialized filesystem identity.
 * @returns True only when the entry is the reviewed object and its ctime is unchanged.
 * @example isReviewedEntryUnchangedIdentity(currentIdentity, reviewedIdentity)
 */
export function isReviewedEntryUnchangedIdentity(
  currentIdentity: FilesystemEntryIdentity,
  reviewed: FilesystemEntryIdentity,
): boolean {
  return (
    isSameFilesystemEntryIdentity(currentIdentity, reviewed) &&
    currentIdentity.ctimeMs === reviewed.ctimeMs
  )
}
