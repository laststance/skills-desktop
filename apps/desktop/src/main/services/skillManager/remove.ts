import * as fs from 'node:fs/promises'
import { join } from 'node:path'

import { SOURCE_DIR, resolveAgentSkillsPath } from '@/main/constants'
import { extractErrorMessage } from '@/main/utils/errors'
import { AGENT_DEFINITIONS } from '@/shared/constants'

import { sanitizeName } from './copyLayout'
import { readSkillLock, removeSkillFromLock } from './lockFile'

/**
 * Removal for the skill manager — a global-scope-only port of the skills
 * CLI's `remove` command (v1.7.4). Project scope, eve subagents, and the
 * interactive picker are dropped per the port spec (docs/adr/0003). The one
 * deliberate upgrade over the CLI: per-item failures are reported in the
 * result instead of being logged while the process exits 0.
 *
 * Like the CLI, removal deletes whatever occupies the agent-side slot —
 * symlink, real directory, or file. Callers that run unattended (the lock
 * prune flow) are responsible for the real-directory guard upstream; the
 * manager implements the CLI's semantics faithfully and does not second-guess
 * them.
 *
 * Internal to `skillManager/` — the public seam is `index.ts`.
 */

/** Per-item removal outcome. */
export interface SkillRemoveItem {
  /** The requested name as passed in — not the resolved lock key. */
  name: string
  success: boolean
  /** UI-safe failure reason; absent on success. */
  userMessage?: string
  /** Raw error message for logs. */
  error?: string
}

/** Whole-operation removal outcome. */
export interface SkillRemoveOutcome {
  /** true when every requested name resolved and was removed. */
  success: boolean
  results: SkillRemoveItem[]
}

/**
 * Agent skill directories removal cleans, resolved from the app's own agent
 * definitions. Universal agents (installDir `.agents`) alias the canonical
 * source itself and are excluded up front — the CLI does the same via its
 * `pathToCleanup === canonicalPath` skip.
 */
function nonUniversalAgentSkillsDirs(): string[] {
  const dirs: string[] = []
  for (const definition of AGENT_DEFINITIONS) {
    if (definition.installDir === '.agents') continue
    const skillsDir = resolveAgentSkillsPath(definition.installDir)
    if (!dirs.includes(skillsDir)) dirs.push(skillsDir)
  }
  return dirs
}

/**
 * Resolve one requested name to the removal targets it refers to, porting
 * the CLI's `resolveSkillsToRemove`: exact-sanitized match against canonical
 * folder names and lock keys first, then a match against the entry's
 * `source` field (so `owner/repo` removes everything installed from that
 * repo). Names are matched through {@link sanitizeName} because the lock is
 * keyed raw while users type the directory form.
 * @returns The resolved keys — possibly several for a source match, or
 *   empty when nothing matches.
 */
function resolveRemovalTargets(
  requested: string,
  lockKeys: readonly string[],
  folderNames: readonly string[],
  sourceByKey: Readonly<Record<string, string | undefined>>,
): string[] {
  const identityBySanitized = new Map<string, string>()
  // Folder names feed identity first — same precedence as the CLI — so a
  // skill that exists on disk but never made it into the lock still removes.
  for (const folder of folderNames)
    identityBySanitized.set(sanitizeName(folder), folder)
  for (const key of lockKeys) identityBySanitized.set(sanitizeName(key), key)
  const direct = identityBySanitized.get(sanitizeName(requested))
  if (direct) return [direct]
  return lockKeys.filter((key) => sourceByKey[key] === requested)
}

/**
 * List canonical skill folder names for removal resolution — the CLI's
 * scan of `~/.agents/skills`. Hidden entries and non-directories are skipped.
 */
async function scanCanonicalFolderNames(): Promise<string[]> {
  let entries
  try {
    entries = await fs.readdir(SOURCE_DIR, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
}

/**
 * Remove skills by name, cleaning every app-known agent directory, then the
 * canonical source, then the lock entry — in that order, so a failure mid-way
 * leaves the lock pointing at whatever still exists rather than the reverse.
 * Must run inside the caller's lock-write mutex: the lock update is a
 * read-modify-write.
 * @param names - Requested names: raw lock keys, sanitized directory names,
 *   or `owner/repo` source strings, matching the CLI's resolution rules.
 * @returns Per-item outcomes; never throws for expected filesystem failures.
 * @example await removeSkills(['old-skill'])
 */
export async function removeSkills(
  names: readonly string[],
): Promise<SkillRemoveOutcome> {
  let lock
  try {
    lock = await readSkillLock()
  } catch (error) {
    const message = extractErrorMessage(error)
    return {
      success: false,
      results: names.map((requested) => ({
        name: requested,
        success: false,
        error: message,
        userMessage: `"${requested}" could not be removed because the skill lock could not be read: ${message}`,
      })),
    }
  }
  const lockKeys = Object.keys(lock.skills)
  const sourceByKey: Record<string, string | undefined> = {}
  for (const key of lockKeys) {
    const source = lock.skills[key]?.source
    sourceByKey[key] = typeof source === 'string' ? source : undefined
  }
  const agentSkillsDirs = nonUniversalAgentSkillsDirs()
  const folderNames = await scanCanonicalFolderNames()

  const results: SkillRemoveItem[] = []
  for (const requested of names) {
    try {
      const targets = resolveRemovalTargets(
        requested,
        lockKeys,
        folderNames,
        sourceByKey,
      )
      if (targets.length === 0) {
        results.push({
          name: requested,
          success: false,
          error: `No matching skill found for: ${requested}`,
          userMessage: `"${requested}" is not installed.`,
        })
        continue
      }
      for (const key of targets) {
        const sanitized = sanitizeName(key)
        const canonicalDir = join(SOURCE_DIR, sanitized)

        // 1) Agent-side slots first: symlinks, copies, or files all go, and
        //    a slot that aliases the canonical is never double-removed.
        for (const skillsDir of agentSkillsDirs) {
          const agentPath = join(skillsDir, sanitized)
          if (agentPath === canonicalDir) continue
          try {
            await fs.rm(agentPath, { recursive: true, force: true })
          } catch (error) {
            // Matches the CLI: a single agent that refuses cleanup warns but
            // does not fail the removal.
            console.warn(
              `skillManager: could not remove ${agentPath}: ${extractErrorMessage(error)}`,
            )
          }
        }

        // 2) Canonical source. The CLI skips this when an agent outside the
        //    target set still uses the skill; this implementation targets
        //    every known agent, so nothing can still use it.
        await fs.rm(canonicalDir, { recursive: true, force: true })

        // 3) Lock entry last, so a crash before this point still leaves the
        //    record pointing at whatever cleanup did not finish.
        await removeSkillFromLock(key)
      }
      results.push({ name: requested, success: true })
    } catch (error) {
      const message = extractErrorMessage(error)
      results.push({
        name: requested,
        success: false,
        error: message,
        userMessage: `"${requested}" could not be removed: ${message}`,
      })
    }
  }
  return {
    success: results.every((result) => result.success),
    results,
  }
}
