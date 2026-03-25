import { stat } from 'fs/promises'
import { join } from 'path'

/**
 * Check if a directory is a valid skill directory (contains SKILL.md as a regular file).
 * Uses stat().isFile() instead of access() to verify the entry is actually a file,
 * not a directory or other filesystem object with the same name.
 * @param dirPath - Absolute path to the directory to check
 * @returns true if SKILL.md exists as a regular file in the directory
 * @example
 * await isValidSkillDir('/path/to/my-skill') // true if SKILL.md is a file
 */
export async function isValidSkillDir(dirPath: string): Promise<boolean> {
  try {
    const stats = await stat(join(dirPath, 'SKILL.md'))
    return stats.isFile()
  } catch {
    return false
  }
}
