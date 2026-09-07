import type { Dirent } from 'fs'
import { readdir } from 'fs/promises'
import { join } from 'path'

import { SOURCE_DIR } from '@/main/constants'
import { errorCode, isMissingPathError } from '@/main/utils/errorCode'
import { extractErrorMessage } from '@/main/utils/errors'
import type { AbsolutePath, SkillName } from '@/shared/types'
import { toAbsolutePath, toSkillName } from '@/shared/types'

import { probeSkillDir } from './skillValidation'

/**
 * Entry representing a skill directory on disk that the scan is keeping.
 * @example { name: 'tdd-workflow', path: '/Users/me/.agents/skills/tdd-workflow', isUnreadable: false }
 */
export interface SkillDirEntry {
  /** Directory name, matches the skill's identifier. @example "tdd-workflow" */
  name: SkillName
  /** Absolute path to the skill directory on disk. */
  path: AbsolutePath
  /**
   * `true` when `SKILL.md` could not be `stat`ed, so the app could not look at
   * it at all. The entry is still listed — dropping it would make a permissions
   * problem look like the user deleting the skill. A `SKILL.md` that stats fine
   * reads as readable here even if its contents are not; the probe never opens it.
   */
  isUnreadable: boolean
}

/**
 * Outcome of listing `~/.agents/skills/`, separating an empty folder from one we could not open.
 * `unreadable` exists because the previous `catch { return [] }` reported an
 * `EACCES` on the source directory as "no skills installed".
 * @example { status: 'unreadable' }
 */
export type SourceSkillDirListing =
  { status: 'listed'; entries: SkillDirEntry[] } | { status: 'unreadable' }

/**
 * List the skill directories under ~/.agents/skills/, keeping unprovable entries instead of dropping them.
 * Filters out hidden entries (e.g. .git, .DS_Store) and directories the probe
 * proved are not skills. Used by skillScanner and syncService to avoid
 * duplicating the readdir + filter + probe pattern.
 * @returns `listed` with one entry per kept directory, or `unreadable` when the source directory itself could not be read
 * @example
 * await listSourceSkillDirs()
 * // => { status: 'listed', entries: [{ name: 'theme-generator', path: '/Users/x/.agents/skills/theme-generator', isUnreadable: false }] }
 */
export async function listSourceSkillDirs(): Promise<SourceSkillDirListing> {
  let entries: Dirent[]
  try {
    entries = await readdir(SOURCE_DIR, { withFileTypes: true })
  } catch (error) {
    // A source directory that does not exist yet is a real empty state — a
    // fresh install before the first `skills add`. Anything else is a failed look.
    if (isMissingPathError(error)) return { status: 'listed', entries: [] }
    // The whole point of this TODO is that the failure stopped being silent,
    // so it is logged here as well as surfaced through `SourceStats`.
    console.warn('dirScanner: source skills directory could not be read', {
      code: errorCode(error),
      message: extractErrorMessage(error),
    })
    return { status: 'unreadable' }
  }

  const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.'))

  const results: SkillDirEntry[] = []
  for (const dir of dirs) {
    const skillPath = join(SOURCE_DIR, dir.name)
    // react-doctor-disable-next-line react-doctor/async-await-in-loop -- probeSkillDir per entry building the kept-dirs list; bounded local-fs reads kept sequential to stay fd-bounded.
    const probe = await probeSkillDir(toAbsolutePath(skillPath))
    if (probe === 'not-a-skill') continue
    results.push({
      name: toSkillName(dir.name),
      path: toAbsolutePath(skillPath),
      isUnreadable: probe === 'unreadable',
    })
  }
  return { status: 'listed', entries: results }
}
