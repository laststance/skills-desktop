import { readdir } from 'fs/promises'
import { join } from 'path'

import type { AbsolutePath, SkillName } from '../../shared/types'
import { SOURCE_DIR } from '../constants'

import { isValidSkillDir } from './skillValidation'

/**
 * Entry representing a valid skill directory on disk.
 * @example { name: 'tdd-workflow', path: '/Users/me/.agents/skills/tdd-workflow' }
 */
export interface SkillDirEntry {
  /** Directory name, matches the skill's identifier. @example "tdd-workflow" */
  name: SkillName
  /** Absolute path to the skill directory on disk. */
  path: AbsolutePath
}

/**
 * List all valid skill directories under ~/.agents/skills/.
 * Filters out hidden entries (e.g. .git, .DS_Store) and directories
 * without a SKILL.md file. Used by skillScanner and syncService
 * to avoid duplicating the readdir + filter + validate pattern.
 * @returns Array of { name, path } for each valid skill directory
 * @example
 * listValidSourceSkillDirs()
 * // => [{ name: 'theme-generator', path: '/Users/x/.agents/skills/theme-generator' }]
 */
export async function listValidSourceSkillDirs(): Promise<SkillDirEntry[]> {
  try {
    const entries = await readdir(SOURCE_DIR, { withFileTypes: true })
    const dirs = entries.filter(
      (e) => e.isDirectory() && !e.name.startsWith('.'),
    )

    const results: SkillDirEntry[] = []
    for (const dir of dirs) {
      const skillPath = join(SOURCE_DIR, dir.name)
      if (await isValidSkillDir(skillPath)) {
        results.push({ name: dir.name, path: skillPath })
      }
    }
    return results
  } catch {
    return []
  }
}
