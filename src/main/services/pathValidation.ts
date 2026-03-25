import { resolve, relative, isAbsolute } from 'node:path'

import { AGENTS, SOURCE_DIR } from '../constants'

/**
 * Validate that a file path is within an allowed base directory.
 * Prevents path traversal attacks (e.g., reading ~/.ssh/id_rsa via IPC).
 * @param requestedPath - The path to validate
 * @param allowedBases - Array of allowed base directories
 * @returns The normalized absolute path
 * @throws Error if path is outside all allowed bases
 * @example
 * validatePath('/Users/x/.agents/skills/foo/SKILL.md', [SOURCE_DIR])
 * // => '/Users/x/.agents/skills/foo/SKILL.md'
 * validatePath('/etc/passwd', [SOURCE_DIR])
 * // => throws Error('Path traversal attempt detected')
 */
export function validatePath(
  requestedPath: string,
  allowedBases: string[],
): string {
  const normalized = resolve(requestedPath)

  for (const base of allowedBases) {
    const resolvedBase = resolve(base)
    const rel = relative(resolvedBase, normalized)
    if (!rel.startsWith('..') && !isAbsolute(rel)) {
      return normalized
    }
  }

  throw new Error('Path traversal attempt detected')
}

/**
 * All allowed base paths: SOURCE_DIR + all agent skills directories.
 * @returns Array of resolved base paths
 * @example
 * getAllowedBases()
 * // => ['/Users/x/.agents/skills', '/Users/x/.claude/skills', '/Users/x/.cursor/skills', ...]
 */
export function getAllowedBases(): string[] {
  return [SOURCE_DIR, ...AGENTS.map((a) => a.path)]
}
