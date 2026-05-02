import { lstat, readlink, access } from 'fs/promises'
import { dirname, join, resolve } from 'path'

import { match } from 'ts-pattern'

import type {
  AbsolutePath,
  SkillName,
  SymlinkInfo,
  SymlinkStatus,
} from '../../shared/types'
import { AGENTS } from '../constants'

/**
 * Result from checking if a path is a symlink or local folder
 */
interface LinkOrLocalResult {
  status: SymlinkStatus
  isLocal: boolean
}

/**
 * Check if a path is a symlink or local folder
 * @param path - Path to check
 * @returns
 * - Symlink: { status: 'valid'|'broken', isLocal: false }
 * - Local folder: { status: 'valid', isLocal: true }
 * - Missing: { status: 'missing', isLocal: false }
 * @example
 * checkLinkOrLocal('/Users/.claude/skills/foo')
 * // => { status: 'valid', isLocal: false } (symlink)
 * // => { status: 'valid', isLocal: true } (real folder)
 */
async function checkLinkOrLocal(path: string): Promise<LinkOrLocalResult> {
  try {
    const stats = await lstat(path)

    // Discriminate on file-stat kind:
    //   symlink   → check target (valid vs broken)
    //   directory → local skill (real folder)
    //   other     → treat as missing (file, socket, etc.)
    return await match({
      isSymlink: stats.isSymbolicLink(),
      isDirectory: stats.isDirectory(),
    })
      .with({ isSymlink: true }, async (): Promise<LinkOrLocalResult> => {
        // resolve() handles both absolute and relative targets correctly:
        // absolute target → returned as-is, relative → resolved from symlink's directory
        const target = await readlink(path)
        const resolvedTarget = resolve(dirname(path), target)
        try {
          await access(resolvedTarget)
          return { status: 'valid', isLocal: false }
        } catch {
          return { status: 'broken', isLocal: false }
        }
      })
      .with(
        { isSymlink: false, isDirectory: true },
        async (): Promise<LinkOrLocalResult> => ({
          status: 'valid',
          isLocal: true,
        }),
      )
      .otherwise(
        async (): Promise<LinkOrLocalResult> => ({
          status: 'missing',
          isLocal: false,
        }),
      )
  } catch {
    return { status: 'missing', isLocal: false }
  }
}

/**
 * Check symlink status for a skill across all agents
 * @param skillName - Name of the skill directory
 * @returns Array of symlink info for each agent
 * @example
 * checkSkillSymlinks('theme-generator')
 * // => [{ agentId: 'claude', status: 'valid', isLocal: false, ... }, ...]
 */
export async function checkSkillSymlinks(
  skillName: SkillName,
): Promise<SymlinkInfo[]> {
  const results = await Promise.all(
    AGENTS.map(async (agent) => {
      const linkPath = join(agent.path, skillName) as AbsolutePath
      const { status, isLocal } = await checkLinkOrLocal(linkPath)

      // Only symlinks (not local folders, not missing entries) have a target
      // worth recording. Read it lazily and tolerate failures so a flaky
      // readlink doesn't poison the whole scan.
      // readlink() returns the raw stored target string — relative when the
      // symlink was created with a relative target (`ln -s ../foo bar`). The
      // `AbsolutePath` contract requires an absolute path, so resolve it
      // against the symlink's parent directory, mirroring checkSymlinkStatus.
      let targetPath: AbsolutePath | undefined
      if (status !== 'missing' && !isLocal) {
        try {
          const target = await readlink(linkPath)
          targetPath = resolve(dirname(linkPath), target) as AbsolutePath
        } catch {
          // Leave undefined — the link disappeared between lstat and readlink
        }
      }

      return {
        agentId: agent.id,
        agentName: agent.name,
        status,
        targetPath,
        linkPath,
        isLocal,
      }
    }),
  )

  return results
}

/**
 * Check the status of a single symlink
 * @param linkPath - Path to the potential symlink
 * @returns Status: 'valid' | 'broken' | 'missing'
 * @example
 * checkSymlinkStatus('/Users/.claude/skills/foo')
 * // => 'valid' (if symlink exists and target exists)
 */
export async function checkSymlinkStatus(
  linkPath: AbsolutePath,
): Promise<SymlinkStatus> {
  try {
    const stats = await lstat(linkPath)

    if (!stats.isSymbolicLink()) {
      // It's a real directory/file, not a symlink
      return 'missing'
    }

    return await resolveSymlinkTarget(linkPath)
  } catch {
    return 'missing'
  }
}

/**
 * Fast-path of {@link checkSymlinkStatus} for callers that already proved the
 * path is a symbolic link (e.g. via `Dirent.isSymbolicLink()` from `readdir`).
 * Skips the redundant `lstat` syscall — saves one I/O per orphan candidate
 * across all agent dirs during a full scan.
 *
 * @param linkPath - Path that is known (by the caller) to be a symbolic link
 * @returns 'valid' if target exists, 'broken' if dangling, 'missing' if the
 * link itself disappeared between the readdir snapshot and the lookup
 * @example
 * // Inside a readdir loop where entry.isSymbolicLink() === true:
 * await checkSymlinkTargetFromKnownLink(join(dir, entry.name))
 */
export async function checkSymlinkTargetFromKnownLink(
  linkPath: AbsolutePath,
): Promise<SymlinkStatus> {
  try {
    return await resolveSymlinkTarget(linkPath)
  } catch {
    return 'missing'
  }
}

/**
 * Shared core: read the symlink, resolve it relative to its own directory
 * (handles both absolute and relative targets), then probe for existence.
 * Centralizing this makes the slow-path and fast-path identical in meaning.
 */
async function resolveSymlinkTarget(
  linkPath: AbsolutePath,
): Promise<SymlinkStatus> {
  const target = await readlink(linkPath)
  const resolvedTarget = resolve(dirname(linkPath), target)
  try {
    await access(resolvedTarget)
    return 'valid'
  } catch {
    return 'broken'
  }
}

/**
 * Count symlinks per status for a skill
 * @param symlinks - Array of symlink info
 * @returns Count of valid symlinks
 * @example
 * countValidSymlinks([{ status: 'valid' }, { status: 'missing' }])
 * // => 1
 */
export function countValidSymlinks(symlinks: SymlinkInfo[]): number {
  return symlinks.filter((s) => s.status === 'valid').length
}
