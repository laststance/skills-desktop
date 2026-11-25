import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, relative } from 'node:path'

import { errorCode } from '@/main/utils/errorCode'
import { extractErrorMessage } from '@/main/utils/errors'
import { fsyncPath } from '@/main/utils/fsyncPath'

/**
 * Global skill-lock IO for the skill manager — the CLI's version-3 schema at
 * the CLI's location, so users can keep using `npx skills` interchangeably.
 * Writes are atomic (temp file + fsync + rename in the same directory), which
 * is a strict upgrade over the CLI's plain `writeFile`: a kill mid-write can
 * no longer truncate the lock into reading as empty.
 *
 * The read-modify-write in here is NOT safe against concurrent writers on its
 * own — callers serialize through the app's `runLockWrite` mutex.
 *
 * Internal to `skillManager/` — not part of the module's public interface.
 */

/** Schema version the CLI reads. Anything lower is treated as empty. */
const SKILL_LOCK_VERSION = 3

/** Lock entry shape the CLI writes per skill (unknown extra fields pass through). */
export interface SkillLockEntry {
  source: string
  sourceType: string
  sourceUrl?: string
  ref?: string
  skillPath?: string
  skillFolderHash?: string
  installedAt?: string
  updatedAt?: string
  [extra: string]: unknown
}

/** Whole-file shape. Unknown top-level fields (`dismissed`, etc.) pass through. */
export interface SkillLockFile {
  version: number
  skills: Record<string, SkillLockEntry>
  [extra: string]: unknown
}

/**
 * Resolve the global lock path exactly as the CLI does. Read at call time
 * because `XDG_STATE_HOME` is an env input, not a constant.
 * @returns Absolute path of `.skill-lock.json`.
 * @example getSkillLockPath() // => '/Users/me/.agents/.skill-lock.json'
 */
function getSkillLockPath(): string {
  const xdgStateHome = process.env.XDG_STATE_HOME
  if (xdgStateHome) return join(xdgStateHome, 'skills', '.skill-lock.json')
  return join(homedir(), '.agents', '.skill-lock.json')
}

function createEmptyLock(): SkillLockFile {
  // `dismissed` is part of the CLI's empty-lock shape (prompt dismissal
  // state). A fresh lock written by the app must carry it so the file stays
  // byte-compatible with what the CLI itself would initialize.
  return { version: SKILL_LOCK_VERSION, skills: {}, dismissed: {} }
}

/**
 * Read the global lock with the CLI's forgiveness rules: a missing file, an
 * unparseable file, or a pre-v3 schema all read as an empty lock. Newer
 * versions pass through untouched — the CLI does the same, and downgrading
 * them would destroy records a newer tool wrote.
 * @returns The parsed lock, or an empty v3 skeleton.
 */
export async function readSkillLock(): Promise<SkillLockFile> {
  let content: string
  try {
    content = await fs.readFile(getSkillLockPath(), 'utf-8')
  } catch {
    return createEmptyLock()
  }
  try {
    const parsed: unknown = JSON.parse(content)
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('version' in parsed) ||
      typeof parsed.version !== 'number' ||
      !('skills' in parsed) ||
      typeof parsed.skills !== 'object' ||
      parsed.skills === null
    ) {
      return createEmptyLock()
    }
    if (parsed.version < SKILL_LOCK_VERSION) return createEmptyLock()
    return parsed as SkillLockFile
  } catch {
    return createEmptyLock()
  }
}

/**
 * Write the lock atomically: temp file in the same directory, fsync, rename,
 * fsync the directory. The byte format matches the CLI exactly —
 * `JSON.stringify(lock, null, 2)` with no trailing newline — so a lock
 * written by the app is indistinguishable from one the CLI wrote.
 * @param lock - The full lock object, unknown fields included.
 */
async function writeSkillLock(lock: SkillLockFile): Promise<void> {
  const lockPath = getSkillLockPath()
  await fs.mkdir(dirname(lockPath), { recursive: true })
  const tmpPath = `${lockPath}.tmp-${process.pid}-${Date.now()}`
  try {
    await fs.writeFile(tmpPath, JSON.stringify(lock, null, 2), 'utf-8')
    await fsyncPath(tmpPath)
    await fs.rename(tmpPath, lockPath)
    await fsyncPath(dirname(lockPath))
  } catch (error) {
    // A stranded temp file is cosmetic, but the rename is the failure that
    // matters — report with the real reason before cleaning up.
    await fs.rm(tmpPath, { force: true }).catch(() => {})
    console.error('skillManager: atomic lock write failed', {
      code: errorCode(error),
      message: extractErrorMessage(error),
    })
    throw error
  }
}

/**
 * Entry fields `addSkillToLock` accepts. Declared explicitly rather than as
 * an `Omit` of {@link SkillLockEntry} because `Omit` over an index-signature
 * type erases the required properties from the spread result.
 */
export interface SkillLockEntryInput {
  source: string
  sourceType: string
  sourceUrl?: string
  ref?: string
  skillPath?: string
  skillFolderHash?: string
  pluginName?: string
  [extra: string]: unknown
}

/**
 * Insert or replace one skill's lock entry, preserving the original
 * `installedAt` across reinstalls and bumping `updatedAt` — exactly the CLI's
 * `addSkillToLock`. Must run inside the caller's lock-write mutex.
 * @param rawName - Raw frontmatter name; the lock is keyed by it verbatim.
 * @param entry - Entry fields, minus the timestamps this function owns.
 */
export async function addSkillToLock(
  rawName: string,
  entry: SkillLockEntryInput,
): Promise<void> {
  const lock = await readSkillLock()
  const now = new Date().toISOString()
  const existingEntry = lock.skills[rawName]
  lock.skills[rawName] = {
    ...entry,
    installedAt: existingEntry?.installedAt ?? now,
    updatedAt: now,
  }
  await writeSkillLock(lock)
}

/**
 * Delete one skill's lock entry. Must run inside the caller's mutex.
 * @param rawName - Raw lock key.
 * @returns true when the entry existed and was removed.
 */
export async function removeSkillFromLock(rawName: string): Promise<boolean> {
  const lock = await readSkillLock()
  if (!(rawName in lock.skills)) return false
  delete lock.skills[rawName]
  await writeSkillLock(lock)
  return true
}

/**
 * Byte-exact port of the CLI's `computeSkillFolderHash`: sha256 over every
 * file in the tree except `.git`/`node_modules` content, files sorted by
 * POSIX relative path with `localeCompare`, feeding `hash.update(path)` then
 * `hash.update(bytes)` with no separator. Symlinks are not files for this
 * purpose — Dirent.isFile() is false for them, so they never enter the hash.
 * @param skillDir - Directory to hash, typically the pre-copy source tree.
 * @returns Lowercase hex digest.
 * @example await computeSkillFolderHash('/tmp/extract/skills/azure-ai')
 */
export async function computeSkillFolderHash(
  skillDir: string,
): Promise<string> {
  const files: { relativePath: string; content: Buffer }[] = []

  const collect = async (
    baseDir: string,
    currentDir: string,
  ): Promise<void> => {
    const entries = await fs.readdir(currentDir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue
        await collect(baseDir, fullPath)
      } else if (entry.isFile()) {
        const content = await fs.readFile(fullPath)
        files.push({
          relativePath: relative(baseDir, fullPath).split('\\').join('/'),
          content,
        })
      }
    }
  }
  await collect(skillDir, skillDir)

  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(file.relativePath)
    hash.update(file.content)
  }
  return hash.digest('hex')
}
