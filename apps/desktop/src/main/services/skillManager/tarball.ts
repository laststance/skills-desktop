import { gunzipSync } from 'node:zlib'

/**
 * GitHub tarball fetching and pure-TypeScript ustar extraction for the skill
 * manager. Exists because the app must not shell out to `git` or `npx`
 * (docs/adr/0003): GitHub serves every ref as a gzip tarball over HTTPS, and
 * a minimal ustar reader covers everything codeload produces — regular files,
 * directories, and pax/ GNU long-name extensions.
 *
 * Internal to `skillManager/` — not part of the module's public interface.
 */

/** Download ceiling for the compressed tarball (100 MB per the port spec). */
const DOWNLOAD_MAX_BYTES = 100 * 1024 * 1024
/**
 * Ceiling for the decompressed tar stream. Exists separately from the
 * download cap because gzip bomb ratios are unbounded without it; 512 MB is
 * several times larger than any real skill repository checkout.
 */
const EXTRACT_MAX_BYTES = 512 * 1024 * 1024
/** Entry-count ceiling so a hostile archive cannot exhaust inotify/fd tables downstream. */
const EXTRACT_MAX_ENTRIES = 8192
/** Per-request network timeout (60 s per the port spec). */
const FETCH_TIMEOUT_MS = 60_000

/** One extracted archive member: a regular file or a directory. */
export interface TarEntry {
  /** POSIX relative path with the archive's single top-level dir stripped. */
  path: string
  type: 'file' | 'directory'
  /** Permission bits from the tar header (`mode & 0o777`). */
  mode: number
  /** File bytes; empty for directories. */
  content: Buffer
}

/**
 * Error carrying a UI-safe message alongside the raw one. Thrown for every
 * fetch/extract failure so the caller never has to guess which string belongs
 * in a dialog.
 */
export class TarballError extends Error {
  readonly userMessage: string

  constructor(message: string, userMessage: string) {
    super(message)
    this.name = 'TarballError'
    this.userMessage = userMessage
  }
}

/**
 * Bearer token for GitHub API/codeload requests, when the user has one in
 * their environment. Mirrors the CLI: GITHUB_TOKEN wins over GH_TOKEN.
 */
function getGitHubToken(): string | null {
  return process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null
}

/** Test seam: override the GitHub API origin without touching production URLs. */
function githubApiBase(): string {
  return process.env.SKILLS_MANAGER_GITHUB_API_URL ?? 'https://api.github.com'
}

/** Test seam: override the codeload origin without touching production URLs. */
function codeloadBase(): string {
  return (
    process.env.SKILLS_MANAGER_CODELOAD_URL ?? 'https://codeload.github.com'
  )
}

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'skills-desktop',
  }
  const token = getGitHubToken()
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

/**
 * Combine the caller's cancel signal with the per-request timeout. Without
 * this, passing a cancel signal would silently disable the 60 s ceiling.
 */
function fetchSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

/** True only for user-cancel aborts, never for the timeout firing. */
function isUserAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

/** Wrap a fetch rejection, preserving user aborts and converting timeouts. */
function toFetchError(error: unknown, ownerRepo: string): TarballError {
  const message = error instanceof Error ? error.message : String(error)
  const timedOut =
    error instanceof Error &&
    (error.name === 'TimeoutError' || message.includes('timed out'))
  return new TarballError(
    `Fetch failed: ${message}`,
    timedOut
      ? `Downloading "${ownerRepo}" timed out. Check your network connection and try again.`
      : `Could not reach GitHub for "${ownerRepo}". Check your network connection.`,
  )
}

/**
 * Read a response body into memory with a hard byte ceiling. `content-length`
 * is checked first when present, but the stream itself is the real enforcement
 * because servers lie.
 */
async function readBodyWithCap(
  response: Response,
  maxBytes: number,
): Promise<Buffer> {
  const contentLength = response.headers.get('content-length')
  if (contentLength) {
    const parsed = Number.parseInt(contentLength, 10)
    if (Number.isFinite(parsed) && parsed > maxBytes) {
      throw new TarballError(
        `Download is larger than ${maxBytes} bytes`,
        'The repository archive is too large to install.',
      )
    }
  }
  if (!response.body) {
    throw new TarballError(
      'Download response has no body',
      'The download failed. Check your network connection and try again.',
    )
  }
  const chunks: Buffer[] = []
  let total = 0
  const reader = response.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      throw new TarballError(
        `Download is larger than ${maxBytes} bytes`,
        'The repository archive is too large to install.',
      )
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks)
}

function fetchErrorUserMessage(status: number, ownerRepo: string): string {
  if (status === 404) {
    return `Repository "${ownerRepo}" was not found on GitHub. Check the owner and repo name, or sign in if it is private.`
  }
  if (status === 403) {
    return `GitHub rate-limited the download of "${ownerRepo}". Try again later, or set GITHUB_TOKEN.`
  }
  return `GitHub returned an error (HTTP ${status}) while fetching "${ownerRepo}".`
}

/**
 * Fetch one GitHub URL with the shared headers, timeout/cancel wiring, and
 * error mapping both request sites need. Returns the raw response only when
 * it is OK; every failure path throws a {@link TarballError} (or rethrows a
 * user abort untouched).
 */
async function fetchGitHub(
  url: string,
  ownerRepo: string,
  signal?: AbortSignal,
): Promise<Response> {
  let response: Response
  try {
    response = await fetch(url, {
      headers: githubHeaders(),
      signal: fetchSignal(signal),
      redirect: 'follow',
    })
  } catch (error) {
    if (isUserAbort(error)) throw error
    throw toFetchError(error, ownerRepo)
  }
  if (!response.ok) {
    throw new TarballError(
      `GitHub fetch failed with HTTP ${response.status}`,
      fetchErrorUserMessage(response.status, ownerRepo),
    )
  }
  return response
}

/** One node in GitHub's recursive git-tree API response. */
export interface GitHubTreeNode {
  path: string
  type: string
  sha?: string
}

/** Recursive git-tree response subset update needs for legacy tree-SHA locks. */
export interface GitHubRepoTree {
  /** SHA of the repository root tree — the folder hash for root-level skills. */
  sha: string
  tree: GitHubTreeNode[]
}

/**
 * Fetch a repo's recursive git tree for one ref. Exists only for compatibility
 * with legacy CLI lock entries whose 40-hex `skillFolderHash` is a git tree
 * SHA; new installs use content hashes and do not need this API.
 * @param ownerRepo - `owner/repo` slug.
 * @param ref - Branch, tag, or sha whose tree should be read.
 * @param signal - Abortion signal wired to the update cancel path.
 * @returns Recursive tree nodes as reported by GitHub.
 * @throws {@link TarballError} when the tree is unavailable or truncated.
 */
export async function fetchRepoTree(
  ownerRepo: string,
  ref: string,
  signal?: AbortSignal,
): Promise<GitHubRepoTree> {
  const response = await fetchGitHub(
    `${githubApiBase()}/repos/${ownerRepo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
    ownerRepo,
    signal,
  )
  const data = (await response.json()) as {
    sha?: string
    tree?: GitHubTreeNode[]
    truncated?: boolean
  }
  if (!Array.isArray(data.tree) || !/^[0-9a-f]{40}$/i.test(data.sha ?? '')) {
    throw new TarballError(
      'GitHub tree response carried no valid root sha or tree array',
      `Could not read the file tree for "${ownerRepo}".`,
    )
  }
  if (data.truncated === true) {
    throw new TarballError(
      'GitHub tree response was truncated',
      `The file tree for "${ownerRepo}" is too large to check safely.`,
    )
  }
  return { sha: data.sha ?? '', tree: data.tree }
}

/**
 * Read the git tree SHA for the directory containing one SKILL.md.
 * @param repoTree - Recursive git tree fetched for the checked ref.
 * @param skillPath - Repo-relative SKILL.md path from the lock.
 * @returns 40-hex tree SHA, or null when the folder is absent/malformed.
 */
export function getSkillFolderHashFromTree(
  repoTree: GitHubRepoTree,
  skillPath: string,
): string | null {
  const normalized = skillPath.replace(/\\/g, '/').replace(/\/+/g, '/')
  const slash = normalized.lastIndexOf('/')
  const folderPath = slash === -1 ? '' : normalized.slice(0, slash)
  if (!folderPath) {
    return /^[0-9a-f]{40}$/i.test(repoTree.sha)
      ? repoTree.sha.toLowerCase()
      : null
  }
  const node = repoTree.tree.find(
    (entry) => entry.type === 'tree' && entry.path === folderPath,
  )
  return node?.sha && /^[0-9a-f]{40}$/i.test(node.sha)
    ? node.sha.toLowerCase()
    : null
}

/**
 * Resolve a repo's default branch through the GitHub API. Called only when
 * the user did not pin a ref, because codeload has no `HEAD` alias.
 * @param ownerRepo - `owner/repo` slug.
 * @param signal - Abortion signal wired to the install cancel path.
 * @returns The default branch name.
 * @throws {@link TarballError} when the repo cannot be read.
 */
export async function resolveDefaultBranch(
  ownerRepo: string,
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetchGitHub(
    `${githubApiBase()}/repos/${ownerRepo}`,
    ownerRepo,
    signal,
  )
  const data = (await response.json()) as { default_branch?: string }
  if (!data.default_branch) {
    throw new TarballError(
      'Repo metadata carried no default_branch',
      `Could not determine the default branch of "${ownerRepo}".`,
    )
  }
  return data.default_branch
}

/** Read one octal-encoded numeric field out of a tar header block. */
function parseOctalField(block: Buffer, start: number, length: number): number {
  // Fields are ASCII octal, space/zero padded; a leading 0x80 byte would be
  // GNU base-256, which codeload never emits and this reader rejects.
  let value = 0
  let sawDigit = false
  for (let i = start; i < start + length; i++) {
    const byte = block[i]
    if (byte === 0 || byte === 0x20) {
      if (sawDigit) break
      continue
    }
    if (byte < 0x30 || byte > 0x37) {
      throw new TarballError(
        'Tar header field is not valid octal',
        'The repository archive is corrupt or uses an unsupported format.',
      )
    }
    value = value * 8 + (byte - 0x30)
    sawDigit = true
  }
  return value
}

/** Read a NUL-terminated UTF-8 string field out of a tar header block. */
function parseStringField(
  block: Buffer,
  start: number,
  length: number,
): string {
  const end = block.indexOf(0, start)
  const stop = end === -1 || end > start + length ? start + length : end
  return block.toString('utf-8', start, stop)
}

/**
 * Parse pax extended-header records (`<len> <key>=<value>\n`) into a map.
 * Malformed records end the parse early rather than throwing: a partially
 * read pax block is safer than rejecting the whole archive.
 */
function parsePaxRecords(content: Buffer): Map<string, string> {
  const records = new Map<string, string>()
  // Record lengths are BYTE counts over the raw content, so all slicing
  // happens on the Buffer; only the key/value text is decoded. Slicing a
  // UTF-8-decoded string by those byte offsets misaligns every record after
  // a multibyte character — a Japanese path would come out with the trailing
  // newline (or the next record) attached and never match a real SKILL.md.
  let offset = 0
  while (offset < content.length) {
    const spaceIndex = content.indexOf(0x20, offset)
    if (spaceIndex === -1) break
    const length = Number.parseInt(
      content.toString('ascii', offset, spaceIndex),
      10,
    )
    if (!Number.isFinite(length) || length <= 0) break
    const recordEnd = offset + length - 1 // the record's trailing newline
    if (recordEnd > content.length) break
    const record = content.subarray(spaceIndex + 1, recordEnd)
    const equalsIndex = record.indexOf(0x3d) // '='
    if (equalsIndex > 0) {
      records.set(
        record.toString('utf-8', 0, equalsIndex),
        record.toString('utf-8', equalsIndex + 1),
      )
    }
    offset += length
  }
  return records
}

/**
 * Normalize one archive path against traversal. Returns null for entries the
 * extractor must skip: absolute paths that stay absolute, drive-letter paths,
 * `..` escapes, and empty leftovers. Leading slashes are stripped first
 * (some producers write `/foo` for `foo`), matching the port spec.
 */
function normalizeEntryPath(rawPath: string): string | null {
  let path = rawPath.replace(/\\/g, '/')
  // Strip leading `./` segments and leading slashes.
  while (path.startsWith('./')) path = path.slice(2)
  while (path.startsWith('/')) path = path.slice(1)
  if (/^[a-zA-Z]:\//.test(path)) return null
  if (path === '' || path === '.') return null
  const segments = path.split('/')
  // Any `..` component can escape the extraction root — reject the entry.
  if (segments.includes('..')) return null
  // Collapse interior `.` segments; they are meaningless but harmless.
  const collapsed = segments.filter((segment) => segment !== '.')
  if (collapsed.length === 0) return null
  return collapsed.join('/')
}

/**
 * Parse a raw tar stream into memory. Supports exactly what codeload (and
 * GNU tar in general) produces: regular files, directories, ustar name
 * prefixes, pax `path` overrides, and GNU long-name blocks. Symlinks,
 * hardlinks, and device nodes are skipped per the port spec.
 * @param tar - Decompressed tar bytes.
 * @returns Entries in archive order, paths not yet stripped of the top-level dir.
 * @throws {@link TarballError} when the stream is truncated or malformed.
 */
export function parseUstar(tar: Buffer): TarEntry[] {
  const entries: TarEntry[] = []
  let offset = 0
  // pax/GNU long-name state applies to the immediately following entry only.
  let pendingPath: string | null = null

  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512)
    // Two zero blocks end the archive; the first one is enough to stop.
    if (header.every((byte) => byte === 0)) break

    const size = parseOctalField(header, 124, 12)
    const mode = parseOctalField(header, 100, 8) & 0o777
    const typeflag = String.fromCharCode(header[156])
    let name = parseStringField(header, 0, 100)
    // ustar prefix joins with the name field when present.
    if (parseStringField(header, 257, 6).startsWith('ustar')) {
      const prefix = parseStringField(header, 345, 155)
      if (prefix) name = `${prefix}/${name}`
    }

    const dataStart = offset + 512
    const dataEnd = dataStart + size
    if (dataEnd > tar.length) {
      throw new TarballError(
        'Tar entry data extends past end of stream',
        'The repository archive is corrupt or truncated.',
      )
    }
    const content = tar.subarray(dataStart, dataEnd)
    // Entries are padded to 512-byte boundaries.
    offset = dataStart + Math.ceil(size / 512) * 512

    if (typeflag === 'x' || typeflag === 'g') {
      const pax = parsePaxRecords(content)
      // 'g' globals are ignored: none of the keys codeload emits affect extraction.
      if (typeflag === 'x' && pax.has('path')) {
        pendingPath = pax.get('path') ?? null
      }
      continue
    }
    if (typeflag === 'L') {
      // GNU long name: the whole content is the next entry's name.
      pendingPath = content.toString('utf-8').replace(/\0.*$/s, '')
      continue
    }
    if (typeflag === 'K') continue // GNU long link target — links are skipped anyway.

    const effectiveName = pendingPath ?? name
    pendingPath = null

    if (typeflag === '0' || typeflag === '\0' || typeflag === '7') {
      const normalized = normalizeEntryPath(effectiveName)
      if (normalized === null) continue
      entries.push({
        path: normalized,
        type: 'file',
        mode,
        content: Buffer.from(content),
      })
    } else if (typeflag === '5') {
      const normalized = normalizeEntryPath(effectiveName)
      if (normalized === null) continue
      entries.push({
        path: normalized,
        type: 'directory',
        mode,
        content: Buffer.alloc(0),
      })
    }
    // Every other typeflag (symlinks, hardlinks, devices, fifos) is skipped.
  }

  if (entries.length > EXTRACT_MAX_ENTRIES) {
    throw new TarballError(
      `Archive contains too many entries (${entries.length})`,
      'The repository archive has too many files to install safely.',
    )
  }
  return entries
}

/**
 * Strip the single shared top-level directory codeload wraps every repo in
 * (`<repo>-<sha>/...`). When entries do not all share one first component the
 * archive is left as-is — hand-built tarballs are allowed to be flat.
 * @param entries - Parsed entries in archive order.
 * @returns The same entries with the shared first path component removed.
 */
export function stripSharedTopLevelDir(entries: TarEntry[]): TarEntry[] {
  const firstComponents = new Set(
    entries.map((entry) => entry.path.split('/')[0]),
  )
  if (firstComponents.size !== 1) return entries
  const [root] = firstComponents
  const stripped = entries
    .map((entry) => {
      const rest = entry.path.slice(root.length).replace(/^\//, '')
      return { ...entry, path: rest }
    })
    // The root directory entry itself strips down to nothing.
    .filter((entry) => entry.path !== '')
  return stripped
}

/**
 * Download and extract a GitHub repo tarball into memory.
 * Called by the install pipeline after source parsing; the entries it returns
 * are written to a temp dir before discovery so hashing and copying read real
 * filesystem bytes.
 * @param ownerRepo - `owner/repo` slug.
 * @param ref - Branch, tag, or sha to download.
 * @param signal - Abortion signal wired to the install cancel path.
 * @returns Extracted entries with the codeload top-level dir stripped.
 * @throws {@link TarballError} on network failure, HTTP errors, gzip bombs,
 *   or malformed archives.
 * @example await fetchRepoTarball('vercel-labs/skills', 'main')
 */
export async function fetchRepoTarball(
  ownerRepo: string,
  ref: string,
  signal?: AbortSignal,
): Promise<TarEntry[]> {
  const url = `${codeloadBase()}/${ownerRepo}/tar.gz/${encodeURIComponent(ref)}`
  const response = await fetchGitHub(url, ownerRepo, signal)
  const gzipped = await readBodyWithCap(response, DOWNLOAD_MAX_BYTES)

  let tar: Buffer
  try {
    tar = gunzipSync(gzipped, { maxOutputLength: EXTRACT_MAX_BYTES })
  } catch (error) {
    const tooLarge =
      error instanceof Error &&
      'code' in error &&
      error.code === 'ERR_BUFFER_TOO_LARGE'
    throw new TarballError(
      `Tarball gunzip failed: ${error instanceof Error ? error.message : String(error)}`,
      tooLarge
        ? 'The repository archive expands past the safe size limit.'
        : 'The repository archive is corrupt or is not a valid gzip stream.',
    )
  }

  return stripSharedTopLevelDir(parseUstar(tar))
}
