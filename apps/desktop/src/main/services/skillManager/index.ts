import type { SkillInstallOutcome, SkillSearchResult } from '@/shared/types'

import { installSkills, type SkillManagerInstallOptions } from './install'
import { removeSkills, type SkillRemoveOutcome } from './remove'
import { searchSkills } from './search'

/**
 * Public interface of the skill manager — the deep module that owns every
 * install/remove/search operation the app previously shelled out to
 * `npx skills` for (docs/adr/0003). Everything outside this directory
 * consumes the manager through this one seam; the sibling files are internal
 * implementation and must never be imported directly.
 *
 * Concurrency contract: `install` and `remove` mutate the global lock with
 * read-modify-write cycles and MUST run inside the app's `runLockWrite`
 * mutex — the IPC layer and the prune flow both do. `search` is read-only
 * network IO and needs no serialization.
 */

/** The manager's surface. Small on purpose: three verbs and one type re-export. */
export interface SkillManager {
  /**
   * Install skills from a GitHub repo or local directory into the universal
   * source plus the selected agents, verifying every write before reporting
   * success. Never throws for expected failures — bad sources, network
   * errors, and per-skill copy failures all come back as structured outcome
   * entries with UI-safe `userMessage`s.
   */
  install(options: SkillManagerInstallOptions): Promise<SkillInstallOutcome>
  /**
   * Remove skills by raw lock key, directory name, or `owner/repo` source,
   * cleaning agent directories, the canonical source, and the lock entry.
   * Implements the CLI's destructive semantics faithfully — whatever occupies
   * an agent slot is deleted — so unattended callers must run their own
   * real-directory guard upstream.
   */
  remove(names: readonly string[]): Promise<SkillRemoveOutcome>
  /**
   * Search the skills.sh marketplace API. Throws when the endpoint cannot
   * be reached — the renderer has a real error state, so a failed search
   * must not masquerade as an empty result list.
   */
  search(query: string): Promise<SkillSearchResult[]>
}

/**
 * The one shared manager instance. Stateless apart from the filesystem it
 * operates on, so a plain object suffices — there is no per-instance state
 * a second copy could corrupt.
 */
export const skillManager: SkillManager = {
  install: installSkills,
  remove: removeSkills,
  search: searchSkills,
}

// Option/outcome types consumers need to speak to the manager. Re-exported
// here so the seam is one import; the internal files stay private.
export type { SkillManagerInstallOptions } from './install'
export type { SkillRemoveOutcome } from './remove'

/**
 * Lock-key ↔ directory-name canonicalization, re-exported for the lock
 * service whose whole job is comparing those two forms. Byte-exact with the
 * CLI's `sanitizeName`.
 */
export { sanitizeName } from './copyLayout'
