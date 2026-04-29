import {
  existsSync,
  lstatSync,
  readdirSync,
  readlinkSync,
  realpathSync,
} from 'node:fs'
import { join } from 'node:path'

/**
 * Assert that `path` is a symlink whose target (canonicalized) matches
 * `expectedTarget` (also canonicalized). Throws a descriptive error
 * otherwise so spec failures point straight at the broken link.
 */
export function assertSymlinkValid(path: string, expectedTarget: string): void {
  if (!existsSync(path)) {
    throw new Error(`Expected symlink at ${path} but path does not exist`)
  }
  const stat = lstatSync(path)
  if (!stat.isSymbolicLink()) {
    throw new Error(`Expected ${path} to be a symlink but it is not`)
  }
  const actualTarget = realpathSync.native(path)
  const canonicalExpected = realpathSync.native(expectedTarget)
  if (actualTarget !== canonicalExpected) {
    throw new Error(
      `Symlink target mismatch at ${path}\n  expected: ${canonicalExpected}\n  actual:   ${actualTarget}`,
    )
  }
}

/**
 * Assert the path is a symlink whose target no longer exists. Used after
 * deletion flows where the link itself may persist briefly.
 */
export function assertSymlinkBroken(path: string): void {
  const stat = lstatSync(path)
  if (!stat.isSymbolicLink()) {
    throw new Error(
      `Expected ${path} to be a symlink, got ${stat.isFile() ? 'file' : 'directory'}`,
    )
  }
  const target = readlinkSync(path)
  const resolved = join(path, '..', target)
  if (existsSync(resolved)) {
    throw new Error(
      `Expected broken symlink at ${path}, but target ${target} still exists`,
    )
  }
}

/** Assert that no entry exists at `path` (lstat-level, follows nothing). */
export function assertPathMissing(path: string): void {
  if (existsSync(path)) {
    throw new Error(`Expected ${path} to be missing but it exists`)
  }
}

/**
 * List the immediate children of the universal source directory
 * (`<home>/.agents/skills/`). Returns directory names only; throws if the
 * source directory itself is missing (which usually indicates a regression).
 */
export function readSourceDirEntries(home: string): string[] {
  const sourceDir = join(home, '.agents', 'skills')
  if (!existsSync(sourceDir)) {
    throw new Error(`Source dir missing: ${sourceDir}`)
  }
  return readdirSync(sourceDir).sort()
}
