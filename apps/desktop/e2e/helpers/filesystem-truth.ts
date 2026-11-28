import { constants as fsConstants } from 'node:fs'
import {
  access,
  lstat,
  readdir,
  readFile,
  readlink,
  stat,
} from 'node:fs/promises'
import { join } from 'node:path'

/** Serializable identity of one directory entry used to prove ownership before cleanup. */
export interface FilesystemEntryIdentity {
  kind: 'directory' | 'symlink' | 'file' | 'other'
  dev: number
  ino: number
  size: number
  ctimeMs: number
  mtimeMs: number
}

interface ProtectedEntry {
  name: string
  kind: FilesystemEntryIdentity['kind']
  target: string | null
}

export interface ProtectedDirectorySnapshot {
  status: 'missing' | 'present'
  entries: ProtectedEntry[]
}

/**
 * Classify one filesystem entry without following a symlink.
 * Exists because deletion and ownership checks must distinguish a real directory
 * from a link before deciding what the app is allowed to remove.
 * @param path - Absolute path to inspect.
 * @returns Entry kind or `null` when the directory entry itself is absent.
 * @example await entryKind('/tmp/skill') // => 'directory'
 */
export async function entryKind(
  path: string,
): Promise<FilesystemEntryIdentity['kind'] | null> {
  try {
    const stats = await lstat(path)
    if (stats.isSymbolicLink()) return 'symlink'
    if (stats.isDirectory()) return 'directory'
    if (stats.isFile()) return 'file'
    return 'other'
  } catch (error) {
    if (isMissingPathError(error)) return null
    throw error
  }
}

/**
 * Copy the identity fields the app requires before a destructive delete.
 * Exists so cleanup can prove it is deleting the same entry the test created,
 * not a concurrent replacement.
 * @param path - Absolute path whose `lstat` identity is captured.
 * @returns Serializable filesystem identity.
 * @throws When the path cannot be `lstat`ed.
 * @example await filesystemIdentityForPath('/tmp/home/.agents/skills/azure-ai')
 */
export async function filesystemIdentityForPath(
  path: string,
): Promise<FilesystemEntryIdentity> {
  const stats = await lstat(path)
  return {
    kind: stats.isSymbolicLink()
      ? 'symlink'
      : stats.isDirectory()
        ? 'directory'
        : stats.isFile()
          ? 'file'
          : 'other',
    dev: stats.dev,
    ino: stats.ino,
    size: stats.size,
    ctimeMs: stats.ctimeMs,
    mtimeMs: stats.mtimeMs,
  }
}

/**
 * Compare two filesystem identities field-by-field.
 * Exists because object identity is lost across the test/app boundary and a
 * same-path replacement must never be treated as the test-owned entry.
 * @param left - Earlier identity snapshot.
 * @param right - Current identity snapshot.
 * @returns True only when every stable inode metadata field matches.
 * @example filesystemIdentitiesEqual(before, after)
 */
export function filesystemIdentitiesEqual(
  left: FilesystemEntryIdentity,
  right: FilesystemEntryIdentity,
): boolean {
  return (
    left.kind === right.kind &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.ctimeMs === right.ctimeMs &&
    left.mtimeMs === right.mtimeMs
  )
}

/**
 * Snapshot the visible top-level entries of a protected skill directory.
 * Exists to make accidental writes to live Claude/Cursor working sets observable
 * without copying user content or relying on production scanner code.
 * @param dir - Absolute skills directory to inspect.
 * @returns Sorted entry names, kinds, and symlink targets, or a missing marker.
 * @example await snapshotProtectedDirectory('/home/user/.claude/skills')
 */
export async function snapshotProtectedDirectory(
  dir: string,
): Promise<ProtectedDirectorySnapshot> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    const rows = await Promise.all(
      entries.map(async (entry) => {
        const path = join(dir, entry.name)
        let kind: FilesystemEntryIdentity['kind'] = 'other'
        if (entry.isSymbolicLink()) kind = 'symlink'
        else if (entry.isDirectory()) kind = 'directory'
        else if (entry.isFile()) kind = 'file'
        return {
          name: entry.name,
          kind,
          target: kind === 'symlink' ? await readlink(path) : null,
        }
      }),
    )
    rows.sort((a, b) => a.name.localeCompare(b.name))
    return { status: 'present', entries: rows }
  } catch (error) {
    if (isMissingPathError(error)) return { status: 'missing', entries: [] }
    throw error
  }
}

/**
 * Count source rows using the displayed-source contract, independently of the scanner.
 * Exists as the oracle for the real-filesystem lane: non-hidden directories and
 * symlinks count when their `SKILL.md` probe is valid or unreadable, while a
 * proven absence does not count.
 * @param sourceDir - Canonical `~/.agents/skills` directory.
 * @returns Number of rows the source card should report.
 * @example await countSourceSkillDirs('/home/user/.agents/skills')
 */
export async function countSourceSkillDirs(sourceDir: string): Promise<number> {
  const entries = await readdir(sourceDir, { withFileTypes: true })
  const probes = await Promise.all(
    entries
      .filter(
        (entry) =>
          !entry.name.startsWith('.') &&
          (entry.isDirectory() || entry.isSymbolicLink()),
      )
      .map(async (entry) => {
        try {
          const skillMd = await stat(join(sourceDir, entry.name, 'SKILL.md'))
          // A regular SKILL.md is a valid row.
          if (skillMd.isFile()) return true
          return false
        } catch (error) {
          // Missing means proven absent; every other error means the scanner
          // preserves an unreadable row, so the display count includes it.
          return !isMissingPathError(error)
        }
      }),
  )
  return probes.filter(Boolean).length
}

/**
 * Count valid symlinked skills in one agent directory.
 * Exists as the sidebar-count oracle; local directories are intentionally not
 * part of this linked count.
 * @param agentDir - Absolute agent skills directory.
 * @returns Number of symlinks whose target can currently be stat'ed.
 * @example await countValidSymlinks('/home/user/.config/goose/skills')
 */
export async function countValidSymlinks(agentDir: string): Promise<number> {
  const entries = await readdir(agentDir, { withFileTypes: true })
  const checks = await Promise.all(
    entries
      .filter((entry) => entry.isSymbolicLink())
      .map(async (entry) => {
        try {
          await access(join(agentDir, entry.name), fsConstants.F_OK)
          return true
        } catch {
          return false
        }
      }),
  )
  return checks.filter(Boolean).length
}

/**
 * Read and parse a skills lock file when present.
 * Exists so tests can compare semantic state rather than byte formatting.
 * @param lockPath - Absolute `.skill-lock.json` path.
 * @returns Parsed JSON, or `null` when the file does not exist.
 * @throws When the file exists but cannot be read or parsed.
 * @example await readSkillLock('/home/user/.agents/.skill-lock.json')
 */
export async function readSkillLock(lockPath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(lockPath, 'utf8'))
  } catch (error) {
    if (isMissingPathError(error)) return null
    throw error
  }
}

/**
 * Check whether a parsed lock contains a skill key.
 * @param lock - Parsed lock JSON or `null` for a missing file.
 * @param skillName - Raw lock key to find.
 * @returns True when `skills[skillName]` is present.
 * @example lockHasSkill(lock, 'azure-ai')
 */
export function lockHasSkill(lock: unknown, skillName: string): boolean {
  if (!lock || typeof lock !== 'object') return false
  const skills = (lock as { skills?: unknown }).skills
  return Boolean(
    skills &&
    typeof skills === 'object' &&
    Object.prototype.hasOwnProperty.call(skills, skillName),
  )
}

/**
 * Serialize JSON with recursively sorted object keys.
 * Exists because atomic lock rewrites may reorder keys without changing content.
 * @param value - Parsed JSON-compatible value.
 * @returns Deterministic serialization suitable for equality assertions.
 * @example stableSerialize({ b: 1, a: { d: 2, c: 3 } })
 */
export function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/**
 * List app-trash entries belonging to one skill.
 * @param trashDir - Absolute `.agents/.trash` path.
 * @param skillName - Skill name embedded in tombstone directory names.
 * @returns Matching entry names sorted for deterministic assertions.
 * @example await trashEntriesForSkill('/home/user/.agents/.trash', 'azure-ai')
 */
export async function trashEntriesForSkill(
  trashDir: string,
  skillName: string,
): Promise<string[]> {
  try {
    return (await readdir(trashDir))
      .filter((entry) => entry.includes(`-${skillName}-`))
      .sort()
  } catch (error) {
    if (isMissingPathError(error)) return []
    throw error
  }
}

/**
 * Detect the two filesystem errors that prove a path cannot exist.
 * @param error - Unknown exception from a filesystem API.
 * @returns True for ENOENT or ENOTDIR only; permission and I/O errors remain failures.
 * @example isMissingPathError(error)
 */
function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    ((error as { code?: string }).code === 'ENOENT' ||
      (error as { code?: string }).code === 'ENOTDIR')
  )
}
