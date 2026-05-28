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
 * Check whether current lstat metadata still names the reviewed filesystem entry.
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
 * Compare two serialized filesystem identities without requiring a live Stats object.
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

  if (currentIdentity.dev !== 0 || currentIdentity.ino !== 0) {
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
