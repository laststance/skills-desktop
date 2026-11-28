import * as fs from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'

import { parse as parseYaml } from 'yaml'

/**
 * Skill discovery inside an extracted repository tree or a local directory —
 * a port of the skills CLI's `discoverSkills`/`parseSkillMd` (v1.7.4), minus
 * the plugin-manifest extras the port spec drops. A valid skill is a directory
 * holding a SKILL.md whose YAML frontmatter carries string `name` and
 * `description`; `metadata.internal: true` skills are skipped.
 *
 * Internal to `skillManager/` — not part of the module's public interface.
 */

/** One skill discovered in a source tree. */
export interface DiscoveredSkill {
  /**
   * Frontmatter `name` with terminal escapes stripped — NOT lowercase-folded.
   * This is the raw key the lock file is written under.
   */
  name: string
  /** Frontmatter `description`, escapes stripped and newlines collapsed. */
  description: string
  /** Absolute path of the directory holding the skill's SKILL.md. */
  path: string
  /**
   * Repo-relative path of the SKILL.md itself, forward slashes — the lock
   * entry's `skillPath` field. @example "skills/azure-ai/SKILL.md"
   */
  skillFilePath: string
}

/** Directories discovery never descends into (CLI `SKIP_DIRS`). */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '__pycache__',
])

/**
 * Agent-specific skill container directories the CLI scans at depth 3, ported
 * verbatim so repos laid out for one agent still surface their skills.
 */
const AGENT_PROJECT_SKILL_DIRS = [
  '.agents/skills',
  '.claude/skills',
  '.cline/skills',
  '.codebuddy/skills',
  '.codex/skills',
  '.commandcode/skills',
  '.continue/skills',
  '.factory/skills',
  '.github/skills',
  '.goose/skills',
  '.grok/skills',
  '.iflow/skills',
  '.junie/skills',
  '.kilo/skills',
  '.kilocode/skills',
  '.kimchi/skills',
  '.kiro/skills',
  '.minimax/skills',
  '.mux/skills',
  '.neovate/skills',
  '.opencode/skills',
  '.openhands/skills',
  '.pi/skills',
  '.posit/assistant/skills',
  '.qoder/skills',
  '.roo/skills',
  '.trae/skills',
  '.windsurf/skills',
  '.zcode/skills',
  '.zencoder/skills',
] as const

// Terminal-escape stripping, ported from the CLI's sanitizeMetadata chain.
const CSI_RE = /\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g
const OSC_RE = /\x1b\][\s\S]*?(?:\x07|\x1b\\)/g
const DCS_PM_APC_RE = /\x1b[P^_][\s\S]*?(?:\x1b\\)/g
const SIMPLE_ESC_RE = /\x1b[\x20-\x7e]/g
const C1_RE = /[\x80-\x9f]/g
const CONTROL_RE = /[\x00-\x06\x07\x08\x0b\x0c\x0d-\x1a\x1c-\x1f\x7f]/g

function stripTerminalEscapes(str: string): string {
  return str
    .replace(OSC_RE, '')
    .replace(DCS_PM_APC_RE, '')
    .replace(CSI_RE, '')
    .replace(SIMPLE_ESC_RE, '')
    .replace(C1_RE, '')
    .replace(CONTROL_RE, '')
}

/**
 * Clean a frontmatter string for display and hashing: strip terminal escapes,
 * fold newlines into spaces, trim. Ported from the CLI's `sanitizeMetadata`.
 */
export function sanitizeMetadata(str: string): string {
  return stripTerminalEscapes(str)
    .replace(/[\r\n]+/g, ' ')
    .trim()
}

/**
 * Split a SKILL.md into frontmatter data and body. The regex is byte-exact
 * with the CLI: optional BOM, `---` fences on their own lines.
 */
function parseFrontmatter(raw: string): { data: unknown; content: string } {
  const match = raw.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) return { data: {}, content: raw }
  let data: unknown = {}
  try {
    data = parseYaml(match[1]) ?? {}
  } catch {
    // A YAML parse error is reported by the caller as an invalid skill.
    return { data: null, content: match[2] ?? '' }
  }
  return { data, content: match[2] ?? '' }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function hasSkillMd(dir: string): Promise<boolean> {
  try {
    return (await fs.stat(join(dir, 'SKILL.md'))).isFile()
  } catch {
    return false
  }
}

/**
 * Parse one SKILL.md into a valid skill, or null when it does not qualify.
 * Invalid means: unreadable, unparseable YAML, missing/non-string name or
 * description, or `metadata.internal: true`. Never throws — discovery treats
 * a bad skill as absent, not fatal, because repos carry stray SKILL.md-like
 * files in examples and test fixtures.
 */
async function parseSkillMd(
  skillMdPath: string,
  basePath: string,
): Promise<DiscoveredSkill | null> {
  let content: string
  try {
    content = await fs.readFile(skillMdPath, 'utf-8')
  } catch {
    return null
  }
  const { data } = parseFrontmatter(content)
  if (!isRecord(data)) return null
  if (!data.name || !data.description) return null
  if (typeof data.name !== 'string' || typeof data.description !== 'string') {
    return null
  }
  const metadata = isRecord(data.metadata) ? data.metadata : undefined
  if (metadata?.internal === true) return null

  const skillDir = dirname(skillMdPath)
  const relativeDir =
    skillDir === basePath ? '' : skillDir.slice(basePath.length + 1)
  const relativePosix = relativeDir.split(sep).join('/')
  return {
    name: sanitizeMetadata(data.name),
    description: sanitizeMetadata(data.description),
    path: skillDir,
    skillFilePath: relativePosix ? `${relativePosix}/SKILL.md` : 'SKILL.md',
  }
}

/**
 * Recursive full-tree scan used as the discovery fallback: every directory
 * with a SKILL.md down to depth 5, skipping noise directories. Update passes
 * fullDepth because a lock's recorded path must not become a false
 * missing-upstream result merely because it lives below the install-time
 * discovery depth.
 */
async function findSkillDirs(
  dir: string,
  depth = 0,
  maxDepth = 5,
): Promise<string[]> {
  if (depth > maxDepth) return []
  try {
    const [hasSkill, entries] = await Promise.all([
      hasSkillMd(dir),
      fs.readdir(dir, { withFileTypes: true }),
    ])
    const currentDir = hasSkill ? [dir] : []
    const subDirResults = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && !SKIP_DIRS.has(entry.name))
        .map(async (entry) =>
          findSkillDirs(join(dir, entry.name), depth + 1, maxDepth),
        ),
    )
    return [...currentDir, ...subDirResults.flat()]
  } catch {
    return []
  }
}

/**
 * True when `subpath` stays inside `basePath` after resolution — the guard
 * that keeps a crafted `../../etc` subpath out of the scan.
 */
function isSubpathSafe(basePath: string, subpath: string): boolean {
  const normalizedBase = resolve(basePath)
  const normalizedTarget = resolve(join(basePath, subpath))
  return (
    normalizedTarget.startsWith(normalizedBase + sep) ||
    normalizedTarget === normalizedBase
  )
}

/**
 * Discover every valid skill under a source tree, following the CLI's search
 * order: root SKILL.md short-circuit, then priority container dirs (repo root
 * at depth 1, `skills/` variants and agent dirs at depth 3), then a full
 * depth-5 recursive fallback only when nothing matched. Skills are deduped by
 * frontmatter name, first match winning.
 * @param basePath - Root of the extracted repo or the local source directory.
 * @param subpath - Optional repo-relative directory the search is scoped to.
 * @returns Discovered skills in scan order.
 * @throws Error when `subpath` escapes `basePath`.
 * @example await discoverSkills('/tmp/extract', undefined) // => [{ name: 'azure-ai', ... }]
 */
export interface DiscoverSkillsOptions {
  /** Keep duplicate frontmatter names instead of first-match-wins. */
  includeDuplicateNames?: boolean
  /** Scan the whole tree even when priority discovery already found skills. */
  fullDepth?: boolean
}

export async function discoverSkills(
  basePath: string,
  subpath?: string,
  options: DiscoverSkillsOptions = {},
): Promise<DiscoveredSkill[]> {
  if (subpath && !isSubpathSafe(basePath, subpath)) {
    throw new Error(
      `Invalid subpath: "${subpath}" resolves outside the repository directory.`,
    )
  }
  // Lexical normalization only — every path below is joined from this base,
  // so the repo-relative slice in parseSkillMd stays consistent.
  basePath = resolve(basePath)
  const searchPath = subpath ? join(basePath, subpath) : basePath

  const skills: DiscoveredSkill[] = []
  const seenNames = new Set<string>()
  const parsedSkillPaths = new Set<string>()

  const parseSkillAt = async (
    skillDir: string,
  ): Promise<DiscoveredSkill | null> => {
    const skillMdPath = resolve(skillDir, 'SKILL.md')
    if (parsedSkillPaths.has(skillMdPath)) return null
    parsedSkillPaths.add(skillMdPath)
    return parseSkillMd(skillMdPath, basePath)
  }

  // 1) A SKILL.md directly at the search root means a single-skill source.
  if (await hasSkillMd(searchPath)) {
    const skill = await parseSkillAt(searchPath)
    if (skill) {
      skills.push(skill)
      seenNames.add(skill.name)
      if (!options.fullDepth) return skills
    }
  }

  // 2) Priority containers. The root itself scans direct children only;
  //    everything else scans to depth 3.
  const prioritySearchDirs = [
    searchPath,
    join(searchPath, 'skills'),
    join(searchPath, 'skills/.curated'),
    join(searchPath, 'skills/.experimental'),
    join(searchPath, 'skills/.system'),
    ...AGENT_PROJECT_SKILL_DIRS.map((dir) => join(searchPath, dir)),
  ]
  const deepContainerDirs = new Set(prioritySearchDirs.slice(1))

  const tryAddSkillAt = async (skillDir: string): Promise<boolean> => {
    if (!(await hasSkillMd(skillDir))) return false
    const skill = await parseSkillAt(skillDir)
    // An invalid SKILL.md still counts as "handled" so discovery does not
    // descend past it looking for more — same as the CLI.
    if (!skill || (!options.includeDuplicateNames && seenNames.has(skill.name)))
      return true
    skills.push(skill)
    seenNames.add(skill.name)
    return true
  }

  const walkSkillDirs = async (
    dir: string,
    maxDepth: number,
    depth = 1,
  ): Promise<void> => {
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const childDir = join(dir, entry.name)
      if (
        (await tryAddSkillAt(childDir)) ||
        depth >= maxDepth ||
        SKIP_DIRS.has(entry.name)
      ) {
        continue
      }
      await walkSkillDirs(childDir, maxDepth, depth + 1)
    }
  }

  for (const dir of prioritySearchDirs) {
    await walkSkillDirs(dir, deepContainerDirs.has(dir) ? 3 : 1)
  }

  // 3) Full scan when priority layout found nothing, or when update resolution
  //    explicitly needs every same-name/moved location in the tree.
  if (skills.length === 0 || options.fullDepth) {
    const allSkillDirs = await findSkillDirs(
      searchPath,
      0,
      options.fullDepth ? Number.POSITIVE_INFINITY : 5,
    )
    for (const skillDir of allSkillDirs) {
      const skill = await parseSkillAt(skillDir)
      if (
        skill &&
        (options.includeDuplicateNames || !seenNames.has(skill.name))
      ) {
        skills.push(skill)
        seenNames.add(skill.name)
      }
    }
  }

  return skills
}

/**
 * Filter discovered skills by user-supplied names. Matching is
 * case-insensitive exact equality on the frontmatter name, ported from the
 * CLI's `filterSkills`.
 * @param skills - Discovery output.
 * @param inputNames - `--skill` values plus any `@skill` source fragment.
 * @returns The subset of `skills` whose name matches at least one input.
 */
export function filterSkills(
  skills: readonly DiscoveredSkill[],
  inputNames: readonly string[],
): DiscoveredSkill[] {
  const normalizedInputs = inputNames.map((name) => name.toLowerCase())
  return skills.filter((skill) =>
    normalizedInputs.includes(skill.name.toLowerCase()),
  )
}
