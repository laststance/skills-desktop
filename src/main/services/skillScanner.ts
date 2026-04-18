import { readdir, readFile, stat } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'

import { formatBytes } from '../../shared/fileTypes'
import { repositoryId } from '../../shared/types'
import type {
  HttpUrl,
  RepositoryId,
  Skill,
  SkillName,
  SourceStats,
  SymlinkInfo,
} from '../../shared/types'
import { AGENTS, SOURCE_DIR } from '../constants'

import { listValidSourceSkillDirs } from './dirScanner'
import { parseSkillMetadata } from './metadataParser'
import { isValidSkillDir } from './skillValidation'
import { checkSkillSymlinks, countValidSymlinks } from './symlinkChecker'

/**
 * Entry from ~/.agents/.skill-lock.json
 * @example
 * {
 *   source: 'pbakaus/impeccable',
 *   sourceType: 'github',
 *   sourceUrl: 'https://github.com/pbakaus/impeccable.git',
 * }
 */
interface SkillLockEntry {
  /** Repository identifier in GitHub owner/repo form. @example "pbakaus/impeccable" */
  source: RepositoryId
  /** Source kind tag (free-form string from skills CLI). @example "github" */
  sourceType: string
  /** Full clone URL to the source repository. */
  sourceUrl: HttpUrl
}

/**
 * Read the global skill lock file to get source info for installed skills
 * @returns Map of skill name to lock entry
 * @example
 * readSkillLock()
 * // => Map { 'frontend-design' => { source: 'pbakaus/impeccable', sourceUrl: '...' } }
 */
async function readSkillLock(): Promise<Map<SkillName, SkillLockEntry>> {
  try {
    const lockPath = join(homedir(), '.agents', '.skill-lock.json')
    const content = await readFile(lockPath, 'utf-8')
    const parsed = JSON.parse(content) as {
      skills?: Record<string, SkillLockEntry>
    }
    return new Map(Object.entries(parsed.skills ?? {}))
  } catch {
    return new Map()
  }
}

/**
 * Scan ~/.agents/skills/ and return all installed skills (source + local)
 * @returns Array of Skill objects with symlink info
 * @example
 * scanSkills()
 * // => [{ name: 'theme-generator', symlinkCount: 3, ... }]
 */
export async function scanSkills(): Promise<Skill[]> {
  // Scan source skills, local skills, and lock file in parallel
  const [sourceSkills, localSkills, lockEntries] = await Promise.all([
    scanSourceSkills(),
    scanAllLocalSkills(),
    readSkillLock(),
  ])

  // Merge: local skills that don't exist in source
  const sourceNames = new Set(sourceSkills.map((s) => s.name))
  const uniqueLocalSkills = localSkills.filter((s) => !sourceNames.has(s.name))

  const allSkills = [...sourceSkills, ...uniqueLocalSkills]

  // Attach source info from lock file
  for (const skill of allSkills) {
    const dirName = skill.path.split('/').pop() || ''
    const lock = lockEntries.get(dirName) ?? lockEntries.get(skill.name)
    if (lock) {
      skill.source = repositoryId(lock.source)
      skill.sourceUrl = lock.sourceUrl
    }
  }

  // Sort by name
  return allSkills.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Scan source directory (~/.agents/skills/) for skills
 * @returns Array of source skills
 */
async function scanSourceSkills(): Promise<Skill[]> {
  const validDirs = await listValidSourceSkillDirs()

  const skills = await Promise.all(
    validDirs.map(async (dir) => {
      const metadata = await parseSkillMetadata(dir.path)
      const symlinks = await checkSkillSymlinks(dir.name)

      return {
        name: metadata.name,
        description: metadata.description,
        path: dir.path,
        symlinkCount: countValidSymlinks(symlinks),
        symlinks,
      }
    }),
  )

  return skills
}

/**
 * Scan all agent directories for local skills (real folders, not symlinks)
 * @returns Array of local skills with their agent associations
 */
async function scanAllLocalSkills(): Promise<Skill[]> {
  const localSkillsByName = new Map<string, Skill>()

  for (const agent of AGENTS) {
    try {
      const entries = await readdir(agent.path, { withFileTypes: true })
      // Get directories that are NOT symlinks and don't start with '.'
      const localDirs = entries.filter(
        (e) =>
          e.isDirectory() && !e.isSymbolicLink() && !e.name.startsWith('.'),
      )

      for (const dir of localDirs) {
        const skillPath = join(agent.path, dir.name)
        const isValid = await isValidSkillDir(skillPath)
        if (!isValid) continue

        const metadata = await parseSkillMetadata(skillPath)
        const existing = localSkillsByName.get(metadata.name)

        if (existing) {
          const symlinkIndex = existing.symlinks.findIndex(
            (s) => s.agentId === agent.id,
          )
          if (symlinkIndex >= 0) {
            existing.symlinks[symlinkIndex] = {
              ...existing.symlinks[symlinkIndex],
              status: 'valid',
              linkPath: join(agent.path, dir.name),
              isLocal: true,
            }
          }
          continue
        }

        // Initialize local skill with agent-specific status map.
        const symlinks: SymlinkInfo[] = AGENTS.map((a) => ({
          agentId: a.id,
          agentName: a.name,
          status: a.id === agent.id ? 'valid' : ('missing' as const),
          targetPath: '',
          linkPath: join(a.path, dir.name),
          isLocal: a.id === agent.id,
        }))

        localSkillsByName.set(metadata.name, {
          name: metadata.name,
          description: metadata.description,
          path: skillPath,
          symlinkCount: 0, // Local skills have 0 symlinks
          symlinks,
        })
      }
    } catch {
      // Agent directory doesn't exist, skip
    }
  }

  return Array.from(localSkillsByName.values())
}

/**
 * Get a single skill by name
 * @param skillName - Name of the skill directory
 * @returns Skill object or null if not found
 * @example
 * getSkill('theme-generator')
 * // => { name: 'theme-generator', ... } or null
 */
export async function getSkill(skillName: SkillName): Promise<Skill | null> {
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
    const validDirs = await listValidSourceSkillDirs()
    const stats = await stat(SOURCE_DIR)
    const totalBytes = await calculateDirectorySize(SOURCE_DIR)

    return {
      path: SOURCE_DIR,
      skillCount: validDirs.length,
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
