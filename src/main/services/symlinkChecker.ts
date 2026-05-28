import { lstat, readlink, access, realpath } from 'fs/promises'
import { dirname, isAbsolute, join, resolve } from 'path'

import { match } from 'ts-pattern'

import { AGENTS } from '@/main/constants'
import { isMissingPathError } from '@/main/utils/errorCode'
import type {
  AbsolutePath,
  FilesystemEntryIdentity,
  SkillName,
  SymlinkInfo,
  SymlinkStatus,
} from '@/shared/types'

import { filesystemIdentityFromStats } from './filesystemIdentity'

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
        // Resolve through the physical parent so symlinked agent dirs mirror OS behavior.
        const target = await readlink(path)
        const resolvedTarget = await resolveRawSymlinkTarget(path, target)
        try {
          await access(resolvedTarget)
          return { status: 'valid', isLocal: false }
        } catch (error) {
          return {
            status: isMissingPathError(error) ? 'broken' : 'inaccessible',
            isLocal: false,
          }
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
      // against the physical symlink parent, mirroring checkSymlinkStatus.
      let targetPath: AbsolutePath | undefined
      let skillMdSymlinkTarget: AbsolutePath | undefined
      let filesystemIdentity: FilesystemEntryIdentity | undefined
      if (status !== 'missing' && !isLocal) {
        try {
          const target = await readlink(linkPath)
          targetPath = await resolveRawSymlinkTarget(linkPath, target)
        } catch {
          // Leave undefined — the link disappeared between lstat and readlink
        }
      } else if (isLocal) {
        // Local folder: probe the SKILL.md inside it for a gstack-managed
        // symlink. Per-agent so the renderer's badge attribution is bound to
        // THIS slot, not to a sibling agent that happens to share the name.
        const [skillMdTarget, localStats] = await Promise.all([
          readSymlinkTargetIfPresent(
            join(linkPath, 'SKILL.md') as AbsolutePath,
          ),
          lstat(linkPath).catch(() => undefined),
        ])
        skillMdSymlinkTarget = skillMdTarget
        filesystemIdentity = localStats
          ? filesystemIdentityFromStats(localStats)
          : undefined
      }

      return {
        agentId: agent.id,
        agentName: agent.name,
        status,
        targetPath,
        linkPath,
        isLocal,
        filesystemIdentity,
        skillMdSymlinkTarget,
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
 * Read the OS-resolved target of a symbolic link if the given path is itself a symlink.
 * Returns `undefined` when the path is a regular file or directory, when it
 * does not exist, or when readlink races with deletion.
 *
 * Used by the skill scanner to capture where a `SKILL.md` symlink points —
 * gstack-managed sibling skills (e.g. `~/.claude/skills/ship/`) have a real
 * directory whose `SKILL.md` is a symlink into the gstack source tree. The
 * raw target string is exposed to the renderer so it can match the `gstack`
 * path segment and decorate those skills with the G-Stack badge.
 *
 * @param path - Absolute path that *may or may not* be a symbolic link
 * @returns
 * - Path is a symlink: resolved absolute target (anchors relative targets to
 *   the link's physical parent directory)
 * - Path is a regular file/directory, missing, or fails mid-syscall: `undefined`
 * @example
 * await readSymlinkTargetIfPresent('/Users/me/.claude/skills/ship/SKILL.md')
 * // => '/Users/me/.claude/skills/gstack/ship/SKILL.md' (when symlinked)
 * await readSymlinkTargetIfPresent('/Users/me/.agents/skills/foo/SKILL.md')
 * // => undefined (regular file)
 */
export async function readSymlinkTargetIfPresent(
  path: AbsolutePath,
): Promise<AbsolutePath | undefined> {
  try {
    const stats = await lstat(path)
    if (!stats.isSymbolicLink()) return undefined

    // Resolve through the physical parent so symlinked agent dirs mirror OS behavior.
    const target = await readlink(path)
    return await resolveRawSymlinkTarget(path, target)
  } catch {
    return undefined
  }
}

/**
 * Resolve readlink's raw target exactly as the OS does when parent dirs include symlinks.
 * @param linkPath - Logical path to the symlink being inspected.
 * @param target - Raw `readlink` target, absolute or relative.
 * @returns Absolute target path anchored at the physical symlink parent.
 * @example
 * resolveRawSymlinkTarget('/home/me/.config/devin/skills/foo', '../../../../.agents/skills/foo')
 * // => '/home/me/.agents/skills/foo' when `.config` points into dotfiles
 */
export async function resolveRawSymlinkTarget(
  linkPath: string,
  target: string,
): Promise<AbsolutePath> {
  if (isAbsolute(target)) {
    return resolve(target) as AbsolutePath
  }
  const physicalParent = await realpath(dirname(linkPath))
  return resolve(physicalParent, target) as AbsolutePath
}

/**
 * Shared core: read the symlink, resolve it relative to its physical parent, then probe for existence.
 * Centralizing this makes the slow-path and fast-path identical in meaning.
 * @param linkPath - Symlink path whose raw target should be checked.
 * @returns `valid` when the target exists, otherwise `broken`.
 * @example
 * resolveSymlinkTarget('/Users/me/.config/devin/skills/foo')
 * // => 'valid'
 */
async function resolveSymlinkTarget(
  linkPath: AbsolutePath,
): Promise<SymlinkStatus> {
  const target = await readlink(linkPath)
  const resolvedTarget = await resolveRawSymlinkTarget(linkPath, target)
  try {
    await access(resolvedTarget)
    return 'valid'
  } catch (error) {
    return isMissingPathError(error) ? 'broken' : 'inaccessible'
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
