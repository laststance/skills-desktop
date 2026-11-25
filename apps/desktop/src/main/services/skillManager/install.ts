import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { SOURCE_DIR, resolveAgentSkillsPath } from '@/main/constants'
import { isMissingPathError } from '@/main/utils/errorCode'
import { extractErrorMessage } from '@/main/utils/errors'
import { AGENT_DEFINITIONS } from '@/shared/constants'
import type { AgentId } from '@/shared/constants'
import type {
  InstallProgress,
  SkillInstallItemResult,
  SkillInstallOutcome,
} from '@/shared/types'

import {
  copySkillTree,
  createRelativeSymlink,
  sanitizeName,
} from './copyLayout'
import { discoverSkills, filterSkills, type DiscoveredSkill } from './discover'
import {
  addSkillToLock,
  computeSkillFolderHash,
  readSkillLock,
} from './lockFile'
import { parseSource, type GitHubSource, type LocalSource } from './sourceParse'
import {
  fetchRepoTarball,
  resolveDefaultBranch,
  TarballError,
  type TarEntry,
} from './tarball'

/**
 * Install orchestration for the skill manager — fetch/resolve, discover,
 * filter, copy canonical, link agents, write the lock, then VERIFY the writes
 * before reporting success. Called by the IPC layer inside the app's
 * `runLockWrite` mutex, which this file deliberately does not re-acquire:
 * the read-modify-write lock updates must share one serialization domain with
 * the prune flow.
 *
 * Internal to `skillManager/` — the public seam is `index.ts`.
 */

/** Inputs for one install run. */
export interface SkillManagerInstallOptions {
  /** Source string exactly as typed/selected: shorthand, URL, or local path. */
  source: string
  /** `--skill` style filters; empty/absent installs every discovered skill. */
  skillNames?: readonly string[]
  /** App agent ids selected as symlink targets in the install modal. */
  agents: readonly AgentId[]
  onProgress?: (progress: InstallProgress) => void
  signal?: AbortSignal
}

/**
 * Build an operation-level failure outcome, logging the raw error in the
 * main process — raw errors deliberately never cross IPC.
 */
function failureOutcome(
  error: string,
  userMessage: string,
): SkillInstallOutcome {
  console.error('skillManager: install failed', { error })
  return { success: false, results: [], userMessage }
}

class InstallAbortError extends Error {
  constructor() {
    super('Installation cancelled')
    this.name = 'InstallAbortError'
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new InstallAbortError()
}

/**
 * Write extracted tar entries into a fresh temp directory, preserving mode
 * bits so executables survive the trip into the canonical copy. Paths were
 * already traversal-hardened at parse time; the containment check here is
 * belt-and-braces for hand-built archives.
 * @param entries - Parsed archive entries with the top-level dir stripped.
 * @returns Absolute path of the temp extraction root the caller must clean up.
 */
async function writeEntriesToTempDir(entries: TarEntry[]): Promise<string> {
  const rootDir = await fs.mkdtemp(join(tmpdir(), 'skill-manager-'))
  for (const entry of entries) {
    const targetPath = join(rootDir, entry.path)
    if (entry.type === 'directory') {
      await fs.mkdir(targetPath, { recursive: true, mode: entry.mode || 0o755 })
      continue
    }
    await fs.mkdir(dirname(targetPath), { recursive: true })
    await fs.writeFile(targetPath, entry.content)
    // chmod follows the write because writeFile applies the process umask.
    if (entry.mode) await fs.chmod(targetPath, entry.mode)
  }
  return rootDir
}

/**
 * Resolve the effective agent target directories for one install. Universal
 * agents (installDir `.agents` — the canonical source itself) need no link;
 * every other selected agent gets a symlink/copy inside its own skills dir.
 */
function nonUniversalTargets(
  agents: readonly AgentId[],
): { installDir: string; skillsDir: string }[] {
  const targets: { installDir: string; skillsDir: string }[] = []
  for (const agentId of agents) {
    const definition = AGENT_DEFINITIONS.find((agent) => agent.id === agentId)
    if (!definition) continue
    if (definition.installDir === '.agents') continue
    targets.push({
      installDir: definition.installDir,
      skillsDir: resolveAgentSkillsPath(definition.installDir),
    })
  }
  return targets
}

interface VerifiedInstall {
  ok: boolean
  missing: string[]
}

/**
 * Post-write verification: the install only reports success when the
 * canonical directory, the lock entry, and every selected agent link provably
 * exist. Exists because the CLI's exit-0-on-partial-failure semantics are
 * exactly the bug this module replaces (docs/adr/0003).
 */
async function verifyInstall(
  rawName: string,
  canonicalDir: string,
  agentTargets: readonly { skillsDir: string }[],
  sanitized: string,
): Promise<VerifiedInstall> {
  const missing: string[] = []
  try {
    if (!(await fs.stat(canonicalDir)).isDirectory()) missing.push(canonicalDir)
  } catch {
    missing.push(canonicalDir)
  }
  const lock = await readSkillLock()
  if (!(rawName in lock.skills)) missing.push('lock-entry')
  for (const target of agentTargets) {
    const linkPath = join(target.skillsDir, sanitized)
    try {
      await fs.lstat(linkPath)
    } catch {
      missing.push(linkPath)
    }
  }
  return { ok: missing.length === 0, missing }
}

/**
 * Install one skill into the canonical dir plus its agent links, then record
 * it in the lock. The hash is computed over the PRE-COPY source tree: the
 * copy drops `metadata.json` and cache dirs while the hash must stay
 * comparable to a future upstream fetch of the same folder.
 */
async function installOneSkill(
  skill: DiscoveredSkill,
  source: GitHubSource | LocalSource,
  refUsed: string | undefined,
  agentTargets: readonly { installDir: string; skillsDir: string }[],
  onProgress?: (progress: InstallProgress) => void,
): Promise<SkillInstallItemResult> {
  const sanitized = sanitizeName(skill.name)
  const canonicalDir = join(SOURCE_DIR, sanitized)
  try {
    onProgress?.({ phase: 'copying', message: `Installing ${skill.name}...` })
    await copySkillTree(skill.path, canonicalDir)

    onProgress?.({
      phase: 'linking',
      message: `Linking ${skill.name} to agents...`,
    })
    const linkFailures: string[] = []
    for (const target of agentTargets) {
      const linkPath = join(target.skillsDir, sanitized)
      const linked = await createRelativeSymlink(canonicalDir, linkPath)
      if (!linked) {
        // Symlink failed — fall back to a full copy, exactly like the CLI.
        try {
          await copySkillTree(skill.path, linkPath)
        } catch {
          linkFailures.push(target.installDir)
        }
      }
    }
    if (linkFailures.length > 0) {
      throw new Error(
        `Could not place the skill in: ${linkFailures.join(', ')}`,
      )
    }

    onProgress?.({
      phase: 'writing-lock',
      message: 'Recording installation...',
    })
    const skillFolderHash = await computeSkillFolderHash(skill.path)
    await addSkillToLock(skill.name, {
      source: source.type === 'github' ? source.ownerRepo : source.localPath,
      sourceType: source.type,
      sourceUrl: source.url,
      // Only a user-pinned ref is recorded; a resolved default branch is not,
      // so a later update re-resolves the moving default like the CLI does.
      ...(refUsed ? { ref: refUsed } : {}),
      ...(source.type === 'github' ? { skillPath: skill.skillFilePath } : {}),
      skillFolderHash,
    })

    const verification = await verifyInstall(
      skill.name,
      canonicalDir,
      agentTargets,
      sanitized,
    )
    if (!verification.ok) {
      throw new Error(
        `Install verification failed; missing: ${verification.missing.join(', ')}`,
      )
    }
    return { name: skill.name, success: true }
  } catch (error) {
    const message = extractErrorMessage(error)
    console.error(`skillManager: install of "${skill.name}" failed`, {
      error: message,
    })
    return {
      name: skill.name,
      success: false,
      userMessage: `"${skill.name}" could not be installed: ${message}`,
    }
  }
}

/**
 * Install skills from a GitHub repo or local directory into the universal
 * source plus the selected agents. Never throws for expected failures —
 * source errors, network errors, zero matches, per-skill copy failures all
 * come back as structured outcome entries. User cancellation throws nothing
 * either; it surfaces as a failed outcome with a cancelled message.
 * @param options - Source, optional skill filter, target agents, progress sink.
 * @returns Operation outcome with per-skill verification results.
 * @example await installSkills({ source: 'vercel-labs/skills', agents: ['claude-code'] })
 */
export async function installSkills(
  options: SkillManagerInstallOptions,
): Promise<SkillInstallOutcome> {
  const { onProgress, signal } = options
  const parsed = parseSource(options.source)
  if (!parsed.ok) {
    return failureOutcome(parsed.error, parsed.userMessage)
  }
  const source = parsed.source

  let tempDir: string | null = null
  try {
    throwIfAborted(signal)

    // --- Resolve the source tree ---
    let treeRoot: string
    let explicitRef: string | undefined
    if (source.type === 'github') {
      onProgress?.({
        phase: 'fetching',
        message: `Fetching ${source.ownerRepo}...`,
      })
      explicitRef = source.ref
      const ref =
        source.ref ?? (await resolveDefaultBranch(source.ownerRepo, signal))
      throwIfAborted(signal)
      const entries = await fetchRepoTarball(source.ownerRepo, ref, signal)
      throwIfAborted(signal)
      onProgress?.({ phase: 'extracting', message: 'Extracting archive...' })
      tempDir = await writeEntriesToTempDir(entries)
      treeRoot = tempDir
    } else {
      // Local sources are copied straight from where they live.
      try {
        if (!(await fs.stat(source.localPath)).isDirectory()) {
          return failureOutcome(
            `Local source is not a directory: ${source.localPath}`,
            'The local path is not a directory.',
          )
        }
      } catch (error) {
        if (!isMissingPathError(error)) throw error
        return failureOutcome(
          `Local source does not exist: ${source.localPath}`,
          `No directory exists at ${source.localPath}.`,
        )
      }
      treeRoot = source.localPath
    }

    throwIfAborted(signal)

    // --- Discover + select ---
    const discovered = await discoverSkills(
      treeRoot,
      source.type === 'github' ? source.subpath : undefined,
    )
    if (discovered.length === 0) {
      return failureOutcome(
        'No valid skills discovered',
        'No valid skills were found in this source. A skill needs a SKILL.md with a name and description.',
      )
    }
    const filters = [
      ...(options.skillNames ?? []),
      ...(source.type === 'github' && source.skillFilter
        ? [source.skillFilter]
        : []),
    ]
    const selected =
      filters.length > 0 ? filterSkills(discovered, filters) : discovered
    if (selected.length === 0) {
      const available = discovered
        .map((skill) => skill.name)
        .sort()
        .join(', ')
      return failureOutcome(
        `No matching skills found for: ${filters.join(', ')}`,
        `No matching skills found. Available in this source: ${available}`,
      )
    }

    // --- Refuse sanitized-name collisions before anything is copied ---
    // Two distinct raw names (`Review` / `review`) can sanitize to the same
    // directory; installing both would let the second wipe-and-recopy erase
    // the first while both lock records still report success.
    const colliding = new Map<string, string[]>()
    for (const skill of selected) {
      const key = sanitizeName(skill.name)
      colliding.set(key, [...(colliding.get(key) ?? []), skill.name])
    }
    const collisions = [...colliding.values()].filter(
      (names) => names.length > 1,
    )
    if (collisions.length > 0) {
      const detail = collisions
        .map((names) => names.map((name) => `"${name}"`).join(' and '))
        .join('; ')
      return failureOutcome(
        `Sanitized directory name collision: ${detail}`,
        `These skills would install into the same directory: ${detail}. Rename one of them and try again.`,
      )
    }

    // --- Install each skill serially: lock read-modify-write must not race itself ---
    const agentTargets = nonUniversalTargets(options.agents)
    const results: SkillInstallItemResult[] = []
    for (const skill of selected) {
      throwIfAborted(signal)
      results.push(
        await installOneSkill(
          skill,
          source,
          explicitRef,
          agentTargets,
          onProgress,
        ),
      )
    }

    const firstFailure = results.find((result) => !result.success)
    onProgress?.({
      phase: firstFailure ? 'error' : 'complete',
      message: firstFailure
        ? 'Installation failed'
        : `${results.length} skill${results.length === 1 ? '' : 's'} installed`,
    })
    return {
      success: !firstFailure,
      results,
      ...(firstFailure?.userMessage
        ? { userMessage: firstFailure.userMessage }
        : {}),
    }
  } catch (error) {
    // A user cancel can surface either as the manager's own InstallAbortError
    // or as a raw AbortError escaping the fetch layer — check the signal.
    if (error instanceof InstallAbortError || signal?.aborted) {
      return failureOutcome('Installation cancelled', 'Installation cancelled.')
    }
    if (error instanceof TarballError) {
      return failureOutcome(error.message, error.userMessage)
    }
    const message = extractErrorMessage(error)
    return failureOutcome(message, `Installation failed: ${message}`)
  } finally {
    if (tempDir)
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}
