import { realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'

import { AGENTS, SOURCE_DIR } from '@/main/constants'
import type { AbsolutePath } from '@/shared/types'
import { toAbsolutePath } from '@/shared/types'

/**
 * Validate that a file path is within an allowed base directory.
 * Prevents path traversal attacks (e.g., reading ~/.ssh/id_rsa via IPC).
 *
 * When the requested path exists on disk we realpath it AND the base so
 * symlinks in either leg (e.g. macOS `/var → /private/var`) can't produce a
 * false-positive traversal error. When the requested path doesn't exist
 * (e.g. validating a path we're about to create), we skip realpath on both
 * sides so the comparison stays in a single coordinate system.
 *
 * Takes a raw `string` and returns an {@link AbsolutePath}: this function IS
 * the brand's construction site for any path that crosses the IPC boundary.
 * Callers must not assert the brand before validation — that would claim the
 * path is trusted on the way *in*, which is exactly what this guards against.
 *
 * @param requestedPath - The untrusted path to validate
 * @param allowedBases - Array of allowed base directories (trusted; built from
 *   {@link SOURCE_DIR} and the agent scan dirs)
 * @returns The normalized absolute path (with symlinks resolved if path exists)
 * @throws Error if path is outside all allowed bases
 * @example
 * validatePath('/Users/x/.agents/skills/foo/SKILL.md', [SOURCE_DIR])
 * // => '/Users/x/.agents/skills/foo/SKILL.md'
 * validatePath('/etc/passwd', [SOURCE_DIR])
 * // => throws Error('Path traversal attempt detected')
 */
export function validatePath(
  requestedPath: string,
  allowedBases: AbsolutePath[],
): AbsolutePath {
  const normalized = resolve(requestedPath)

  // Two-mode comparison: if the request path exists we canonicalize both
  // sides (handles symlinked bases); if not, we stay in the literal-resolve
  // coordinate system for both.
  let realPath: string
  let requestWasRealpathed: boolean
  try {
    realPath = realpathSync(normalized)
    requestWasRealpathed = true
  } catch {
    realPath = normalized
    requestWasRealpathed = false
  }

  for (const base of allowedBases) {
    const resolvedBase = resolve(base)
    let baseForCompare = resolvedBase
    if (requestWasRealpathed) {
      try {
        baseForCompare = realpathSync(resolvedBase)
      } catch {
        baseForCompare = resolvedBase
      }
    }
    const rel = relative(baseForCompare, realPath)
    if (!rel.startsWith('..') && !isAbsolute(rel)) {
      return toAbsolutePath(realPath)
    }
  }

  throw new Error('Path traversal attempt detected')
}

/**
 * All allowed base paths: SOURCE_DIR + all agent skills directories.
 * Duplicate directories are collapsed so universal agents that share the same
 * on-disk skills folder don't create redundant validation passes.
 * @returns Array of unique resolved base paths
 * @example
 * getAllowedBases()
 * // => ['/Users/x/.agents/skills', '/Users/x/.claude/skills', '/Users/x/.cursor/skills', ...]
 */
export function getAllowedBases(): AbsolutePath[] {
  return [...new Set([SOURCE_DIR, ...AGENTS.map((a) => a.path)])]
}
