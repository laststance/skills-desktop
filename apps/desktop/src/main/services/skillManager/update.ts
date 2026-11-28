import * as fs from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { resolveAgentSkillsPath, SOURCE_DIR } from '@/main/constants'
import { isMissingPathError } from '@/main/utils/errorCode'
import { extractErrorMessage } from '@/main/utils/errors'
import { AGENT_DEFINITIONS } from '@/shared/constants'
import type {
  InstallProgress,
  SkillUpdateItemResult,
  SkillUpdateOutcome,
} from '@/shared/types'

import { sanitizeName } from './copyLayout'
import { discoverSkills, type DiscoveredSkill } from './discover'
import {
  installOneSkill,
  throwIfAborted,
  writeEntriesToTempDir,
  InstallAbortError,
} from './install'
import {
  computeSkillFolderHash,
  readSkillLockForUpdate,
  type SkillLockEntry,
  type SkillLockFile,
} from './lockFile'
import { parseSource, type GitHubSource } from './sourceParse'
import {
  fetchRepoTarball,
  fetchRepoTree,
  getSkillFolderHashFromTree,
  resolveDefaultBranch,
  TarballError,
  type GitHubRepoTree,
  type TarEntry,
} from './tarball'

/**
 * Update orchestration for the skill manager. Exists because update is not a
 * blind reinstall: it must classify unsupported or upstream-missing lock
 * entries, detect moved skill paths, and compare legacy git-tree SHAs or new
 * content hashes before touching disk. Called by the IPC layer inside the
 * app's `runLockWrite` mutex.
 *
 * Internal to `skillManager/` — the public seam is `index.ts`.
 */

/** Inputs for one update run. */
export interface SkillManagerUpdateOptions {
  /** Optional lock-key filters; omitted means every updateable lock entry. */
  skillNames?: readonly string[]
  onProgress?: (progress: InstallProgress) => void
  signal?: AbortSignal
}

interface LockedItem {
  name: string
  entry: SkillLockEntry
}

interface UpdateCandidate extends LockedItem {
  source: GitHubSource
  /** Effective pinned ref from either the lock field or a source fragment. */
  ref?: string
}

interface Resolution {
  paths: Map<string, string>
  ambiguous: Set<string>
  missing: Set<string>
}

interface GroupSnapshot {
  ref: string
  entries: TarEntry[]
  repoTree: GitHubRepoTree | null
  treeError: unknown
}

interface ItemContext {
  tempDir: string
  repoTree: GitHubRepoTree | null
  treeError: unknown
  discovered: readonly DiscoveredSkill[]
  resolution: Resolution
}

function normalizeSkillPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/')
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof InstallAbortError ||
    (error instanceof Error && error.name === 'AbortError')
  )
}

function failureResult(
  name: string,
  userMessage: string,
): SkillUpdateItemResult {
  return { name, status: 'failed', userMessage }
}

function skippedResult(
  name: string,
  userMessage: string,
): SkillUpdateItemResult {
  return { name, status: 'skipped', userMessage }
}

function isLockEntryObject(entry: unknown): entry is SkillLockEntry {
  return typeof entry === 'object' && entry !== null && !Array.isArray(entry)
}

/** Human-safe reason an entry cannot participate in automatic update. */
function unsupportedReason(entry: SkillLockEntry, name: string): string | null {
  if (!isLockEntryObject(entry)) {
    return `"${name}" has a malformed lock entry and cannot be checked for updates.`
  }
  if (entry.sourceType === 'local') {
    return `"${name}" was installed from a local path and cannot be updated automatically.`
  }
  if (entry.sourceType !== 'github') {
    return `"${name}" uses unsupported source type "${entry.sourceType}" and cannot be updated automatically.`
  }
  if (typeof entry.source !== 'string' || !entry.source) {
    return `"${name}" has no recorded source, so it cannot be checked for updates.`
  }
  if (typeof entry.skillPath !== 'string' || !entry.skillPath) {
    return `"${name}" has no recorded skill path, so its upstream location cannot be checked.`
  }
  if (typeof entry.skillFolderHash !== 'string' || !entry.skillFolderHash) {
    return `"${name}" has no recorded version hash, so it cannot be checked for updates.`
  }
  if (entry.ref !== undefined && typeof entry.ref !== 'string') {
    return `"${name}" has a malformed pinned ref, so it cannot be checked safely.`
  }
  return null
}

/**
 * Split selected lock entries into immediately-skipped results and GitHub
 * candidates that can be checked upstream.
 */
function classifyLockedItems(
  lock: SkillLockFile,
  skillNames: readonly string[] | undefined,
): {
  selectedNames: string[]
  initialResults: SkillUpdateItemResult[]
  candidates: UpdateCandidate[]
} {
  const requested = skillNames?.map((name) => name.toLowerCase())
  const lockedItems = Object.entries(lock.skills)
    .filter(([name]) => !requested || requested.includes(name.toLowerCase()))
    .map(([name, entry]) => ({ name, entry }))
  const initialResults: SkillUpdateItemResult[] = []
  const candidates: UpdateCandidate[] = []

  for (const item of lockedItems) {
    const reason = unsupportedReason(item.entry, item.name)
    if (reason) {
      initialResults.push(skippedResult(item.name, reason))
      continue
    }
    const parsed = parseSource(item.entry.source)
    if (!parsed.ok || parsed.source.type !== 'github') {
      initialResults.push(
        skippedResult(
          item.name,
          `"${item.name}" has an unsupported source and cannot be updated automatically.`,
        ),
      )
      continue
    }
    candidates.push({
      ...item,
      source: parsed.source,
      ...((item.entry.ref ?? parsed.source.ref)
        ? { ref: item.entry.ref ?? parsed.source.ref }
        : {}),
    })
  }

  return {
    selectedNames: lockedItems.map((item) => item.name),
    initialResults,
    candidates,
  }
}

/**
 * Lock keys that share one sanitized on-disk directory. Updating either would
 * wipe the other's canonical copy, so every colliding key is skipped until the
 * user resolves the lock manually.
 */
function sanitizedNameCollisions(lock: SkillLockFile): Map<string, string[]> {
  const byDirectory = new Map<string, string[]>()
  for (const name of Object.keys(lock.skills)) {
    const directory = sanitizeName(name)
    byDirectory.set(directory, [...(byDirectory.get(directory) ?? []), name])
  }
  const collisions = new Map<string, string[]>()
  for (const names of byDirectory.values()) {
    if (names.length < 2) continue
    for (const name of names) collisions.set(name, names)
  }
  return collisions
}

/** Group candidates so each upstream source/ref is downloaded once. */
function groupCandidates(
  candidates: readonly UpdateCandidate[],
): UpdateCandidate[][] {
  const groups = new Map<string, UpdateCandidate[]>()
  for (const candidate of candidates) {
    const key = `${candidate.source.ownerRepo}\0${candidate.ref ?? ''}`
    groups.set(key, [...(groups.get(key) ?? []), candidate])
  }
  return [...groups.values()]
}

/**
 * Resolve freshly-discovered upstream locations for every locked skill in one
 * source/ref group. Exact locked `skillPath` wins when duplicate frontmatter
 * names exist; a single same-name candidate can follow a moved path; zero
 * candidates means upstream-missing; multiple non-exact candidates are unsafe.
 */
function resolveSkillLocations(
  locked: readonly LockedItem[],
  discovered: readonly DiscoveredSkill[],
): Resolution {
  const byName = new Map<string, string[]>()
  for (const skill of discovered) {
    const skillPath = normalizeSkillPath(skill.skillFilePath)
    const paths = byName.get(skill.name) ?? []
    if (!paths.includes(skillPath)) paths.push(skillPath)
    byName.set(skill.name, paths)
  }

  const resolution: Resolution = {
    paths: new Map(),
    ambiguous: new Set(),
    missing: new Set(),
  }
  for (const item of locked) {
    // Only the exact raw frontmatter name may become a move target. A merely
    // normalized-equivalent name can be a different skill in the same repo.
    const candidates = byName.get(item.name) ?? []
    const lockedPath = item.entry.skillPath
      ? normalizeSkillPath(item.entry.skillPath)
      : undefined
    if (lockedPath && candidates.includes(lockedPath)) {
      resolution.paths.set(item.name, lockedPath)
    } else if (candidates.length === 1 && candidates[0]) {
      resolution.paths.set(item.name, candidates[0])
    } else if (candidates.length > 1) {
      resolution.ambiguous.add(item.name)
    } else {
      resolution.missing.add(item.name)
    }
  }
  return resolution
}

/** All lock entries belonging to the same GitHub repo/ref as this group. */
function lockedItemsForGroup(
  lock: SkillLockFile,
  first: UpdateCandidate,
): LockedItem[] {
  return Object.entries(lock.skills)
    .filter(([, entry]) => {
      if (!isLockEntryObject(entry)) return false
      if (typeof entry.source !== 'string') return false
      if (entry.ref !== undefined && typeof entry.ref !== 'string') return false
      if (
        entry.skillPath !== undefined &&
        typeof entry.skillPath !== 'string'
      ) {
        return false
      }
      const parsed = parseSource(entry.source)
      if (!parsed.ok || parsed.source.type !== 'github') return false
      const effectiveRef = entry.ref ?? parsed.source.ref
      return (
        (effectiveRef ?? '') === (first.ref ?? '') &&
        parsed.source.ownerRepo === first.source.ownerRepo
      )
    })
    .map(([name, entry]) => ({ name, entry }))
}

interface ExistingAgentTargetScan {
  /** Slots safe to replace because only their symlink object is removed. */
  targets: { installDir: string; skillsDir: string }[]
  /** Real files/directories whose replacement would destroy user content. */
  unsafeSlots: string[]
}

/**
 * Find non-universal agent install slots where this skill already exists.
 * Update deliberately does not install into newly detected agents: it refreshes
 * the footprint the user already has and no more. Real files/directories are
 * reported separately instead of passed to the installer: replacing a symlink
 * object is harmless, while replacing an agent-local copy can destroy edits a
 * user made inside that directory.
 */
async function scanExistingAgentTargets(
  skillName: string,
): Promise<ExistingAgentTargetScan> {
  const sanitized = sanitizeName(skillName)
  const targets: { installDir: string; skillsDir: string }[] = []
  const unsafeSlots: string[] = []
  const seenDirs = new Set<string>()
  for (const definition of AGENT_DEFINITIONS) {
    if (definition.installDir === '.agents') continue
    const skillsDir = resolveAgentSkillsPath(definition.installDir)
    if (seenDirs.has(skillsDir)) continue
    seenDirs.add(skillsDir)
    const slotPath = join(skillsDir, sanitized)
    try {
      // lstat sees symlinks, broken symlinks, real directories, and files.
      const stats = await fs.lstat(slotPath)
      if (stats.isSymbolicLink()) {
        targets.push({ installDir: definition.installDir, skillsDir })
      } else {
        unsafeSlots.push(slotPath)
      }
    } catch (error) {
      if (isMissingPathError(error)) {
        // Absent slot: update must not expand the user's footprint.
      } else {
        // An unreadable occupant cannot be proven replaceable without data loss.
        unsafeSlots.push(slotPath)
      }
    }
  }
  return { targets, unsafeSlots }
}

function firstFailureMessage(
  results: readonly SkillUpdateItemResult[],
): string | undefined {
  return results.find((result) => result.status === 'failed')?.userMessage
}

function outcomeFromResults(
  results: readonly SkillUpdateItemResult[],
): SkillUpdateOutcome {
  const userMessage = firstFailureMessage(results)
  return {
    success: !results.some((result) => result.status === 'failed'),
    results: [...results],
    ...(userMessage ? { userMessage } : {}),
  }
}

function tarPathToFsPath(root: string, skillPath: string): string {
  return join(root, dirname(normalizeSkillPath(skillPath)))
}

/** Fetch tarball bytes plus optional git-tree metadata for one group. */
async function fetchGroupSnapshot(
  first: UpdateCandidate,
  group: readonly UpdateCandidate[],
  signal?: AbortSignal,
): Promise<GroupSnapshot> {
  const ref =
    first.ref ?? (await resolveDefaultBranch(first.source.ownerRepo, signal))
  const entries = await fetchRepoTarball(first.source.ownerRepo, ref, signal)
  const needsTree = group.some((item) =>
    /^[0-9a-f]{40}$/i.test(item.entry.skillFolderHash ?? ''),
  )
  if (!needsTree) return { ref, entries, repoTree: null, treeError: null }

  try {
    const repoTree = await fetchRepoTree(first.source.ownerRepo, ref, signal)
    return { ref, entries, repoTree, treeError: null }
  } catch (error) {
    if (isAbortError(error)) throw error
    return { ref, entries, repoTree: null, treeError: error }
  }
}

/** Compute the upstream hash in the same mode as the stored lock hash. */
async function latestHashForItem(
  item: UpdateCandidate,
  skillPath: string,
  context: ItemContext,
): Promise<{ hash: string } | { failure: SkillUpdateItemResult }> {
  const storedHash = item.entry.skillFolderHash ?? ''
  if (!/^[0-9a-f]{40}$/i.test(storedHash)) {
    const hash = await computeSkillFolderHash(
      tarPathToFsPath(context.tempDir, skillPath),
    )
    return { hash }
  }

  if (!context.repoTree) {
    const detail =
      context.treeError instanceof TarballError
        ? context.treeError.userMessage
        : 'GitHub tree metadata is unavailable.'
    return {
      failure: failureResult(
        item.name,
        `"${item.name}" could not be checked: ${detail}`,
      ),
    }
  }
  const hash = getSkillFolderHashFromTree(context.repoTree, skillPath)
  if (!hash) {
    return {
      failure: failureResult(
        item.name,
        `"${item.name}" has no readable upstream tree hash.`,
      ),
    }
  }
  return { hash }
}

/** Reinstall one changed skill while preserving its existing agent footprint. */
async function reinstallItem(
  item: UpdateCandidate,
  discoveredSkill: DiscoveredSkill,
  onProgress?: (progress: InstallProgress) => void,
): Promise<SkillUpdateItemResult> {
  const existing = await scanExistingAgentTargets(item.name)
  if (existing.unsafeSlots.length > 0) {
    return skippedResult(
      item.name,
      `"${item.name}" has a real file or directory in an agent slot (${existing.unsafeSlots.join(', ')}), so automatic update refused to replace it. Move that copy aside or remove it before updating.`,
    )
  }
  const installResult = await installOneSkill(
    { ...discoveredSkill, name: item.name },
    item.source,
    item.ref,
    existing.targets,
    onProgress,
  )
  if (installResult.success) return { name: item.name, status: 'updated' }
  return failureResult(
    item.name,
    installResult.userMessage ?? `"${item.name}" could not be updated.`,
  )
}

/** Check and update one item after its upstream location has been resolved. */
async function processResolvedItem(
  item: UpdateCandidate,
  skillPath: string,
  context: ItemContext,
  onProgress?: (progress: InstallProgress) => void,
): Promise<SkillUpdateItemResult> {
  const discoveredSkill = context.discovered.find(
    (skill) => normalizeSkillPath(skill.skillFilePath) === skillPath,
  )
  if (!discoveredSkill) {
    return failureResult(
      item.name,
      `"${item.name}" was discovered inconsistently and cannot be updated safely.`,
    )
  }

  const canonicalDir = join(SOURCE_DIR, sanitizeName(item.name))
  try {
    if (!(await fs.stat(canonicalDir)).isDirectory()) {
      return skippedResult(
        item.name,
        `"${item.name}" has a lock entry but no canonical installation, so update left it untouched.`,
      )
    }
  } catch {
    return skippedResult(
      item.name,
      `"${item.name}" has a lock entry but no canonical installation, so update left it untouched.`,
    )
  }

  const latest = await latestHashForItem(item, skillPath, context)
  if ('failure' in latest) return latest.failure

  const pathMoved = normalizeSkillPath(item.entry.skillPath ?? '') !== skillPath
  const hashChanged =
    latest.hash.toLowerCase() !==
    (item.entry.skillFolderHash ?? '').toLowerCase()
  if (!pathMoved && !hashChanged) {
    return { name: item.name, status: 'current' }
  }
  return reinstallItem(item, discoveredSkill, onProgress)
}

/** Classify then process one item inside an already fetched repo snapshot. */
async function processGroupItem(
  item: UpdateCandidate,
  context: ItemContext,
  onProgress?: (progress: InstallProgress) => void,
): Promise<SkillUpdateItemResult> {
  if (context.resolution.ambiguous.has(item.name)) {
    return skippedResult(
      item.name,
      `"${item.name}" exists in multiple upstream locations, so update cannot choose safely.`,
    )
  }
  if (context.resolution.missing.has(item.name)) {
    return {
      name: item.name,
      status: 'missing-upstream',
      userMessage: `"${item.name}" is missing upstream. The installed copy was left untouched.`,
    }
  }
  const skillPath = context.resolution.paths.get(item.name)
  if (!skillPath) {
    return failureResult(
      item.name,
      `"${item.name}" could not be resolved upstream.`,
    )
  }
  return processResolvedItem(item, skillPath, context, onProgress)
}

/** Process every selected item in one fetched source/ref group. */
async function processItemsInContext(
  group: readonly UpdateCandidate[],
  context: ItemContext,
  onProgress?: (progress: InstallProgress) => void,
  signal?: AbortSignal,
  onItemResult?: (result: SkillUpdateItemResult) => void,
): Promise<SkillUpdateItemResult[]> {
  const results: SkillUpdateItemResult[] = []
  for (const item of group) {
    throwIfAborted(signal)
    let result: SkillUpdateItemResult
    try {
      result = await processGroupItem(item, context, onProgress)
    } catch (error) {
      if (isAbortError(error)) throw error
      result = failureResult(
        item.name,
        `"${item.name}" could not be updated: ${extractErrorMessage(error)}`,
      )
    }
    results.push(result)
    onItemResult?.(result)
  }
  return results
}

/** Fetch, discover, and process one source/ref group. */
async function processGroup(
  group: readonly UpdateCandidate[],
  lock: SkillLockFile,
  onProgress?: (progress: InstallProgress) => void,
  signal?: AbortSignal,
  onItemResult?: (result: SkillUpdateItemResult) => void,
): Promise<SkillUpdateItemResult[]> {
  const first = group[0]
  if (!first) return []
  onProgress?.({
    phase: 'checking',
    message: `Checking ${first.source.ownerRepo} for updates...`,
  })

  let tempDir: string | null = null
  try {
    const snapshot = await fetchGroupSnapshot(first, group, signal)
    tempDir = await writeEntriesToTempDir(snapshot.entries)
    const discovered = await discoverSkills(tempDir, undefined, {
      fullDepth: true,
      includeDuplicateNames: true,
    })
    const resolution = resolveSkillLocations(
      lockedItemsForGroup(lock, first),
      discovered,
    )
    return await processItemsInContext(
      group,
      {
        tempDir,
        repoTree: snapshot.repoTree,
        treeError: snapshot.treeError,
        discovered,
        resolution,
      },
      onProgress,
      signal,
      onItemResult,
    )
  } catch (error) {
    if (isAbortError(error)) throw error
    const detail =
      error instanceof TarballError
        ? error.userMessage
        : extractErrorMessage(error)
    return group.map((item) =>
      failureResult(
        item.name,
        `"${item.name}" could not be checked for updates: ${detail}`,
      ),
    )
  } finally {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }
  }
}

/** Fill still-unprocessed selected entries after cancellation or a top-level failure. */
function fillIncompleteResults(
  selectedNames: readonly string[],
  resultsByName: Map<string, SkillUpdateItemResult>,
  error: unknown,
): void {
  const cancelled = isAbortError(error)
  const detail = cancelled ? null : extractErrorMessage(error)
  for (const name of selectedNames) {
    if (resultsByName.has(name)) continue
    resultsByName.set(
      name,
      failureResult(
        name,
        cancelled
          ? 'Update cancelled.'
          : `"${name}" could not be updated: ${detail}`,
      ),
    )
  }
}

/** Build the final outcome in lock-file selection order and emit its terminal progress. */
function finalizeUpdate(
  selectedNames: readonly string[],
  resultsByName: Map<string, SkillUpdateItemResult>,
  onProgress?: (progress: InstallProgress) => void,
  operationFailure?: string,
): SkillUpdateOutcome {
  const orderedNames =
    selectedNames.length > 0 ? selectedNames : [...resultsByName.keys()]
  const results = orderedNames
    .map((name) => resultsByName.get(name))
    .filter((result): result is SkillUpdateItemResult => Boolean(result))
  const outcome = outcomeFromResults(results)
  if (operationFailure) {
    outcome.success = false
    outcome.userMessage = operationFailure
  }
  onProgress?.({
    phase: outcome.success ? 'complete' : 'error',
    message: outcome.success
      ? 'Skill update check complete'
      : 'Skill update failed',
  })
  return outcome
}

/**
 * Update globally-installed GitHub skills in place. Never throws for expected
 * failures: network, source, discovery, and write problems become per-item
 * structured results. Cancellation also returns a failed outcome rather than
 * throwing across the public seam.
 * @param options - Optional names, progress sink, and cancellation signal.
 * @returns Operation outcome with one result per selected lock entry.
 * @example await updateSkills({ skillNames: ['azure-ai'] })
 */
export async function updateSkills(
  options: SkillManagerUpdateOptions = {},
): Promise<SkillUpdateOutcome> {
  const { onProgress, signal } = options
  const resultsByName = new Map<string, SkillUpdateItemResult>()
  let selectedNames: string[] = []
  let operationFailure: string | undefined
  try {
    const lock = await readSkillLockForUpdate()
    const classified = classifyLockedItems(lock, options.skillNames)
    selectedNames = classified.selectedNames
    for (const result of classified.initialResults) {
      resultsByName.set(result.name, result)
    }
    throwIfAborted(signal)

    const collisions = sanitizedNameCollisions(lock)
    const candidates = classified.candidates.filter((candidate) => {
      const collidingNames = collisions.get(candidate.name)
      if (!collidingNames) return true
      resultsByName.set(
        candidate.name,
        skippedResult(
          candidate.name,
          `"${candidate.name}" shares an on-disk directory name with ${collidingNames
            .filter((name) => name !== candidate.name)
            .map((name) => `"${name}"`)
            .join(', ')}, so automatic update cannot choose safely.`,
        ),
      )
      return false
    })

    for (const group of groupCandidates(candidates)) {
      throwIfAborted(signal)
      const groupResults = await processGroup(
        group,
        lock,
        onProgress,
        signal,
        (result) => resultsByName.set(result.name, result),
      )
      for (const result of groupResults) resultsByName.set(result.name, result)
    }
  } catch (error) {
    operationFailure = isAbortError(error)
      ? 'Update cancelled.'
      : `Skill update failed: ${extractErrorMessage(error)}`
    fillIncompleteResults(selectedNames, resultsByName, error)
  }

  return finalizeUpdate(
    selectedNames,
    resultsByName,
    onProgress,
    operationFailure,
  )
}
