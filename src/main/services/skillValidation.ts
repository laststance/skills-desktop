import { access } from 'fs/promises'
import { join } from 'path'

/**
 * Check if a directory is a valid skill directory (contains SKILL.md).
 * @param dirPath - Absolute path to the directory to check
 * @returns true if SKILL.md exists in the directory
 * @example
 * await isValidSkillDir('/path/to/my-skill') // true if SKILL.md exists
 */
export async function isValidSkillDir(dirPath: string): Promise<boolean> {
  try {
    await access(join(dirPath, 'SKILL.md'))
    return true
  } catch {
    return false
  }
}
