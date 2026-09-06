import { stat } from 'fs/promises'
import { join } from 'path'

import { isMissingPathError } from '@/main/utils/errorCode'
import type { AbsolutePath } from '@/shared/types'

/**
 * What a `SKILL.md` probe actually established about a candidate directory.
 * `unreadable` is deliberately NOT folded into `not-a-skill`: `EACCES`, `EIO`,
 * and `ELOOP` mean we could not look, which is a different fact from looking
 * and finding nothing, and the list must not render the two the same way.
 * @example 'unreadable'
 */
export type SkillDirProbe = 'valid' | 'not-a-skill' | 'unreadable'

/**
 * Probe a directory for a `SKILL.md` entry, keeping "could not determine" apart from "definitely not a skill".
 * Exists because {@link isValidSkillDir} collapses both into `false`, which made
 * a permissions problem on one skill look exactly like the user deleting it.
 * Called per candidate directory by {@link listSourceSkillDirs}.
 * @param dirPath - Absolute path to the candidate skill directory.
 * @returns
 * - `valid`: `SKILL.md` exists and is a regular file (its contents are NOT read)
 * - `not-a-skill`: the probe succeeded and `SKILL.md` is absent or not a file
 * - `unreadable`: the probe itself failed, so validity is unknown
 * @example
 * await probeSkillDir('/Users/me/.agents/skills/tdd-workflow') // => 'valid'
 */
export async function probeSkillDir(
  dirPath: AbsolutePath,
): Promise<SkillDirProbe> {
  try {
    const stats = await stat(join(dirPath, 'SKILL.md'))
    return stats.isFile() ? 'valid' : 'not-a-skill'
  } catch (error) {
    // Same rule the repo already settled on for symlink targets: only ENOENT
    // and ENOTDIR prove the path cannot exist. Everything else is a failed look.
    return isMissingPathError(error) ? 'not-a-skill' : 'unreadable'
  }
}

/**
 * Check if a directory is a valid skill directory (contains SKILL.md as a regular file).
 * Uses stat().isFile() instead of access() to verify the entry is actually a file,
 * not a directory or other filesystem object with the same name.
 * Fail-closed on purpose: every caller is a guard in front of a destructive or
 * fanning-out action, so an unreadable probe must read as "not a skill".
 * @param dirPath - Absolute path to the directory to check
 * @returns true if SKILL.md exists as a regular file in the directory
 * @example
 * await isValidSkillDir('/path/to/my-skill') // true if SKILL.md is a file
 */
export async function isValidSkillDir(dirPath: AbsolutePath): Promise<boolean> {
  return (await probeSkillDir(dirPath)) === 'valid'
}
