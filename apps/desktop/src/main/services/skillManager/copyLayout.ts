import * as fs from 'node:fs/promises'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path'

import { errorCode, isMissingPathError } from '@/main/utils/errorCode'

/**
 * Filesystem layout primitives for the skill manager: the wipe-and-recopy
 * canonical install and the relative symlinks that tie agent directories back
 * to it. Ported from the skills CLI's `copyDirectory`, `createSymlink`, and
 * `cleanAndCreateDirectory` (v1.7.4) with the eve/promptscript special cases
 * dropped per the port spec.
 *
 * Internal to `skillManager/` — not part of the module's public interface.
 */

/** Files the canonical copy never carries (CLI `EXCLUDE_FILES`). */
const EXCLUDE_FILES = new Set(['metadata.json'])
/** Directories the canonical copy never descends into (CLI `EXCLUDE_DIRS`). */
const EXCLUDE_DIRS = new Set(['.git', '__pycache__', '__pypackages__'])

function isExcluded(name: string, isDirectory: boolean): boolean {
  if (EXCLUDE_FILES.has(name)) return true
  return isDirectory && EXCLUDE_DIRS.has(name)
}

/**
 * Byte-exact port of the CLI's `sanitizeName` (`installer.ts`): lowercase,
 * runs of non `[a-z0-9._]` collapse to one dash, leading/trailing dots and
 * dashes trimmed, capped at 255 chars, empty falls back to `unnamed-skill`.
 * The lock is keyed by the raw frontmatter name while the directory on disk
 * is this sanitized form, so install, remove, and prune must all agree on it.
 * @param name - Raw skill name from frontmatter or user input.
 * @returns The directory name the skill occupies on disk.
 * @example sanitizeName('CE:Review') // => 'ce-review'
 */
export function sanitizeName(name: string): string {
  const sanitized = name
    .toLowerCase()
    .replace(/[^a-z0-9._]+/g, '-')
    .replace(/^[.\-]+|[.\-]+$/g, '')
  return sanitized.substring(0, 255) || 'unnamed-skill'
}

/**
 * Recursively copy a skill tree, dereferencing symlinks and preserving mode
 * bits. Broken symlinks are skipped with a warning rather than failing the
 * install, matching the CLI. Never called outside this module's install flow.
 * @param src - Source directory inside the extracted tree or local checkout.
 * @param dest - Destination directory, created when missing.
 */
async function copyDirectory(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true })
  const entries = await fs.readdir(src, { withFileTypes: true })
  // Sequential on purpose: chmod ordering stays deterministic and the trees
  // are small — a skill is a handful of markdown files.
  for (const entry of entries) {
    if (isExcluded(entry.name, entry.isDirectory())) continue
    const srcPath = join(src, entry.name)
    const destPath = join(dest, entry.name)
    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath)
      continue
    }
    try {
      // cp with dereference flattens symlinks into their target's content,
      // which is exactly what the CLI's install layout promises.
      await fs.cp(srcPath, destPath, { dereference: true, recursive: true })
      await fs.chmod(destPath, (await fs.stat(srcPath)).mode & 0o777)
    } catch (error) {
      if (errorCode(error) === 'ENOENT' && entry.isSymbolicLink()) {
        console.warn(`skillManager: skipping broken symlink: ${srcPath}`)
        continue
      }
      throw error
    }
  }
}

/** True when `inner` is the same path as `outer` or anywhere beneath it. */
function isSameOrInside(outer: string, inner: string): boolean {
  const rel = relative(outer, inner)
  return (
    rel === '' ||
    (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
  )
}

/**
 * True when `a` and `b` are the same path or one contains the other, compared
 * on realpath-resolved absolute paths so symlinks cannot hide the overlap.
 */
function pathsOverlap(a: string, b: string): boolean {
  return isSameOrInside(a, b) || isSameOrInside(b, a)
}

/**
 * Resolve a path for overlap comparison even when it does not exist yet:
 * realpath the nearest existing ancestor form (the parent directory) and
 * re-attach the final segment, falling back to lexical resolution.
 */
async function realpathLenient(path: string): Promise<string> {
  try {
    return await fs.realpath(path)
  } catch {
    // Resolve the nearest existing ancestor and re-attach the not-yet-created
    // tail segments — a symlink higher than the direct parent must not hide
    // an overlap either. Terminates at the filesystem root, which always
    // resolves.
    const tail: string[] = [basename(path)]
    let ancestor = dirname(path)
    for (;;) {
      try {
        return join(await fs.realpath(ancestor), ...tail)
      } catch {
        const parent = dirname(ancestor)
        if (parent === ancestor) {
          // Even the filesystem root refused to resolve — realpath is broken
          // wholesale, so no symlink can hide anything anywhere. Degrade to
          // the lexical form rather than hanging the install.
          return resolve(path)
        }
        tail.unshift(basename(ancestor))
        ancestor = parent
      }
    }
  }
}

/**
 * Wipe `destDir` and recopy the skill tree into it — the CLI's canonical
 * install semantics. Reinstalls therefore never accumulate stale files.
 * Refuses when source and destination overlap: a local install pointed at
 * the canonical tree itself (or at an agent dir the copy falls back to)
 * would otherwise delete the very tree it copies from.
 * @param srcDir - Source tree (extracted repo subdir or local skill dir).
 * @param destDir - Canonical target, e.g. `~/.agents/skills/<name>`.
 * @throws Error when `srcDir` and `destDir` are the same or nested paths.
 */
export async function copySkillTree(
  srcDir: string,
  destDir: string,
): Promise<void> {
  const [realSrc, realDest] = await Promise.all([
    realpathLenient(srcDir),
    realpathLenient(destDir),
  ])
  if (pathsOverlap(realSrc, realDest)) {
    throw new Error(
      `Install source and destination overlap: ${srcDir} -> ${destDir}`,
    )
  }
  await fs.rm(destDir, { recursive: true, force: true })
  await fs.mkdir(destDir, { recursive: true })
  await copyDirectory(srcDir, destDir)
}

/**
 * Resolve symlinks in a path's parent directories, so a relative symlink
 * computed for `~/.claude/skills/x` stays correct when `~/.claude` is itself
 * a symlink. Falls back to the lexical resolution when the parent is missing.
 */
async function resolveParentSymlinks(path: string): Promise<string> {
  const resolved = resolve(path)
  const dir = dirname(resolved)
  try {
    const realDir = await fs.realpath(dir)
    return join(realDir, basename(resolved))
  } catch {
    return resolved
  }
}

/**
 * Create or replace `linkPath` as a relative symlink to `target`. An existing
 * correct link is left alone; any other occupant — real directory included —
 * is deleted without backup, matching the CLI. The relative target is computed
 * against the symlink's real parent so config-dir symlink setups stay valid.
 * @param target - Absolute canonical skill directory the link points at.
 * @param linkPath - Absolute agent-side path to create.
 * @returns true when the link exists and points at `target` afterwards.
 */
export async function createRelativeSymlink(
  target: string,
  linkPath: string,
): Promise<boolean> {
  try {
    const resolvedTarget = resolve(target)
    // Already-correct links short-circuit before anything is deleted.
    try {
      const stats = await fs.lstat(linkPath)
      if (stats.isSymbolicLink()) {
        const current = await fs.readlink(linkPath)
        if (resolve(dirname(linkPath), current) === resolvedTarget) return true
        await fs.rm(linkPath, { force: true })
      } else {
        // A real directory or file occupies the slot — the CLI deletes it.
        await fs.rm(linkPath, { recursive: true, force: true })
      }
    } catch (error) {
      // ENOENT/ENOTDIR is the expected nothing-there case. Anything else
      // (including the CLI's ELOOP edge) is cleared best-effort — if the
      // removal fails, the symlink creation below fails too and the caller
      // falls back to a copy.
      if (!isMissingPathError(error)) {
        await fs.rm(linkPath, { recursive: true, force: true }).catch(() => {})
      }
    }
    const linkDir = dirname(linkPath)
    await fs.mkdir(linkDir, { recursive: true })
    const relativeTarget = relative(
      await resolveParentSymlinks(linkDir),
      target,
    )
    await fs.symlink(relativeTarget, linkPath)
    return true
  } catch {
    return false
  }
}
