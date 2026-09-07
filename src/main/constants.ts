import { realpathSync } from 'fs'
import { homedir } from 'os'
import { join, resolve } from 'path'

import { AGENT_DEFINITIONS } from '@/shared/constants'
import { toAbsolutePath } from '@/shared/types'

/**
 * Source directory for all skills
 */
export const SOURCE_DIR = toAbsolutePath(join(homedir(), '.agents', 'skills'))

/**
 * Root of the on-disk trash used by the staged-delete/undo flow.
 * Created lazily on first delete. Lives here rather than inside
 * `trashService` so `skillLockService` can read pending tombstone manifests
 * without importing the trash service back (that direction is already taken:
 * `trashService` imports the lock service for its prune hook).
 */
export const TRASH_DIR = toAbsolutePath(join(homedir(), '.agents', '.trash'))

/**
 * Filename that marks a trash entry as terminal: its automatic restore already
 * failed for good, so `startupCleanup` must never sweep it and the lock scan
 * must never count it as "still restorable". Lives here for the same reason as
 * {@link TRASH_DIR} — both services read it and the import direction between
 * them is already spent (`trashService` imports `skillLockService`).
 */
export const MANUAL_RECOVERY_MARKER = '.manual-recovery'

/**
 * Basename prefix a trash entry wears while it is still being assembled.
 * `moveToTrash` builds the entry under this name and publishes it with one
 * atomic rename, so a kill mid-move leaves a directory that no reader treats
 * as a tombstone: {@link tombstoneIdSchema} and startup cleanup's name parse
 * both require a leading `\d+`, which this prefix breaks. Nothing sweeps a
 * staged name — it can hold the user's only copy of a skill.
 */
export const STAGED_ENTRY_PREFIX = '.staging-'

/**
 * Supported AI agents with their full skills directory paths.
 *
 * Built from `scanDir` (always required on AGENT_DEFINITIONS). For most
 * agents `scanDir === installDir`. For Cline and Warp, whose CLI install
 * path is the universal `~/.agents/skills`, `scanDir` overrides to
 * `~/.cline/skills` / `~/.warp/skills` so the scanner reads the agent's
 * own home dir — never the universal source.
 */
export const AGENTS = AGENT_DEFINITIONS.map((agent) => ({
  id: agent.id,
  name: agent.name,
  path: toAbsolutePath(join(homedir(), agent.scanDir, 'skills')),
}))

/**
 * Paths where a "delete everything under this agent" op would destroy data
 * that belongs to more than just that agent — either the Universal source
 * itself, or a directory that multiple agent rows point at on disk
 * (e.g. `~/.config/agents/skills`, shared by amp/replit).
 *
 * Mental model: each agent has its OWN dedicated skills dir (`AGENTS.path`,
 * derived from `scanDir`) AND additionally reads from the universal source
 * `~/.agents/skills/`. The two are independent reads, not an alias.
 * The set guards against `fs.rm(agentPath)` wiping a directory shared with
 * another agent — the v0.13.0 regression scenario.
 *
 * SOURCE_DIR is always seeded so it's protected even when no agent path
 * collides with it (post-fix Cline/Warp scan their own home dirs, leaving
 * SOURCE_DIR unaliased among AGENTS). Computed once so adding another
 * universal-style agent via a Skills CLI sync auto-populates this set without
 * touching every caller. Consumed by the IPC destructive-op handler as a
 * last-line guard; the sidebar does NOT filter on this set — visibility of
 * every agent is load-bearing for Cursor-style direct-file workflows.
 */
export const SHARED_AGENT_PATHS: ReadonlySet<string> = (() => {
  const counts = new Map<string, number>()
  for (const a of AGENTS) counts.set(a.path, (counts.get(a.path) ?? 0) + 1)
  const shared = new Set<string>([SOURCE_DIR])
  for (const [path, count] of counts) {
    if (count > 1) shared.add(path)
  }
  return shared
})()

/**
 * Returns true if this path is SOURCE_DIR or a dir that multiple agent
 * definitions currently resolve to. Used by the delete handler to reject
 * destructive ops whose blast radius exceeds the single agent the user
 * thinks they're acting on.
 *
 * Three-stage check, cheapest first:
 *  1. `resolve(path)` normalizes trailing slash, `..`, and double-slash
 *     so string-level shapes can't bypass Set.has().
 *  2. `realpathSync.native(path)` follows directory-level symlinks so a
 *     manually-created alias like `~/.cursor/skills → ~/.agents/skills`
 *     is caught by comparing the symlink target against the Set.
 *  3. Realpath each entry in SHARED_AGENT_PATHS and compare canonical
 *     forms. Required because SHARED_AGENT_PATHS is built via `join()`,
 *     which does not resolve OS-level firmlinks (macOS `/var` →
 *     `/private/var`). Without this stage, a symlink alias whose
 *     realpath lands on SOURCE_DIR but crosses a firmlink would slip
 *     through. O(|SHARED_AGENT_PATHS|) realpath calls in the slow path
 *     only; the fast paths catch the common cases first.
 *
 * Returns false on non-existent paths (realpath throws ENOENT): a path
 * that doesn't exist on disk can't be a shared-dir alias.
 * @example isSharedAgentPath('/Users/me/.agents/skills') // => true
 * @example isSharedAgentPath('/Users/me/.agents/skills/') // => true (normalized)
 * @example isSharedAgentPath('/Users/me/.cursor/skills') // => false
 */
export function isSharedAgentPath(path: string): boolean {
  const resolved = resolve(path)
  if (SHARED_AGENT_PATHS.has(resolved)) return true

  let realInput: string
  try {
    realInput = realpathSync.native(resolved)
  } catch {
    return false
  }
  if (SHARED_AGENT_PATHS.has(realInput)) return true

  for (const sharedPath of SHARED_AGENT_PATHS) {
    try {
      if (realpathSync.native(sharedPath) === realInput) return true
    } catch {
      // Shared path doesn't exist on disk; can't be the alias target.
    }
  }
  return false
}

/**
 * Look up an agent by its internal ID.
 * Used by IPC handlers that receive an agentId from the renderer.
 * @param agentId - The agent's internal identifier
 * @returns The matching agent or undefined if not found
 * @example
 * findAgentById('claude')  // => { id: 'claude', name: 'Claude Code', path: '...' }
 * findAgentById('unknown') // => undefined
 */
export function findAgentById(
  agentId: string,
): (typeof AGENTS)[number] | undefined {
  return AGENTS.find((a) => a.id === agentId)
}

/** Background files stay private and every read remains bounded while an external file changes. */
export const BACKGROUND_READ_CHUNK_BYTES = 64 * 1024
export const BACKGROUND_DIRECTORY_MODE = 0o700
export const BACKGROUND_FILE_MODE = 0o600
export const BACKGROUND_WEBP_QUALITY = 88
export const BACKGROUND_THUMBNAIL_WEBP_QUALITY = 78
export const BACKGROUND_WEBP_EFFORT = 4
export const BACKGROUND_PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex')
export const BACKGROUND_JPEG_SIGNATURE = Buffer.from('ffd8ff', 'hex')
export const BACKGROUND_CHUNK_HEADER_BYTES = 8
export const BACKGROUND_PNG_CRC_BYTES = 4
export const BACKGROUND_WEBP_HEADER_BYTES = 12
export const BACKGROUND_WEBP_ANIMATION_FLAG = 0x02
