import { constants, type Dirent } from 'node:fs'
import { lstat, open, opendir } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, sep } from 'node:path'

import {
  classifyFile,
  getNormalizedExtension,
  IMAGE_MIME_TYPES,
  MAX_IMAGE_FILE_BYTES,
  MAX_TEXT_FILE_BYTES,
  MAX_TREE_DEPTH,
  shouldExcludeDir,
} from '@/shared/fileTypes'
import {
  SKILL_FILES_LIMITS,
  unavailableSkillFiles,
  type SkillFileRead,
  type SkillFilesCode,
  type SkillFilesListing,
  type SkillFilesRequest,
} from '@/shared/skillFiles'
import {
  toAbsolutePath,
  toDataUrl,
  toFileExtension,
  toFileName,
  toFileSizeBytes,
  toLineCount,
  toMimeType,
  toPosixRelativePath,
  type AbsolutePath,
} from '@/shared/types'

/** Maps OS failures to an allowlist without exposing paths or exception text.
 * @example skillFilesErrorCode({ code: 'ENOENT' }) // 'missing'
 */
export function skillFilesErrorCode(error: unknown): SkillFilesCode {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? error.code
      : null
  if (code === 'ENOENT' || code === 'ENOTDIR') return 'missing'
  if (code === 'EACCES' || code === 'EPERM' || code === 'ELOOP') return 'denied'
  return 'unavailable'
}

interface DiscoveryState {
  root: AbsolutePath
  result: SkillFilesListing
  pending: Array<{ path: string; depth: number }>
  bytes: number
  stopped: () => boolean
}

/** Records only observed omissions within the shared response budget.
 * @example recordDiscoveryIssue(state, directory.path, 'denied')
 */
function recordDiscoveryIssue(
  state: DiscoveryState,
  path: string,
  code: SkillFilesCode | 'depth',
): void {
  state.result.status = 'partial'
  if (state.result.issues.length >= SKILL_FILES_LIMITS.issues) return
  const issue = {
    relativePath: relative(state.root, path).split(sep).join('/'),
    code,
  }
  const bytes = Buffer.byteLength(JSON.stringify(issue)) + 1
  if (state.bytes + bytes > SKILL_FILES_LIMITS.bytes) return
  state.bytes += bytes
  state.result.issues.push(issue)
}

/** Stops directory admission at a hard budget without claiming a total file count.
 * @example stopDiscoveryAtLimit(state, directory.path)
 */
function stopDiscoveryAtLimit(state: DiscoveryState, path: string): void {
  state.result.code = 'limit'
  recordDiscoveryIssue(state, path, 'limit')
  state.pending.length = 0
}

/** Revalidates one file and accounts for its serialized payload before publishing it.
 * @example await collectPreviewFile(state, path, 'text')
 */
async function collectPreviewFile(
  state: DiscoveryState,
  path: string,
  kind: 'text' | 'image',
): Promise<void> {
  const info = await lstat(path)
  if (state.stopped() || !info.isFile() || info.isSymbolicLink()) return
  const limit = kind === 'image' ? MAX_IMAGE_FILE_BYTES : MAX_TEXT_FILE_BYTES
  const name = basename(path)
  const file = {
    name: toFileName(name),
    path: toAbsolutePath(path),
    relativePath: toPosixRelativePath(
      relative(state.root, path).split(sep).join('/'),
    ),
    extension: toFileExtension(getNormalizedExtension(name)),
    size: toFileSizeBytes(info.size),
    previewable: info.size > limit ? ('binary' as const) : kind,
  }
  const bytes = Buffer.byteLength(JSON.stringify(file)) + 1
  if (
    state.result.files.length >= SKILL_FILES_LIMITS.files ||
    state.bytes + bytes > SKILL_FILES_LIMITS.bytes
  ) {
    stopDiscoveryAtLimit(state, path.slice(0, path.lastIndexOf(sep)))
    return
  }
  state.bytes += bytes
  state.result.files.push(file)
}

/** Schedules real directories and previewable files while excluding nested symlinks.
 * @example await visitDiscoveryEntry(state, directory, entry)
 */
async function visitDiscoveryEntry(
  state: DiscoveryState,
  directory: { path: string; depth: number },
  entry: Dirent,
): Promise<void> {
  const path = join(directory.path, entry.name)
  if (entry.isSymbolicLink()) return
  if (entry.isDirectory()) {
    if (shouldExcludeDir(entry.name)) return
    if (directory.depth >= MAX_TREE_DEPTH)
      recordDiscoveryIssue(state, path, 'depth')
    else state.pending.push({ path, depth: directory.depth + 1 })
    return
  }
  const kind = classifyFile(entry.name)
  if (!entry.isFile() || kind === 'binary') return
  try {
    await collectPreviewFile(state, path, kind)
  } catch (error) {
    recordDiscoveryIssue(state, directory.path, skillFilesErrorCode(error))
  }
}

/** Holds one directory handle until its OS operation settles, including cancellation and timeout.
 * @example await visitDiscoveryDirectory(state, directory)
 */
async function visitDiscoveryDirectory(
  state: DiscoveryState,
  directory: { path: string; depth: number },
): Promise<void> {
  let handle: Awaited<ReturnType<typeof opendir>> | undefined
  try {
    const info = await lstat(directory.path)
    if (!info.isDirectory() || info.isSymbolicLink()) {
      recordDiscoveryIssue(state, directory.path, 'denied')
      return
    }
    handle = await opendir(directory.path)
    while (!state.stopped()) {
      // Stop before observing another dirent; the count includes excluded and unsupported entries.
      if (state.result.observedEntries >= SKILL_FILES_LIMITS.entries) {
        stopDiscoveryAtLimit(state, directory.path)
        break
      }
      const entry = await handle.read()
      if (!entry) break
      state.result.observedEntries += 1
      await visitDiscoveryEntry(state, directory, entry)
      if (state.result.code === 'limit') break
    }
  } catch (error) {
    const code = skillFilesErrorCode(error)
    if (directory.path === state.root && state.result.files.length === 0) {
      state.result = unavailableSkillFiles(code)
      state.pending.length = 0
    } else recordDiscoveryIssue(state, directory.path, code)
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

/** Discovers a bounded readable subset for the scheduler with at most two outstanding listing IO calls.
 * Each active root performs sequential IO; cancellation is checked between awaits and root identity before publication.
 * @example await discoverSkillFiles(root, () => false)
 */
export async function discoverSkillFiles(
  root: AbsolutePath,
  stopped: () => boolean,
): Promise<SkillFilesListing> {
  const state: DiscoveryState = {
    root,
    stopped,
    bytes: 512,
    pending: [{ path: root, depth: 0 }],
    result: { status: 'complete', files: [], issues: [], observedEntries: 0 },
  }
  try {
    const identity = await lstat(root)
    if (!identity.isDirectory()) return unavailableSkillFiles('missing')
    while (state.pending.length > 0 && !stopped())
      await visitDiscoveryDirectory(state, state.pending.shift()!)
    if (stopped()) return unavailableSkillFiles('cancelled')
    const current = await lstat(root)
    if (current.dev !== identity.dev || current.ino !== identity.ino)
      return unavailableSkillFiles('missing')
    state.result.files.sort((a, b) => {
      if (a.relativePath === 'SKILL.md') return -1
      if (b.relativePath === 'SKILL.md') return 1
      return a.relativePath.localeCompare(b.relativePath)
    })
    return state.result
  } catch (error) {
    return unavailableSkillFiles(skillFilesErrorCode(error))
  }
}

interface ListingJob {
  owner: string
  request: SkillFilesRequest
  stopped: boolean
  resolve: (result: SkillFilesListing) => void
  timer?: ReturnType<typeof setTimeout>
}

/** Owns the process-wide listing budget across windows; cancellation is scoped to the sender/frame.
 * @example const scheduler = new SkillFilesScheduler()
 */
export class SkillFilesScheduler {
  constructor(private readonly discover = discoverSkillFiles) {}
  private active = new Set<ListingJob>()
  private queued: ListingJob[] = []

  /** Enqueues user-initiated discovery; saturation returns a recoverable result without IO.
   * @example scheduler.list('window:frame', request)
   */
  async list(
    owner: string,
    request: SkillFilesRequest,
  ): Promise<SkillFilesListing> {
    if (this.queued.length >= SKILL_FILES_LIMITS.queuedRoots)
      return Promise.resolve(unavailableSkillFiles('busy'))
    if (
      [...this.active, ...this.queued].some(
        (job) =>
          job.owner === owner && job.request.requestId === request.requestId,
      )
    )
      return Promise.resolve(unavailableSkillFiles('busy'))
    return new Promise((resolve) => {
      const job: ListingJob = { owner, request, stopped: false, resolve }
      job.timer = setTimeout(() => {
        job.stopped = true
        resolve(unavailableSkillFiles('timeout'))
        this.queued = this.queued.filter((candidate) => candidate !== job)
      }, SKILL_FILES_LIMITS.timeoutMs)
      this.queued.push(job)
      this.pump()
    })
  }

  /** Cancels only the caller's matching generation/request, or all jobs when its frame disappears.
   * @example scheduler.cancel('window:frame', request)
   */
  cancel(
    owner: string,
    request?: Pick<SkillFilesRequest, 'requestId' | 'generation'>,
  ): void {
    for (const job of [...this.active, ...this.queued]) {
      if (
        job.owner !== owner ||
        (request &&
          (job.request.requestId !== request.requestId ||
            job.request.generation !== request.generation))
      )
        continue
      job.stopped = true
      clearTimeout(job.timer)
      job.resolve(unavailableSkillFiles('cancelled'))
    }
    this.queued = this.queued.filter((job) => !job.stopped)
  }

  /** Starts queued work only when a previous OS operation has actually settled.
   * @example this.pump()
   */
  private pump(): void {
    while (
      this.active.size < SKILL_FILES_LIMITS.activeRoots &&
      this.queued.length > 0
    ) {
      const job = this.queued.shift()!
      this.active.add(job)
      void this.discover(job.request.root, () => job.stopped)
        .then(job.resolve)
        .finally(() => {
          clearTimeout(job.timer)
          this.active.delete(job)
          this.pump()
        })
    }
  }
}

/** One shared queue covers both detailed and legacy file-list IPC across every window. */
export const skillFilesScheduler = new SkillFilesScheduler()

/** Reads only a mapped descendant, rejecting nested symlinks and enforcing the byte cap while reading.
 * Called after IPC allowlist validation. The root identity is checked again before publishing content.
 * @example await readSkillFileDetailed(root, file.path)
 */
export async function readSkillFileDetailed(
  root: AbsolutePath,
  path: AbsolutePath,
): Promise<SkillFileRead> {
  const rel = relative(root, path)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    return { status: 'error', code: 'denied' }
  // Open the same normalized path whose segments are checked below.
  const target = join(root, rel)
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    const identity = await lstat(root)
    if (!identity.isDirectory()) return { status: 'error', code: 'missing' }
    let current = root as string
    for (const segment of rel.split(sep)) {
      current = join(current, segment)
      if ((await lstat(current)).isSymbolicLink())
        return { status: 'error', code: 'denied' }
    }
    const kind = classifyFile(basename(target))
    if (kind === 'binary') return { status: 'error', code: 'denied' }
    const limit = kind === 'image' ? MAX_IMAGE_FILE_BYTES : MAX_TEXT_FILE_BYTES
    handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW)
    const info = await handle.stat()
    if (!info.isFile()) return { status: 'error', code: 'denied' }
    if (info.size > limit) return { status: 'error', code: 'limit' }
    const bytes = Buffer.alloc(Math.min(info.size, limit) + 1)
    let length = 0
    // The spare byte detects concurrent growth without allocating the full preview limit.
    while (length < bytes.length) {
      const read = await handle.read(bytes, length, bytes.length - length, null)
      if (read.bytesRead === 0) break
      length += read.bytesRead
    }
    if (length > limit || length > info.size)
      return { status: 'error', code: 'limit' }
    const latest = await lstat(root)
    if (latest.dev !== identity.dev || latest.ino !== identity.ino)
      return { status: 'error', code: 'missing' }
    const name = toFileName(basename(target))
    if (kind === 'image') {
      const mime = IMAGE_MIME_TYPES[getNormalizedExtension(name)]
      if (!mime) return { status: 'error', code: 'denied' }
      return {
        status: 'ready',
        kind,
        data: {
          name,
          dataUrl: toDataUrl(
            `data:${mime};base64,${bytes.subarray(0, length).toString('base64')}`,
          ),
          mimeType: toMimeType(mime),
          size: toFileSizeBytes(length),
        },
      }
    }
    const content = bytes.subarray(0, length).toString('utf8')
    return {
      status: 'ready',
      kind: 'text',
      data: {
        name,
        content,
        extension: toFileExtension(getNormalizedExtension(name).slice(1)),
        lineCount: toLineCount(content.split('\n').length),
      },
    }
  } catch (error) {
    return { status: 'error', code: skillFilesErrorCode(error) }
  } finally {
    await handle?.close().catch(() => undefined)
  }
}
