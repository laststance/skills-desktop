import { constants, type Stats } from 'node:fs'
import * as fs from 'node:fs/promises'

import type { AbsolutePath } from '@/shared/types'

import { errorCode, isMissingPathError } from './errorCode'

/**
 * Restore a quarantined path after validation or OS Trash fails. The lstat
 * pre-check + per-type guards prevent clobbering a recreated file/symlink or a
 * non-empty directory; only an empty dir recreated in the race can be replaced.
 * @param quarantinePath - Hidden same-directory path currently holding the entry.
 * @param originalPath - Original reviewed path to restore.
 * @returns true when restoration succeeds or the quarantine is already gone.
 * @example restoreQuarantinedPath('/Users/me/.cursor/skills/.task.unlink-id', '/Users/me/.cursor/skills/task')
 */
export async function restoreQuarantinedPath(
  quarantinePath: AbsolutePath,
  originalPath: AbsolutePath,
): Promise<boolean> {
  try {
    await fs.lstat(originalPath)
    return false
  } catch (error) {
    if (!isMissingPathError(error)) return false
  }

  let quarantineStats: Stats
  try {
    quarantineStats = await fs.lstat(quarantinePath)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return true
    return false
  }

  try {
    if (quarantineStats.isSymbolicLink()) {
      const target = await fs.readlink(quarantinePath)
      await fs.symlink(target, originalPath)
      await fs.unlink(quarantinePath)
      return true
    }

    if (quarantineStats.isDirectory()) {
      // Atomic same-directory restore (buildQuarantinePath keeps both paths in
      // the same dir, so rename can't hit EXDEV). Replaces the previous cp+rm,
      // which could leave a half-copied tree at originalPath on a mid-copy
      // failure (ENOSPC/EACCES). The lstat pre-check makes originalPath absent
      // in the common case. In the narrow race where another process recreates
      // it first: a *non-empty* dir makes rename fail ENOTEMPTY → caught →
      // false (no-clobber preserved); an *empty* dir is silently replaced, but
      // it holds no data so nothing is lost. POSIX rename has no portable
      // no-replace flag (renameat2/renamex_np need native bindings), and
      // cp+rm's partial-tree failure is strictly worse, so rename stands.
      await fs.rename(quarantinePath, originalPath)
      return true
    }

    // File and symlink restores intentionally keep copy-then-unlink with
    // COPYFILE_EXCL / symlink's implicit EEXIST: there is a real
    // (if narrow) race where originalPath is recreated as a file/symlink after
    // the pre-check, and plain rename would SILENTLY overwrite it — exactly the
    // same-path replacement this PR exists to defend against.
    if (quarantineStats.isFile()) {
      await fs.copyFile(quarantinePath, originalPath, constants.COPYFILE_EXCL)
      await fs.unlink(quarantinePath)
      return true
    }

    return false
  } catch {
    return false
  }
}
