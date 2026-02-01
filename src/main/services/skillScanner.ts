import { access, readdir, stat } from 'fs/promises'
import { join } from 'path'

import type { Skill, SourceStats } from '../../shared/types'
import { SOURCE_DIR } from '../constants'

import { parseSkillMetadata } from './metadataParser'
import { checkSkillSymlinks, countValidSymlinks } from './symlinkChecker'

/**
 * Check if a directory is a valid skill (has SKILL.md)
 * @param dirPath - Path to the directory
 * @returns True if SKILL.md exists
 */
async function isValidSkillDir(dirPath: string): Promise<boolean> {
  try {
    await access(join(dirPath, 'SKILL.md'))
    return true
  } catch {
    return false
  }
}

/**
 * Scan ~/.agents/skills/ and return all installed skills
 * @returns Array of Skill objects with symlink info
 * @example
 * scanSkills()
 * // => [{ name: 'theme-generator', symlinkCount: 3, ... }]
 */
export async function scanSkills(): Promise<Skill[]> {
  try {
    const entries = await readdir(SOURCE_DIR, { withFileTypes: true })
    // Filter: directories only, exclude hidden (e.g., .git, .DS_Store)
    const skillDirs = entries.filter(
      (e) => e.isDirectory() && !e.name.startsWith('.'),
    )

    // Validate each directory has SKILL.md
    const validSkillDirs = await Promise.all(
      skillDirs.map(async (dir) => {
        const skillPath = join(SOURCE_DIR, dir.name)
        const isValid = await isValidSkillDir(skillPath)
        return isValid ? dir : null
      }),
    )

    const skills = await Promise.all(
      validSkillDirs
        .filter((dir): dir is NonNullable<typeof dir> => dir !== null)
        .map(async (dir) => {
          const skillPath = join(SOURCE_DIR, dir.name)
          const metadata = await parseSkillMetadata(skillPath)
          const symlinks = await checkSkillSymlinks(dir.name)

          return {
            name: metadata.name,
            description: metadata.description,
            path: skillPath,
            symlinkCount: countValidSymlinks(symlinks),
            symlinks,
          }
        }),
    )

    // Sort by name
    return skills.sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    // Source directory doesn't exist
    return []
  }
}

/**
 * Get a single skill by name
 * @param skillName - Name of the skill directory
 * @returns Skill object or null if not found
 * @example
 * getSkill('theme-generator')
 * // => { name: 'theme-generator', ... } or null
 */
export async function getSkill(skillName: string): Promise<Skill | null> {
  const skillPath = join(SOURCE_DIR, skillName)

  try {
    const stats = await stat(skillPath)
    if (!stats.isDirectory()) return null

    const metadata = await parseSkillMetadata(skillPath)
    const symlinks = await checkSkillSymlinks(skillName)

    return {
      name: metadata.name,
      description: metadata.description,
      path: skillPath,
      symlinkCount: countValidSymlinks(symlinks),
      symlinks,
    }
  } catch {
    return null
  }
}

/**
 * Get source directory statistics
 * @returns Stats including skill count and total size
 * @example
 * getSourceStats()
 * // => { path: '~/.agents/skills', skillCount: 5, totalSize: '2.3 MB' }
 */
export async function getSourceStats(): Promise<SourceStats> {
  try {
    const entries = await readdir(SOURCE_DIR, { withFileTypes: true })
    // Filter: directories only, exclude hidden, validate SKILL.md exists
    const candidateDirs = entries.filter(
      (e) => e.isDirectory() && !e.name.startsWith('.'),
    )
    const validChecks = await Promise.all(
      candidateDirs.map(async (dir) => {
        const skillPath = join(SOURCE_DIR, dir.name)
        return isValidSkillDir(skillPath)
      }),
    )
    const skillDirs = candidateDirs.filter((_, i) => validChecks[i])

    const stats = await stat(SOURCE_DIR)
    const totalBytes = await calculateDirectorySize(SOURCE_DIR)

    return {
      path: SOURCE_DIR,
      skillCount: skillDirs.length,
      totalSize: formatBytes(totalBytes),
      lastModified: stats.mtime.toISOString(),
    }
  } catch {
    return {
      path: SOURCE_DIR,
      skillCount: 0,
      totalSize: '0 B',
      lastModified: new Date().toISOString(),
    }
  }
}

/**
 * Calculate total size of a directory recursively
 * @param dirPath - Directory path
 * @returns Total size in bytes
 */
async function calculateDirectorySize(dirPath: string): Promise<number> {
  let total = 0

  try {
    const entries = await readdir(dirPath, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name)
      if (entry.isDirectory()) {
        total += await calculateDirectorySize(fullPath)
      } else if (entry.isFile()) {
        const stats = await stat(fullPath)
        total += stats.size
      }
    }
  } catch {
    // Ignore errors
  }

  return total
}

/**
 * Format bytes to human-readable string
 * @param bytes - Number of bytes
 * @returns Formatted string (e.g., '2.3 MB')
 */
function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB']
  let size = bytes
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex++
  }

  return `${size.toFixed(unitIndex > 0 ? 1 : 0)} ${units[unitIndex]}`
}
