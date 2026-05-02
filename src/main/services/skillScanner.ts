import { readdir, readFile, stat } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'

import { formatBytes } from '../../shared/fileTypes'
import { repositoryId } from '../../shared/types'
import type {
  AbsolutePath,
  HttpUrl,
  RepositoryId,
  Skill,
  SkillName,
  SourceStats,
} from '../../shared/types'
import { AGENTS, SOURCE_DIR } from '../constants'

import { listValidSourceSkillDirs } from './dirScanner'
import { parseSkillMetadata } from './metadataParser'
import { isValidSkillDir } from './skillValidation'
import {
  checkSkillSymlinks,
  checkSymlinkTargetFromKnownLink,
  countValidSymlinks,
} from './symlinkChecker'

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
 * Scan ~/.agents/skills/ and return all installed skills (source + local + orphan)
 *
 * Orphan symlinks (broken symlinks in agent dirs whose source skill no longer
 * exists) are surfaced as `Skill` records with `isSource:false` and per-agent
 * `symlinks[].status:'broken'`. Without this, broken-symlink data never enters
 * the renderer and `HealthWidget` reports 100% even when agents have dangling
 * links — see issue #127.
 *
 * Dedup precedence: source > local > orphan. A name that exists as a source
 * skill never becomes an orphan record (broken agent links for live source
 * skills are already represented inside `Skill.symlinks`).
 *
 * @returns Array of Skill objects with symlink info
 * @example
 * scanSkills()
 * // => [{ name: 'theme-generator', symlinkCount: 3, ... }]
 */
export async function scanSkills(): Promise<Skill[]> {
  // Orphan scan needs sourceNames to skip live sources, so it chains off
  // sourceSkills via .then() instead of awaiting separately — that lets it
  // overlap with scanAllLocalSkills and readSkillLock in the same Promise.all.
  const sourceSkillsPromise = scanSourceSkills()
  const orphanSkillsPromise = sourceSkillsPromise.then(async (src) =>
    scanOrphanSymlinks(new Set(src.map((s) => s.name))),
  )
  const [sourceSkills, localSkills, lockEntries, orphanSkills] =
    await Promise.all([
      sourceSkillsPromise,
      scanAllLocalSkills(),
      readSkillLock(),
      orphanSkillsPromise,
    ])

  // Merge precedence: source > local > orphan (first record's metadata wins).
  // Naive first-wins discards later records entirely — but a `local + orphan`
  // collision (real folder in agent A, broken symlink in agent B for the
  // same name) needs the orphan's broken slots merged into the local record,
  // otherwise the broken state silently disappears from the UI (issue #127's
  // failure mode resurfaces). Same agent slot can't legitimately have both
  // 'valid+local' and 'broken' (a path is either a directory or a symlink),
  // so per-slot non-missing-wins is conflict-free.
  const byName = new Map<SkillName, Skill>()
  for (const skill of [...sourceSkills, ...localSkills, ...orphanSkills]) {
    const existing = byName.get(skill.name)
    if (!existing) {
      byName.set(skill.name, skill)
      continue
    }
    for (let i = 0; i < existing.symlinks.length; i++) {
      if (
        existing.symlinks[i].status === 'missing' &&
        skill.symlinks[i].status !== 'missing'
      ) {
        existing.symlinks[i] = skill.symlinks[i]
      }
    }
    existing.symlinkCount = countValidSymlinks(existing.symlinks)
    // Once a real source or local folder is present, the skill is no longer
    // an orphan in the UI sense — only treat as orphan if every contributing
    // record agreed.
    existing.isOrphan = existing.isOrphan && skill.isOrphan
  }
  const allSkills = Array.from(byName.values())

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
        isSource: true,
        isOrphan: false,
      }
    }),
  )

  return skills
}

/**
 * Scan all agent directories for orphan symlinks — broken symlinks whose target
 * source skill no longer exists in `~/.agents/skills/`.
 *
 * Each orphan name collapses into a single `Skill` record whose `symlinks[]`
 * marks every affected agent as `'broken'` and the rest as `'missing'`. Names
 * that already exist as source skills are skipped — broken symlinks for live
 * sources are represented inside the source skill's own `symlinks[]`.
 *
 * @param sourceNames - Names of source skills to exclude from orphan scan
 * @returns Array of orphan skills with `isSource:false` and broken symlink info
 * @example
 * scanOrphanSymlinks(new Set(['theme-generator']))
 * // => [{ name: 'connect-chrome', isSource: false, symlinks: [{ status: 'broken', ... }] }]
 */
async function scanOrphanSymlinks(
  sourceNames: Set<SkillName>,
): Promise<Skill[]> {
  // Phase 1 — collect (agent, name, linkPath) tuples for every broken symlink
  // across all AGENTS in parallel. `entry.isSymbolicLink()` already proved
  // these are symlinks, so the fast-path checker skips the redundant lstat.
  const brokenLinks = (
    await Promise.all(
      AGENTS.map(async (agent) => {
        try {
          const entries = await readdir(agent.path, { withFileTypes: true })
          const candidates = entries.filter(
            (entry) => entry.isSymbolicLink() && !sourceNames.has(entry.name),
          )
          const statuses = await Promise.all(
            candidates.map(async (link) => {
              const linkPath = join(agent.path, link.name) as AbsolutePath
              const status = await checkSymlinkTargetFromKnownLink(linkPath)
              return { agent, name: link.name, linkPath, status }
            }),
          )
          return statuses.filter((s) => s.status === 'broken')
        } catch {
          return []
        }
      }),
    )
  ).flat()

  // Phase 2 — group by name; first sighting builds the full per-agent
  // template (every agent 'missing'), subsequent sightings flip that agent's
  // slot to 'broken'. Single branch, no existing/new split.
  const orphansByName = new Map<SkillName, Skill>()
  for (const { agent, name, linkPath } of brokenLinks) {
    let skill = orphansByName.get(name)
    if (!skill) {
      skill = {
        name,
        description: 'Orphan symlink — source skill no longer exists',
        path: linkPath,
        symlinkCount: 0,
        symlinks: AGENTS.map((a) => ({
          agentId: a.id,
          agentName: a.name,
          status: 'missing',
          linkPath: join(a.path, name) as AbsolutePath,
          isLocal: false,
        })),
        isSource: false,
        isOrphan: true,
      }
      orphansByName.set(name, skill)
    }
    const slot = skill.symlinks.findIndex((s) => s.agentId === agent.id)
    if (slot >= 0) {
      skill.symlinks[slot] = {
        ...skill.symlinks[slot],
        status: 'broken',
        linkPath,
      }
    }
  }

  return Array.from(orphansByName.values())
}

/**
 * Scan all agent directories for local skills (real folders, not symlinks).
 *
 * Mirrors {@link scanOrphanSymlinks}: Phase 1 fans out across every agent in
 * parallel collecting `(agent, skillPath, metadata)` tuples; Phase 2 groups
 * by skill name with first-sighting-creates / later-sightings-update logic
 * — no existing/new branch split, no per-agent sequential I/O.
 *
 * @returns Array of local skills with their per-agent presence map
 */
async function scanAllLocalSkills(): Promise<Skill[]> {
  // Phase 1 — for each agent, list real directories (not symlinks, not
  // dotfiles), validate them in parallel, and parse metadata only for the
  // ones that pass validation. Each successful tuple carries the bits Phase 2
  // needs to update the per-agent slot for that skill.
  const localHits = (
    await Promise.all(
      AGENTS.map(async (agent) => {
        try {
          const entries = await readdir(agent.path, { withFileTypes: true })
          const candidates = entries.filter(
            (e) =>
              e.isDirectory() && !e.isSymbolicLink() && !e.name.startsWith('.'),
          )
          const validated = await Promise.all(
            candidates.map(async (dir) => {
              const skillPath = join(agent.path, dir.name) as AbsolutePath
              if (!(await isValidSkillDir(skillPath))) return null
              const metadata = await parseSkillMetadata(skillPath)
              return { agent, dirName: dir.name, skillPath, metadata }
            }),
          )
          return validated.filter(
            (item): item is NonNullable<typeof item> => item !== null,
          )
        } catch {
          return []
        }
      }),
    )
  ).flat()

  // Phase 2 — group by skill name. First sighting builds the full per-agent
  // template (every agent 'missing'); every sighting (including the first)
  // then flips its own agent slot to a valid local entry. Single branch.
  const localSkillsByName = new Map<SkillName, Skill>()
  for (const { agent, dirName, skillPath, metadata } of localHits) {
    let skill = localSkillsByName.get(metadata.name)
    if (!skill) {
      skill = {
        name: metadata.name,
        description: metadata.description,
        path: skillPath,
        symlinkCount: 0, // Local skills have 0 symlinks
        symlinks: AGENTS.map((a) => ({
          agentId: a.id,
          agentName: a.name,
          status: 'missing',
          linkPath: join(a.path, dirName) as AbsolutePath,
          isLocal: false,
        })),
        isSource: false,
        isOrphan: false,
      }
      localSkillsByName.set(metadata.name, skill)
    }
    const slot = skill.symlinks.findIndex((s) => s.agentId === agent.id)
    if (slot >= 0) {
      skill.symlinks[slot] = {
        ...skill.symlinks[slot],
        status: 'valid',
        linkPath: join(agent.path, dirName) as AbsolutePath,
        isLocal: true,
      }
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
      isSource: true,
      isOrphan: false,
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
