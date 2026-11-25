import { mkdtempSync, realpathSync } from 'node:fs'
import {
  chmod,
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest'

/**
 * Real-filesystem, real-HTTP integration tests for the skill manager. The
 * fixture repo travels as a gzip tarball built in-test — the same bytes
 * layout codeload serves — through a loopback HTTP server standing in for
 * api.github.com and codeload.github.com. Nothing is mocked except homedir,
 * so every assertion reads the real install: file bytes, symlink targets,
 * and the lock JSON the `npx skills` CLI must keep understanding.
 *
 * The alpha-skill fixture reproduces — byte for byte — a tree whose
 * `skillFolderHash` the REAL CLI (v1.7.4) computed as
 * `86c7d60fd8a19f54b7ca7f33887bd232eb21d1dc0c919dd5a9aeaf52eb22422b`
 * (captured from a lock the CLI itself wrote). That hard-coded hex is the
 * byte-compat pin: if the port's hashing diverges from the CLI, it fails.
 */

// Stamped synchronously at module load: `main/constants` computes SOURCE_DIR
// from homedir() at import time, so the mock has to exist before that import.
const sharedHome = realpathSync(
  mkdtempSync(join(tmpdir(), 'skill-manager-it-')),
)
const sourceDir = join(sharedHome, '.agents', 'skills')
const lockPath = join(sharedHome, '.agents', '.skill-lock.json')

vi.mock('node:os', async () => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await vi.importActual<typeof import('node:os')>('node:os')
  return { ...actual, homedir: () => sharedHome }
})

// `main/constants` imports from the bare `'os'` specifier — both need mocking.
vi.mock('os', async () => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await vi.importActual<typeof import('os')>('os')
  return { ...actual, homedir: () => sharedHome }
})

const managerModule = import('./index')

// ── Fixture bytes ────────────────────────────────────────────────────────
// Byte-identical to the tree the real CLI hashed for the compat pin above.

const ALPHA_SKILL_MD =
  '---\n' +
  'name: alpha-skill\n' +
  'description: Alpha test skill for hash compat\n' +
  '---\n' +
  '\n' +
  '# Alpha\n' +
  'Body text here.\n'
const ALPHA_RUN_SH = 'echo hello\n'
const ALPHA_DATA_BIN = Buffer.from([
  0x62, 0x69, 0x6e, 0x61, 0x72, 0x79, 0x00, 0x01, 0x02, 0x20, 0x62, 0x79, 0x74,
  0x65, 0x73,
])
const ALPHA_NOISE_JS = 'noise'

/** Hash the real CLI wrote for exactly this tree — the byte-compat pin. */
const ALPHA_CLI_HASH =
  '86c7d60fd8a19f54b7ca7f33887bd232eb21d1dc0c919dd5a9aeaf52eb22422b'

const BETA_SKILL_MD =
  '---\n' +
  'name: Beta Skill\n' +
  'description: Beta test skill with spaces\n' +
  '---\n' +
  '\n' +
  '# Beta\n'

// ── Minimal ustar writer ─────────────────────────────────────────────────
// Correct checksums and padding, because the point is that the reader sees
// exactly what codeload would emit. Names stay under 100 bytes so no prefix
// or pax extension is needed; those paths are covered by unit tests instead.

interface FixtureEntry {
  path: string
  type: 'file' | 'directory'
  mode: number
  content?: Buffer
}

function writeOctalField(
  block: Buffer,
  value: number,
  offset: number,
  length: number,
): void {
  const octal = value.toString(8).padStart(length - 1, '0')
  block.write(octal, offset, length - 1, 'ascii')
  block[offset + length - 1] = 0
}

function tarHeader(entry: FixtureEntry): Buffer {
  const block = Buffer.alloc(512)
  const size = entry.type === 'file' ? (entry.content?.length ?? 0) : 0
  block.write(entry.path, 0, Math.min(entry.path.length, 100), 'ascii')
  writeOctalField(block, entry.mode, 100, 8)
  writeOctalField(block, 0, 108, 8)
  writeOctalField(block, 0, 116, 8)
  writeOctalField(block, size, 124, 12)
  writeOctalField(block, 1700000000, 136, 12)
  // The checksum field participates in the checksum as spaces.
  for (let i = 148; i < 156; i++) block[i] = 0x20
  block.write(entry.type === 'directory' ? '5' : '0', 156, 1, 'ascii')
  block.write('ustar', 257, 'ascii')
  block.write('00', 263, 'ascii')
  const checksum = block.reduce((sum, byte) => sum + byte, 0)
  block.write(checksum.toString(8).padStart(6, '0'), 148, 'ascii')
  block[154] = 0
  block[155] = 0x20
  return block
}

function buildTar(entries: FixtureEntry[]): Buffer {
  const chunks: Buffer[] = []
  for (const entry of entries) {
    chunks.push(tarHeader(entry))
    if (entry.type === 'file' && entry.content) {
      chunks.push(entry.content)
      const padding = (512 - (entry.content.length % 512)) % 512
      if (padding > 0) chunks.push(Buffer.alloc(padding))
    }
  }
  // Two zero blocks end the archive.
  chunks.push(Buffer.alloc(1024))
  return Buffer.concat(chunks)
}

/**
 * Gzip a fixture tree the way codeload wraps it: everything under a single
 * top-level `<repo>-<ref>/` directory.
 */
function buildRepoTarball(entries: FixtureEntry[]): Buffer {
  const wrapped: FixtureEntry[] = entries.map((entry) => ({
    ...entry,
    path: `repo-main/${entry.path}`,
  }))
  return gzipSync(buildTar(wrapped))
}

function fileEntry(
  path: string,
  content: string | Buffer,
  mode = 0o644,
): FixtureEntry {
  return {
    path,
    type: 'file',
    mode,
    content:
      typeof content === 'string' ? Buffer.from(content, 'utf-8') : content,
  }
}

function dirEntry(path: string, mode = 0o755): FixtureEntry {
  return { path, type: 'directory', mode }
}

/** The alpha fixture tree, repo-relative, byte-identical to the CLI pin. */
function alphaFixtureEntries(): FixtureEntry[] {
  return [
    dirEntry('skills'),
    dirEntry('skills/alpha-skill'),
    fileEntry('skills/alpha-skill/SKILL.md', ALPHA_SKILL_MD),
    dirEntry('skills/alpha-skill/scripts'),
    fileEntry('skills/alpha-skill/scripts/run.sh', ALPHA_RUN_SH, 0o755),
    fileEntry('skills/alpha-skill/data.bin', ALPHA_DATA_BIN),
    dirEntry('skills/alpha-skill/node_modules'),
    dirEntry('skills/alpha-skill/node_modules/ignored'),
    fileEntry('skills/alpha-skill/node_modules/ignored/x.js', ALPHA_NOISE_JS),
  ]
}

function betaFixtureEntries(): FixtureEntry[] {
  return [
    dirEntry('skills'),
    dirEntry('skills/beta-skill'),
    fileEntry('skills/beta-skill/SKILL.md', BETA_SKILL_MD),
  ]
}

// ── Loopback GitHub fixture server ───────────────────────────────────────

interface FixtureRoute {
  status: number
  body: Buffer | string
  contentType?: string
  /** Extra response headers, e.g. a lying content-length. */
  headers?: Record<string, string>
  /** Raw chunks written without a content-length — forces chunked encoding. */
  chunks?: Buffer[]
  /** Never respond at all — the client only escapes via its own abort. */
  hang?: boolean
}

interface FixtureServer {
  server: Server
  baseUrl: string
  /** Per-test route table; first match wins. */
  routes: Map<string, FixtureRoute>
}

async function startFixtureServer(): Promise<FixtureServer> {
  const routes = new Map<string, FixtureRoute>()
  const server = createServer((req, res) => {
    const route = req.url ? routes.get(req.url) : undefined
    if (!route) {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('not found')
      return
    }
    // A hanging route leaves the socket open so the test can abort mid-fetch.
    if (route.hang) return
    res.writeHead(route.status, {
      'content-type': route.contentType ?? 'application/octet-stream',
      ...route.headers,
    })
    if (route.chunks) {
      // No content-length header: Node falls back to chunked encoding, which
      // is exactly the lying-server shape the stream cap exists for.
      for (const chunk of route.chunks) res.write(chunk)
      res.end()
      return
    }
    res.end(route.body)
  })
  return new Promise<FixtureServer>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve({ server, baseUrl: `http://127.0.0.1:${port}`, routes })
    })
  })
}

let fixture: FixtureServer

beforeAll(async () => {
  fixture = await startFixtureServer()
  vi.stubEnv('SKILLS_MANAGER_GITHUB_API_URL', fixture.baseUrl)
  vi.stubEnv('SKILLS_MANAGER_CODELOAD_URL', fixture.baseUrl)
  vi.stubEnv('SKILLS_API_URL', fixture.baseUrl)
})

afterAll(async () => {
  await new Promise((resolve) => fixture.server.close(resolve))
  await rm(sharedHome, { recursive: true, force: true })
})

beforeEach(async () => {
  fixture.routes.clear()
  await rm(join(sharedHome, '.agents'), { recursive: true, force: true })
  await rm(join(sharedHome, '.claude'), { recursive: true, force: true })
  await rm(join(sharedHome, '.cursor'), { recursive: true, force: true })
  await rm(join(sharedHome, 'local-source'), { recursive: true, force: true })
  await mkdir(sourceDir, { recursive: true })
  delete process.env.XDG_STATE_HOME
  // `.claude` resolution honors CLAUDE_CONFIG_DIR; pin it inside the sandbox
  // so a developer machine's own setting can never leak into the assertions.
  vi.stubEnv('CLAUDE_CONFIG_DIR', join(sharedHome, '.claude'))
})

afterEach(() => {
  vi.unstubAllEnvs()
  // vi.unstubAllEnvs drops the beforeAll stubs too — restore the server seams.
  vi.stubEnv('SKILLS_MANAGER_GITHUB_API_URL', fixture.baseUrl)
  vi.stubEnv('SKILLS_MANAGER_CODELOAD_URL', fixture.baseUrl)
  vi.stubEnv('SKILLS_API_URL', fixture.baseUrl)
  delete process.env.XDG_STATE_HOME
})

/**
 * Route one repo fixture the way GitHub would answer it: metadata on the API
 * path, the gzip tarball on the codeload path.
 * @param ownerRepo - `owner/repo` slug the install will request.
 * @param entries - Repo-relative fixture entries.
 */
function routeRepo(ownerRepo: string, entries: FixtureEntry[]): void {
  fixture.routes.set(`/repos/${ownerRepo}`, {
    status: 200,
    body: JSON.stringify({ default_branch: 'main' }),
    contentType: 'application/json',
  })
  fixture.routes.set(`/${ownerRepo}/tar.gz/main`, {
    status: 200,
    body: buildRepoTarball(entries),
  })
}

/** Read and parse the global lock straight off disk. */
async function readLock(): Promise<{
  version: number
  skills: Record<string, Record<string, unknown>>
  [extra: string]: unknown
}> {
  return JSON.parse(await readFile(lockPath, 'utf-8'))
}

describe('install from a GitHub tarball', () => {
  test('installs a single skill with canonical copy, relative symlink, and a CLI-compatible lock entry', async () => {
    // Arrange
    const { skillManager } = await managerModule
    routeRepo('acme/skills', alphaFixtureEntries())

    // Act
    const outcome = await skillManager.install({
      source: 'acme/skills',
      agents: ['claude-code'],
    })

    // Assert — outcome reports verified success
    expect(outcome.success).toBe(true)
    expect(outcome.results).toEqual([{ name: 'alpha-skill', success: true }])

    // Assert — canonical copy carries the real bytes, including the binary
    // file verbatim and the executable bit on the script.
    const canonicalDir = join(sourceDir, 'alpha-skill')
    expect(await readFile(join(canonicalDir, 'SKILL.md'), 'utf-8')).toBe(
      ALPHA_SKILL_MD,
    )
    expect(await readFile(join(canonicalDir, 'data.bin'))).toEqual(
      ALPHA_DATA_BIN,
    )
    const scriptStat = await stat(join(canonicalDir, 'scripts', 'run.sh'))
    expect(scriptStat.mode & 0o111).not.toBe(0)

    // Assert — the agent slot is a symlink whose target is the RELATIVE path
    // back to the canonical copy, exactly what the CLI writes.
    const linkPath = join(sharedHome, '.claude', 'skills', 'alpha-skill')
    expect((await lstat(linkPath)).isSymbolicLink()).toBe(true)
    expect(await readlink(linkPath)).toBe(
      join('..', '..', '.agents', 'skills', 'alpha-skill'),
    )

    // Assert — the lock entry is field-for-field what the CLI writes, with
    // the hard-coded hash the real CLI computed for this tree.
    const lock = await readLock()
    expect(lock.version).toBe(3)
    expect(lock.dismissed).toEqual({})
    const entry = lock.skills['alpha-skill']
    expect(entry.source).toBe('acme/skills')
    expect(entry.sourceType).toBe('github')
    expect(entry.sourceUrl).toBe('https://github.com/acme/skills.git')
    expect(entry.skillPath).toBe('skills/alpha-skill/SKILL.md')
    expect(entry.skillFolderHash).toBe(ALPHA_CLI_HASH)
    expect(entry.ref).toBeUndefined()
    expect(typeof entry.installedAt).toBe('string')
    expect(typeof entry.updatedAt).toBe('string')
  })

  test('keeps node_modules noise out of the hash but copies it into the canonical tree', async () => {
    // Arrange — the fixture ships node_modules/ignored/x.js. The CLI's hash
    // skips node_modules content (the compat pin above only matches because
    // it does), while the copy exclusions do not list it.
    const { skillManager } = await managerModule
    routeRepo('acme/skills', alphaFixtureEntries())

    // Act
    const outcome = await skillManager.install({
      source: 'acme/skills',
      agents: [],
    })

    // Assert
    expect(outcome.success).toBe(true)
    expect(
      await readFile(
        join(sourceDir, 'alpha-skill', 'node_modules', 'ignored', 'x.js'),
        'utf-8',
      ),
    ).toBe('noise')
    const lock = await readLock()
    expect(lock.skills['alpha-skill'].skillFolderHash).toBe(ALPHA_CLI_HASH)
  })

  test('installs only the filtered skill out of a multi-skill repo', async () => {
    // Arrange
    const { skillManager } = await managerModule
    routeRepo('acme/skills', [
      ...alphaFixtureEntries(),
      ...betaFixtureEntries(),
    ])

    // Act
    const outcome = await skillManager.install({
      source: 'acme/skills',
      skillNames: ['Beta Skill'],
      agents: [],
    })

    // Assert — the raw name keys the lock while the directory is sanitized.
    expect(outcome.success).toBe(true)
    expect(outcome.results).toEqual([{ name: 'Beta Skill', success: true }])
    expect(
      await readFile(join(sourceDir, 'beta-skill', 'SKILL.md'), 'utf-8'),
    ).toBe(BETA_SKILL_MD)
    const lock = await readLock()
    expect(Object.keys(lock.skills)).toEqual(['Beta Skill'])
    await expect(stat(join(sourceDir, 'alpha-skill'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  test('matches the skill filter case-insensitively like the CLI does', async () => {
    // Arrange
    const { skillManager } = await managerModule
    routeRepo('acme/skills', alphaFixtureEntries())

    // Act
    const outcome = await skillManager.install({
      source: 'acme/skills',
      skillNames: ['ALPHA-SKILL'],
      agents: [],
    })

    // Assert
    expect(outcome.success).toBe(true)
    expect(outcome.results).toEqual([{ name: 'alpha-skill', success: true }])
  })

  test('fails with the available names when the filter matches nothing', async () => {
    // Arrange
    const { skillManager } = await managerModule
    routeRepo('acme/skills', [
      ...alphaFixtureEntries(),
      ...betaFixtureEntries(),
    ])

    // Act
    const outcome = await skillManager.install({
      source: 'acme/skills',
      skillNames: ['no-such-skill'],
      agents: [],
    })

    // Assert — nothing touches disk, and the user sees what they could have picked.
    expect(outcome.success).toBe(false)
    expect(outcome.userMessage).toBe(
      'No matching skills found. Available in this source: Beta Skill, alpha-skill',
    )
    await expect(stat(lockPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test('applies the @skill fragment carried by the source string itself', async () => {
    // Arrange
    const { skillManager } = await managerModule
    routeRepo('acme/skills', [
      ...alphaFixtureEntries(),
      ...betaFixtureEntries(),
    ])

    // Act
    const outcome = await skillManager.install({
      source: 'acme/skills@beta skill',
      agents: [],
    })

    // Assert
    expect(outcome.success).toBe(true)
    expect(outcome.results).toEqual([{ name: 'Beta Skill', success: true }])
  })

  test('records a user-pinned ref in the lock entry and fetches that ref', async () => {
    // Arrange — only the pinned ref is routed, so a wrong ref fetch 404s.
    const { skillManager } = await managerModule
    fixture.routes.set('/repos/acme/skills', {
      status: 200,
      body: JSON.stringify({ default_branch: 'main' }),
      contentType: 'application/json',
    })
    fixture.routes.set('/acme/skills/tar.gz/v1.2.3', {
      status: 200,
      body: buildRepoTarball(alphaFixtureEntries()),
    })

    // Act
    const outcome = await skillManager.install({
      source: 'acme/skills#v1.2.3',
      agents: [],
    })

    // Assert
    expect(outcome.success).toBe(true)
    const lock = await readLock()
    expect(lock.skills['alpha-skill'].ref).toBe('v1.2.3')
  })

  test('scopes discovery to the subpath carried by a tree URL', async () => {
    // Arrange — alpha lives outside the scoped subpath and must not install.
    const { skillManager } = await managerModule
    const entries = [
      dirEntry('plugins'),
      dirEntry('plugins/beta'),
      fileEntry('plugins/beta/SKILL.md', BETA_SKILL_MD),
      ...alphaFixtureEntries(),
    ]
    routeRepo('acme/skills', entries)

    // Act
    const outcome = await skillManager.install({
      source: 'https://github.com/acme/skills/tree/main/plugins/beta',
      agents: [],
    })

    // Assert
    expect(outcome.success).toBe(true)
    expect(outcome.results).toEqual([{ name: 'Beta Skill', success: true }])
    const lock = await readLock()
    // The SKILL.md path is still repo-relative — update checks depend on it.
    expect(lock.skills['Beta Skill'].skillPath).toBe('plugins/beta/SKILL.md')
  })

  test('replaces a real directory occupying the agent slot with the symlink', async () => {
    // Arrange — a stale copy sits where the symlink must go; the CLI deletes
    // it outright and so does the port.
    const { skillManager } = await managerModule
    routeRepo('acme/skills', alphaFixtureEntries())
    const occupiedDir = join(sharedHome, '.claude', 'skills', 'alpha-skill')
    await mkdir(occupiedDir, { recursive: true })
    await writeFile(join(occupiedDir, 'STALE.md'), 'stale\n', 'utf-8')

    // Act
    const outcome = await skillManager.install({
      source: 'acme/skills',
      agents: ['claude-code'],
    })

    // Assert
    expect(outcome.success).toBe(true)
    expect((await lstat(occupiedDir)).isSymbolicLink()).toBe(true)
    await expect(stat(join(occupiedDir, 'STALE.md'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  test('wipes stale files out of the canonical tree on reinstall and keeps installedAt', async () => {
    // Arrange — v1 ships a file the v2 fixture drops.
    const { skillManager } = await managerModule
    routeRepo('acme/skills', [
      ...alphaFixtureEntries(),
      fileEntry('skills/alpha-skill/ONLY-IN-V1.md', 'v1 only\n'),
    ])
    const first = await skillManager.install({
      source: 'acme/skills',
      agents: [],
    })
    expect(first.success).toBe(true)
    const firstLock = await readLock()
    const firstInstalledAt = firstLock.skills['alpha-skill'].installedAt

    // Act — reinstall the same source without the extra file.
    routeRepo('acme/skills', alphaFixtureEntries())
    const second = await skillManager.install({
      source: 'acme/skills',
      agents: [],
    })

    // Assert
    expect(second.success).toBe(true)
    await expect(
      stat(join(sourceDir, 'alpha-skill', 'ONLY-IN-V1.md')),
    ).rejects.toMatchObject({ code: 'ENOENT' })
    const lock = await readLock()
    // The CLI preserves installedAt across reinstalls and bumps updatedAt.
    expect(lock.skills['alpha-skill'].installedAt).toBe(firstInstalledAt)
    expect(typeof lock.skills['alpha-skill'].updatedAt).toBe('string')
  })

  test('preserves unknown lock fields the CLI or a newer tool wrote', async () => {
    // Arrange — seed a lock carrying prompt-dismissal state, agent memory,
    // and an entry with a field this build does not know.
    const { skillManager } = await managerModule
    routeRepo('acme/skills', alphaFixtureEntries())
    await mkdir(join(sharedHome, '.agents'), { recursive: true })
    await writeFile(
      lockPath,
      JSON.stringify(
        {
          version: 3,
          skills: {
            'other-skill': {
              source: 'acme/other',
              sourceType: 'github',
              futureField: { nested: true },
            },
          },
          dismissed: { 'find-skills': true },
          lastSelectedAgents: ['claude-code'],
        },
        null,
        2,
      ),
      'utf-8',
    )

    // Act
    const outcome = await skillManager.install({
      source: 'acme/skills',
      agents: [],
    })

    // Assert
    expect(outcome.success).toBe(true)
    const lock = await readLock()
    expect(lock.dismissed).toEqual({ 'find-skills': true })
    expect(lock.lastSelectedAgents).toEqual(['claude-code'])
    expect(lock.skills['other-skill'].futureField).toEqual({ nested: true })
    expect(lock.skills['alpha-skill'].sourceType).toBe('github')
  })

  test('writes the lock byte-compatibly: two-space JSON with no trailing newline', async () => {
    // Arrange
    const { skillManager } = await managerModule
    routeRepo('acme/skills', alphaFixtureEntries())

    // Act
    await skillManager.install({ source: 'acme/skills', agents: [] })

    // Assert — the CLI's writer is `JSON.stringify(lock, null, 2)` and nothing else.
    const raw = await readFile(lockPath, 'utf-8')
    expect(raw.endsWith('\n')).toBe(false)
    expect(raw).toBe(JSON.stringify(JSON.parse(raw), null, 2))
  })

  test('reports a GitHub 404 as a dialog-safe failure and writes nothing', async () => {
    // Arrange — no routes at all: every answer is the server's 404.
    const { skillManager } = await managerModule

    // Act
    const outcome = await skillManager.install({
      source: 'acme/missing',
      agents: ['claude-code'],
    })

    // Assert
    expect(outcome.success).toBe(false)
    expect(outcome.results).toEqual([])
    expect(outcome.userMessage).toBe(
      'Repository "acme/missing" was not found on GitHub. Check the owner and repo name, or sign in if it is private.',
    )
    await expect(stat(lockPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(join(sourceDir, 'missing'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  test('reports a corrupt tarball as a failure instead of crashing', async () => {
    // Arrange — valid gzip framing around bytes that are not a tar stream is
    // one variant; here the body is not even gzip.
    const { skillManager } = await managerModule
    fixture.routes.set('/repos/acme/skills', {
      status: 200,
      body: JSON.stringify({ default_branch: 'main' }),
      contentType: 'application/json',
    })
    fixture.routes.set('/acme/skills/tar.gz/main', {
      status: 200,
      body: Buffer.from('this is not gzip data at all'),
    })

    // Act
    const outcome = await skillManager.install({
      source: 'acme/skills',
      agents: [],
    })

    // Assert
    expect(outcome.success).toBe(false)
    expect(outcome.userMessage).toBe(
      'The repository archive is corrupt or is not a valid gzip stream.',
    )
    await expect(stat(lockPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test('rejects an unsupported source before touching network or disk', async () => {
    // Arrange
    const { skillManager } = await managerModule

    // Act
    const outcome = await skillManager.install({
      source: 'https://gitlab.com/acme/skills',
      agents: [],
    })

    // Assert
    expect(outcome.success).toBe(false)
    expect(outcome.userMessage).toBe(
      'This source type is not supported. Use a GitHub repository ' +
        '(owner/repo or a github.com URL) or a local directory path.',
    )
    await expect(stat(lockPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test('emits the structured progress phases in pipeline order', async () => {
    // Arrange
    const { skillManager } = await managerModule
    routeRepo('acme/skills', alphaFixtureEntries())
    const phases: string[] = []

    // Act
    await skillManager.install({
      source: 'acme/skills',
      agents: ['claude-code'],
      onProgress: (progress) => phases.push(progress.phase),
    })

    // Assert — the renderer drives its progress line off these; order matters.
    expect(phases).toEqual([
      'fetching',
      'extracting',
      'copying',
      'linking',
      'writing-lock',
      'complete',
    ])
  })

  test('stops before fetching when the cancel signal is already aborted', async () => {
    // Arrange — no routes: any fetch would surface as a 404 failure instead.
    const { skillManager } = await managerModule
    const controller = new AbortController()
    controller.abort()

    // Act
    const outcome = await skillManager.install({
      source: 'acme/skills',
      agents: [],
      signal: controller.signal,
    })

    // Assert — cancelled, not "not found": the abort wins over every other error.
    expect(outcome.success).toBe(false)
    expect(outcome.userMessage).toBe('Installation cancelled.')
  })
})

describe('install from a local directory', () => {
  test('copies a local skill into the canonical tree with a local lock entry', async () => {
    // Arrange — a real directory on disk, the way a user would point at a checkout.
    const { skillManager } = await managerModule
    const localDir = join(sharedHome, 'local-source')
    await mkdir(join(localDir, 'skills', 'alpha-skill', 'scripts'), {
      recursive: true,
    })
    await writeFile(
      join(localDir, 'skills', 'alpha-skill', 'SKILL.md'),
      ALPHA_SKILL_MD,
      'utf-8',
    )
    await writeFile(
      join(localDir, 'skills', 'alpha-skill', 'scripts', 'run.sh'),
      ALPHA_RUN_SH,
      'utf-8',
    )
    await writeFile(
      join(localDir, 'skills', 'alpha-skill', 'data.bin'),
      ALPHA_DATA_BIN,
    )
    await mkdir(
      join(localDir, 'skills', 'alpha-skill', 'node_modules', 'ignored'),
      {
        recursive: true,
      },
    )
    await writeFile(
      join(
        localDir,
        'skills',
        'alpha-skill',
        'node_modules',
        'ignored',
        'x.js',
      ),
      ALPHA_NOISE_JS,
      'utf-8',
    )

    // Act
    const outcome = await skillManager.install({
      source: localDir,
      agents: ['claude-code'],
    })

    // Assert — same canonical+symlink layout as a GitHub install…
    expect(outcome.success).toBe(true)
    expect(
      await readFile(join(sourceDir, 'alpha-skill', 'SKILL.md'), 'utf-8'),
    ).toBe(ALPHA_SKILL_MD)
    expect(
      (
        await lstat(join(sharedHome, '.claude', 'skills', 'alpha-skill'))
      ).isSymbolicLink(),
    ).toBe(true)

    // Assert — …but the lock entry is the CLI's local shape: no skillPath,
    // source and sourceUrl both the resolved directory path, and the same
    // content hash the CLI wrote for this tree.
    const lock = await readLock()
    const entry = lock.skills['alpha-skill']
    expect(entry.source).toBe(localDir)
    expect(entry.sourceType).toBe('local')
    expect(entry.sourceUrl).toBe(localDir)
    expect(entry.skillPath).toBeUndefined()
    expect(entry.skillFolderHash).toBe(ALPHA_CLI_HASH)
  })

  test('fails cleanly when the local path does not exist', async () => {
    // Arrange
    const { skillManager } = await managerModule
    const missing = join(sharedHome, 'no-such-place')

    // Act
    const outcome = await skillManager.install({ source: missing, agents: [] })

    // Assert
    expect(outcome.success).toBe(false)
    expect(outcome.userMessage).toBe(`No directory exists at ${missing}.`)
  })
})

describe('remove', () => {
  test('removes the canonical copy, the agent symlinks, and the lock entry', async () => {
    // Arrange — a full install to dismantle.
    const { skillManager } = await managerModule
    routeRepo('acme/skills', alphaFixtureEntries())
    await skillManager.install({
      source: 'acme/skills',
      agents: ['claude-code'],
    })

    // Act
    const outcome = await skillManager.remove(['alpha-skill'])

    // Assert
    expect(outcome.success).toBe(true)
    await expect(stat(join(sourceDir, 'alpha-skill'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
    await expect(
      lstat(join(sharedHome, '.claude', 'skills', 'alpha-skill')),
    ).rejects.toMatchObject({ code: 'ENOENT' })
    const lock = await readLock()
    expect(lock.skills['alpha-skill']).toBeUndefined()
  })

  test('resolves a raw lock key that differs from its sanitized directory name', async () => {
    // Arrange — 'Beta Skill' keys the lock while 'beta-skill' names the dir.
    const { skillManager } = await managerModule
    routeRepo('acme/skills', betaFixtureEntries())
    await skillManager.install({
      source: 'acme/skills',
      agents: ['claude-code'],
    })

    // Act — the prune flow hands raw lock keys; resolution must not require
    // the caller to know the sanitized form.
    const outcome = await skillManager.remove(['Beta Skill'])

    // Assert
    expect(outcome.success).toBe(true)
    await expect(stat(join(sourceDir, 'beta-skill'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
    const lock = await readLock()
    expect(lock.skills['Beta Skill']).toBeUndefined()
  })

  test('removes real copies in agent directories, not just symlinks', async () => {
    // Arrange — the fallback-copy outcome a failed symlink would have left.
    const { skillManager } = await managerModule
    routeRepo('acme/skills', alphaFixtureEntries())
    await skillManager.install({
      source: 'acme/skills',
      agents: ['claude-code'],
    })
    const agentPath = join(sharedHome, '.claude', 'skills', 'alpha-skill')
    await rm(agentPath, { force: true })
    await mkdir(agentPath, { recursive: true })
    await writeFile(join(agentPath, 'COPIED.md'), 'copied\n', 'utf-8')

    // Act
    const outcome = await skillManager.remove(['alpha-skill'])

    // Assert — matches the CLI: whatever occupies the agent slot is deleted.
    // (Unattended callers guard real directories upstream; remove itself is faithful.)
    expect(outcome.success).toBe(true)
    await expect(lstat(agentPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test('reports an unknown name as a per-item failure', async () => {
    // Arrange
    const { skillManager } = await managerModule

    // Act
    const outcome = await skillManager.remove(['never-installed'])

    // Assert
    expect(outcome.success).toBe(false)
    expect(outcome.results).toEqual([
      {
        name: 'never-installed',
        success: false,
        error: 'No matching skill found for: never-installed',
        userMessage: '"never-installed" is not installed.',
      },
    ])
  })
})

describe('search', () => {
  test('maps the skills.sh response onto ranked marketplace results', async () => {
    // Arrange — deliberately unsorted: the port sorts by installs descending.
    const { skillManager } = await managerModule
    fixture.routes.set('/api/search?q=react&limit=20', {
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        skills: [
          {
            name: 'small-skill',
            id: 'acme/tools/small-skill',
            source: 'acme/tools',
            installs: 12,
          },
          {
            name: 'react-best-practices',
            id: 'vercel-labs/agent-skills/react-best-practices',
            source: 'vercel-labs/agent-skills',
            installs: 402700,
          },
        ],
      }),
    })

    // Act
    const results = await skillManager.search('react')

    // Assert
    expect(results).toEqual([
      {
        rank: 1,
        name: 'react-best-practices',
        repo: 'vercel-labs/agent-skills',
        url: 'https://skills.sh/vercel-labs/agent-skills/react-best-practices',
        installCount: 402700,
      },
      {
        rank: 2,
        name: 'small-skill',
        repo: 'acme/tools',
        url: 'https://skills.sh/acme/tools/small-skill',
        installCount: 12,
      },
    ])
  })

  test('drops entries whose name or repo would be unsafe downstream', async () => {
    // Arrange — the same rejection rule the old CLI-output parser enforced.
    const { skillManager } = await managerModule
    fixture.routes.set('/api/search?q=x&limit=20', {
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        skills: [
          {
            name: '../traversal',
            id: 'acme/tools/traversal',
            source: 'acme/tools',
            installs: 99,
          },
          {
            name: 'good-skill',
            id: 'acme/tools/good-skill',
            source: 'acme/tools',
            installs: 5,
          },
        ],
      }),
    })

    // Act
    const results = await skillManager.search('x')

    // Assert — only the safe entry survives, re-ranked from 1.
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('good-skill')
    expect(results[0].rank).toBe(1)
  })

  test('throws on a network-level failure so the UI never confuses it with no-results', async () => {
    // Arrange — point the API at a port nothing listens on.
    const { skillManager } = await managerModule
    vi.stubEnv('SKILLS_API_URL', 'http://127.0.0.1:1')

    // Act + Assert
    await expect(skillManager.search('react')).rejects.toThrow(
      'The skill search could not reach skills.sh. Check your network connection.',
    )
  })

  test('throws on an HTTP error status', async () => {
    // Arrange
    const { skillManager } = await managerModule
    fixture.routes.set('/api/search?q=react&limit=20', {
      status: 500,
      body: 'server error',
    })

    // Act + Assert
    await expect(skillManager.search('react')).rejects.toThrow(
      'The skill search failed (HTTP 500). Try again later.',
    )
  })
})

describe('lock byte-compatibility', () => {
  test('reads a pre-v3 lock as empty exactly like the CLI', async () => {
    // Arrange — a v2 lock the CLI would wipe on its next read.
    const { skillManager } = await managerModule
    routeRepo('acme/skills', alphaFixtureEntries())
    await mkdir(join(sharedHome, '.agents'), { recursive: true })
    await writeFile(
      lockPath,
      JSON.stringify({ version: 2, skills: { legacy: { source: 'x' } } }),
      'utf-8',
    )

    // Act — installing must not carry the legacy entry forward.
    const outcome = await skillManager.install({
      source: 'acme/skills',
      agents: [],
    })

    // Assert
    expect(outcome.success).toBe(true)
    const lock = await readLock()
    expect(lock.version).toBe(3)
    expect(lock.skills.legacy).toBeUndefined()
    expect(lock.skills['alpha-skill']).toBeDefined()
  })

  test('a corrupt lock reads as empty and is replaced by a valid write', async () => {
    // Arrange — torn bytes, the CLI kill-mid-write signature.
    const { skillManager } = await managerModule
    routeRepo('acme/skills', alphaFixtureEntries())
    await mkdir(join(sharedHome, '.agents'), { recursive: true })
    await writeFile(lockPath, '{ "version": 3, "skills": { ', 'utf-8')

    // Act
    const outcome = await skillManager.install({
      source: 'acme/skills',
      agents: [],
    })

    // Assert
    expect(outcome.success).toBe(true)
    const lock = await readLock()
    expect(lock.skills['alpha-skill']).toBeDefined()
  })
})

describe('install edge paths', () => {
  test('skips a broken symlink inside a local skill instead of failing the install', async () => {
    // Arrange — a skill tree carrying a symlink whose target does not exist.
    const { skillManager } = await managerModule
    const skillDir = join(sharedHome, 'local-source', 'broken-link-skill')
    await mkdir(skillDir, { recursive: true })
    await writeFile(
      join(skillDir, 'SKILL.md'),
      '---\nname: broken-link-skill\ndescription: Carries a dangling link\n---\n',
      'utf-8',
    )
    await symlink(
      join(skillDir, 'missing-target'),
      join(skillDir, 'dangling.sh'),
    )

    // Act
    const outcome = await skillManager.install({
      source: join(sharedHome, 'local-source'),
      agents: [],
    })

    // Assert — the install succeeds and the dangling link is simply absent.
    expect(outcome.success).toBe(true)
    expect(outcome.results[0]).toEqual({
      name: 'broken-link-skill',
      success: true,
    })
    const copied = await stat(join(sourceDir, 'broken-link-skill', 'SKILL.md'))
    expect(copied.isFile()).toBe(true)
    expect(
      await lstat(join(sourceDir, 'broken-link-skill', 'dangling.sh')).catch(
        () => null,
      ),
    ).toBeNull()
  })

  test('reports a per-skill failure when a source file cannot be read', async () => {
    // Arrange — one payload file is unreadable even though the SKILL.md parses.
    const { skillManager } = await managerModule
    const skillDir = join(sharedHome, 'local-source', 'unreadable-skill')
    await mkdir(skillDir, { recursive: true })
    await writeFile(
      join(skillDir, 'SKILL.md'),
      '---\nname: unreadable-skill\ndescription: One file cannot be read\n---\n',
      'utf-8',
    )
    const secretFile = join(skillDir, 'secret.txt')
    await writeFile(secretFile, 'secret', 'utf-8')
    await chmod(secretFile, 0o000)

    try {
      // Act
      const outcome = await skillManager.install({
        source: join(sharedHome, 'local-source'),
        agents: [],
      })

      // Assert — the copy error surfaces as a per-skill failure, not a crash.
      expect(outcome.success).toBe(false)
      expect(outcome.results[0].success).toBe(false)
      expect(outcome.results[0].userMessage).toContain(
        '"unreadable-skill" could not be installed:',
      )
    } finally {
      // Restore readability so the sandbox teardown can delete the file.
      await chmod(secretFile, 0o644)
    }
  })

  test('leaves an already-correct agent symlink in place on reinstall', async () => {
    // Arrange — an installed skill whose agent link already points correctly.
    const { skillManager } = await managerModule
    routeRepo('acme/skills', alphaFixtureEntries())
    const first = await skillManager.install({
      source: 'acme/skills',
      agents: ['claude-code'],
    })
    expect(first.success).toBe(true)
    const linkPath = join(sharedHome, '.claude', 'skills', 'alpha-skill')
    const targetBefore = await readlink(linkPath)

    // Act — reinstall the very same skill into the very same agent.
    const second = await skillManager.install({
      source: 'acme/skills',
      agents: ['claude-code'],
    })

    // Assert — success, and the relative link target is byte-identical.
    expect(second.success).toBe(true)
    expect(second.results[0]).toEqual({ name: 'alpha-skill', success: true })
    expect(await readlink(linkPath)).toBe(targetBefore)
    expect((await lstat(linkPath)).isSymbolicLink()).toBe(true)
  })

  test('rejects a local source that is a file rather than a directory', async () => {
    // Arrange — a plain file sits where the skill collection should be.
    const { skillManager } = await managerModule
    const filePath = join(sharedHome, 'local-source')
    await mkdir(sharedHome, { recursive: true })
    await writeFile(filePath, 'not a directory', 'utf-8')

    // Act
    const outcome = await skillManager.install({
      source: filePath,
      agents: [],
    })

    // Assert
    expect(outcome).toEqual({
      success: false,
      results: [],
      userMessage: 'The local path is not a directory.',
    })
  })

  test('reports no valid skills for a local directory without any SKILL.md', async () => {
    // Arrange — an empty collection layout.
    const { skillManager } = await managerModule
    await mkdir(join(sharedHome, 'local-source', 'random', 'deep'), {
      recursive: true,
    })

    // Act
    const outcome = await skillManager.install({
      source: join(sharedHome, 'local-source'),
      agents: [],
    })

    // Assert
    expect(outcome).toEqual({
      success: false,
      results: [],
      userMessage:
        'No valid skills were found in this source. A skill needs a SKILL.md with a name and description.',
    })
  })

  test('reports a generic failure when archive paths collide with a file', async () => {
    // Arrange — a hand-built archive whose second entry nests under the first,
    // which is a regular file: the temp-dir write throws ENOTDIR, an error
    // the tarball reader never raised itself.
    const { skillManager } = await managerModule
    routeRepo('acme/skills', [
      fileEntry('x', 'plain file content'),
      fileEntry('x/y.txt', 'unreachable child'),
    ])

    // Act
    const outcome = await skillManager.install({
      source: 'acme/skills',
      agents: [],
    })

    // Assert — the pipeline reports failure instead of crashing the process.
    expect(outcome.success).toBe(false)
    expect(outcome.results).toEqual([])
    expect(outcome.userMessage).toContain('Installation failed:')
  })
})

describe('agent slot replacement', () => {
  test('replaces a symlink that points at the wrong target with the correct one', async () => {
    // Arrange — the agent slot already holds a symlink, but it points at a
    // stale directory rather than the canonical copy.
    const { skillManager } = await managerModule
    routeRepo('acme/skills', alphaFixtureEntries())
    const staleTarget = join(sharedHome, 'stale-copy')
    await mkdir(staleTarget, { recursive: true })
    const claudeSkills = join(sharedHome, '.claude', 'skills')
    await mkdir(claudeSkills, { recursive: true })
    await symlink(staleTarget, join(claudeSkills, 'alpha-skill'))

    // Act
    const outcome = await skillManager.install({
      source: 'acme/skills',
      agents: ['claude-code'],
    })

    // Assert — success, and the link now resolves into the canonical tree.
    expect(outcome).toEqual({
      success: true,
      results: [{ name: 'alpha-skill', success: true }],
    })
    expect(
      (await lstat(join(claudeSkills, 'alpha-skill'))).isSymbolicLink(),
    ).toBe(true)
    expect(await readlink(join(claudeSkills, 'alpha-skill'))).toBe(
      join('..', '..', '.agents', 'skills', 'alpha-skill'),
    )
    // The stale directory itself was left alone — only the link was replaced.
    expect((await stat(staleTarget)).isDirectory()).toBe(true)
  })

  test('fails the skill when neither the symlink nor the copy fallback can be written', async () => {
    // Arrange — the agent skills dir turns read-only after the first install
    // layout exists, so the symlink fails with EACCES and the copy fallback
    // cannot create its directory either.
    const { skillManager } = await managerModule
    const skillDir = join(sharedHome, 'local-source', 'skills', 'blocked-skill')
    await mkdir(skillDir, { recursive: true })
    await writeFile(
      join(skillDir, 'SKILL.md'),
      '---\nname: blocked-skill\ndescription: Agent slot is readonly\n---\n',
      'utf-8',
    )
    const claudeSkills = join(sharedHome, '.claude', 'skills')
    await mkdir(claudeSkills, { recursive: true })
    await chmod(claudeSkills, 0o555)

    try {
      // Act
      const outcome = await skillManager.install({
        source: join(sharedHome, 'local-source'),
        agents: ['claude-code'],
      })

      // Assert — the per-skill failure names the agent that resisted.
      expect(outcome.success).toBe(false)
      expect(outcome.results[0].success).toBe(false)
      expect(outcome.results[0].userMessage).toContain(
        '"blocked-skill" could not be installed:',
      )
      expect(outcome.results[0].userMessage).toContain('.claude')
    } finally {
      await chmod(claudeSkills, 0o755)
    }
  })
})

describe('lock write failure', () => {
  test('fails the skill install when the lock file cannot be written', async () => {
    // Arrange — the lock directory turns read-only after the canonical copy
    // location already exists, so only the atomic lock write itself can fail.
    const { skillManager } = await managerModule
    routeRepo('acme/skills', alphaFixtureEntries())
    const agentsDir = join(sharedHome, '.agents')
    await chmod(agentsDir, 0o555)

    try {
      // Act
      const outcome = await skillManager.install({
        source: 'acme/skills',
        agents: [],
      })

      // Assert — the per-skill failure names the skill, and no lock exists.
      expect(outcome.success).toBe(false)
      expect(outcome.results[0].success).toBe(false)
      expect(outcome.results[0].userMessage).toContain(
        '"alpha-skill" could not be installed:',
      )
      expect(await readLock().catch(() => null)).toBeNull()
    } finally {
      // Restore writability so later tests can use the sandbox again.
      await chmod(agentsDir, 0o755)
    }
  })

  test('reads a structurally invalid lock as empty even though the JSON parses', async () => {
    // Arrange — valid JSON, but the version is a string: outside the schema.
    const { skillManager } = await managerModule
    routeRepo('acme/skills', alphaFixtureEntries())
    await writeFile(
      lockPath,
      JSON.stringify({ version: '3', skills: { ghost: { source: 'x' } } }),
      'utf-8',
    )

    // Act
    const outcome = await skillManager.install({
      source: 'acme/skills',
      agents: [],
    })

    // Assert — the ghost entry never carries forward, the write is clean v3.
    expect(outcome.success).toBe(true)
    const lock = await readLock()
    expect(lock.version).toBe(3)
    expect(lock.skills.ghost).toBeUndefined()
    expect(lock.skills['alpha-skill']).toBeDefined()
  })
})

describe('remove edge paths', () => {
  test('removes a lock-only skill even when the canonical root is missing entirely', async () => {
    // Arrange — a lock record survives, but the whole skills root is gone.
    const { skillManager } = await managerModule
    await writeFile(
      lockPath,
      JSON.stringify({
        version: 3,
        skills: {
          'ghost-skill': {
            source: 'acme/skills',
            sourceType: 'github',
          },
        },
      }),
      'utf-8',
    )
    await rm(sourceDir, { recursive: true, force: true })

    // Act
    const outcome = await skillManager.remove(['ghost-skill'])

    // Assert — resolution falls back to lock keys alone and still succeeds.
    expect(outcome).toEqual({
      success: true,
      results: [{ name: 'ghost-skill', success: true }],
    })
    const lock = JSON.parse(await readFile(lockPath, 'utf-8'))
    expect(lock.skills['ghost-skill']).toBeUndefined()
  })

  test('still removes the skill when one agent directory refuses cleanup', async () => {
    // Arrange — an installed skill whose agent directory is read-only, so
    // unlinking the agent symlink fails with EACCES while the rest proceeds.
    const { skillManager } = await managerModule
    routeRepo('acme/skills', alphaFixtureEntries())
    const installed = await skillManager.install({
      source: 'acme/skills',
      agents: ['claude-code'],
    })
    expect(installed.success).toBe(true)
    const claudeSkills = join(sharedHome, '.claude', 'skills')
    await chmod(claudeSkills, 0o555)

    try {
      // Act
      const outcome = await skillManager.remove(['alpha-skill'])

      // Assert — the CLI semantics: a stubborn agent warns but never fails
      // the removal; canonical copy and lock entry are gone.
      expect(outcome).toEqual({
        success: true,
        results: [{ name: 'alpha-skill', success: true }],
      })
      expect(
        await stat(join(sourceDir, 'alpha-skill')).catch(() => null),
      ).toBeNull()
      const lock = JSON.parse(await readFile(lockPath, 'utf-8'))
      expect(lock.skills['alpha-skill']).toBeUndefined()
    } finally {
      await chmod(claudeSkills, 0o755)
    }
  })

  test('reports a per-item failure when the canonical directory cannot be removed', async () => {
    // Arrange — the skills root turns read-only, so deleting the canonical
    // copy inside it fails even though resolution and agent cleanup worked.
    const { skillManager } = await managerModule
    routeRepo('acme/skills', alphaFixtureEntries())
    const installed = await skillManager.install({
      source: 'acme/skills',
      agents: [],
    })
    expect(installed.success).toBe(true)
    await chmod(sourceDir, 0o555)

    try {
      // Act
      const outcome = await skillManager.remove(['alpha-skill'])

      // Assert
      expect(outcome.success).toBe(false)
      expect(outcome.results[0].success).toBe(false)
      expect(outcome.results[0].userMessage).toContain(
        '"alpha-skill" could not be removed:',
      )
      // The canonical copy survived the failed removal.
      expect((await stat(join(sourceDir, 'alpha-skill'))).isDirectory()).toBe(
        true,
      )
    } finally {
      await chmod(sourceDir, 0o755)
    }
  })
})

describe('tarball fetch edge paths', () => {
  test('reports rate limiting with the GITHUB_TOKEN hint on HTTP 403', async () => {
    // Arrange
    const { skillManager } = await managerModule
    fixture.routes.set('/repos/acme/skills', {
      status: 200,
      body: JSON.stringify({ default_branch: 'main' }),
      contentType: 'application/json',
    })
    fixture.routes.set('/acme/skills/tar.gz/main', {
      status: 403,
      body: 'rate limited',
    })

    // Act
    const outcome = await skillManager.install({
      source: 'acme/skills',
      agents: [],
    })

    // Assert
    expect(outcome).toEqual({
      success: false,
      results: [],
      userMessage:
        'GitHub rate-limited the download of "acme/skills". Try again later, or set GITHUB_TOKEN.',
    })
  })

  test('reports a generic GitHub error message on HTTP 500', async () => {
    // Arrange
    const { skillManager } = await managerModule
    fixture.routes.set('/acme/skills/tar.gz/main', {
      status: 500,
      body: 'server error',
    })

    // Act — a pinned ref skips the metadata call, hitting codeload directly.
    const outcome = await skillManager.install({
      source: 'acme/skills#main',
      agents: [],
    })

    // Assert
    expect(outcome).toEqual({
      success: false,
      results: [],
      userMessage:
        'GitHub returned an error (HTTP 500) while fetching "acme/skills".',
    })
  })

  test('fails clearly when the repo metadata carries no default branch', async () => {
    // Arrange — GitHub answers the repo lookup but the JSON is missing the field.
    const { skillManager } = await managerModule
    fixture.routes.set('/repos/acme/skills', {
      status: 200,
      body: JSON.stringify({}),
      contentType: 'application/json',
    })

    // Act
    const outcome = await skillManager.install({
      source: 'acme/skills',
      agents: [],
    })

    // Assert
    expect(outcome).toEqual({
      success: false,
      results: [],
      userMessage: 'Could not determine the default branch of "acme/skills".',
    })
  })

  test('reports a network failure when GitHub cannot be reached at all', async () => {
    // Arrange — codeload resolves to a port nothing listens on.
    const { skillManager } = await managerModule
    vi.stubEnv('SKILLS_MANAGER_CODELOAD_URL', 'http://127.0.0.1:1')

    // Act — the pinned ref keeps the metadata call on the healthy fixture.
    const outcome = await skillManager.install({
      source: 'acme/skills#main',
      agents: [],
    })

    // Assert
    expect(outcome).toEqual({
      success: false,
      results: [],
      userMessage:
        'Could not reach GitHub for "acme/skills". Check your network connection.',
    })
  })

  test('rejects a download whose content-length already exceeds the cap', async () => {
    // Arrange — the server lies cheaply: tiny body, huge declared length.
    const { skillManager } = await managerModule
    fixture.routes.set('/acme/skills/tar.gz/main', {
      status: 200,
      body: 'tiny',
      headers: { 'content-length': '200000000' },
    })

    // Act
    const outcome = await skillManager.install({
      source: 'acme/skills#main',
      agents: [],
    })

    // Assert
    expect(outcome).toEqual({
      success: false,
      results: [],
      userMessage: 'The repository archive is too large to install.',
    })
  })

  test(
    'rejects a chunked download that streams past the byte cap',
    { timeout: 30_000 },
    async () => {
      // Arrange — no content-length, just 100 MiB + 1 byte of chunked body.
      const { skillManager } = await managerModule
      const half = Buffer.alloc(51 * 1024 * 1024, 0x61)
      fixture.routes.set('/acme/skills/tar.gz/main', {
        status: 200,
        body: '',
        chunks: [half, half],
      })

      // Act
      const outcome = await skillManager.install({
        source: 'acme/skills#main',
        agents: [],
      })

      // Assert
      expect(outcome).toEqual({
        success: false,
        results: [],
        userMessage: 'The repository archive is too large to install.',
      })
    },
  )

  test('reports a failed download when the response carries no body', async () => {
    // Arrange — 204 is a success status yet forbidden from carrying a body.
    const { skillManager } = await managerModule
    fixture.routes.set('/acme/skills/tar.gz/main', {
      status: 204,
      body: '',
    })

    // Act
    const outcome = await skillManager.install({
      source: 'acme/skills#main',
      agents: [],
    })

    // Assert
    expect(outcome).toEqual({
      success: false,
      results: [],
      userMessage:
        'The download failed. Check your network connection and try again.',
    })
  })

  test('cancels cleanly when the user aborts while the download is in flight', async () => {
    // Arrange — the server accepts the request and never answers it.
    const { skillManager } = await managerModule
    fixture.routes.set('/acme/skills/tar.gz/main', {
      status: 200,
      body: '',
      hang: true,
    })
    const controller = new AbortController()

    // Act — abort once the fetch is definitely in flight.
    const pending = skillManager.install({
      source: 'acme/skills#main',
      agents: [],
      signal: controller.signal,
    })
    setTimeout(() => controller.abort(), 150)
    const outcome = await pending

    // Assert
    expect(outcome).toEqual({
      success: false,
      results: [],
      userMessage: 'Installation cancelled.',
    })
  })
})

describe('search edge paths', () => {
  test('throws on a search response whose body is not valid JSON', async () => {
    // Arrange
    const { skillManager } = await managerModule
    fixture.routes.set('/api/search?q=react&limit=20', {
      status: 200,
      body: 'this is not json',
      contentType: 'application/json',
    })

    // Act + Assert
    await expect(skillManager.search('react')).rejects.toThrow(
      'The skill search returned an unreadable response.',
    )
  })
})

describe('destructive-operation guards', () => {
  test('refuses a local install whose source is the canonical tree itself instead of deleting it', async () => {
    // Arrange — a skill already lives in the canonical tree, and the user
    // points the install source straight at it. Without the overlap guard the
    // wipe-and-recopy would delete the source before reading it.
    const { skillManager } = await managerModule
    const canonical = join(sourceDir, 'self-skill')
    await mkdir(canonical, { recursive: true })
    await writeFile(
      join(canonical, 'SKILL.md'),
      '---\nname: self-skill\ndescription: Already canonical\n---\n',
      'utf-8',
    )

    // Act — install the canonical tree as a local source collection.
    const outcome = await skillManager.install({
      source: sourceDir,
      agents: [],
    })

    // Assert — failure, and the original tree is byte-identical afterwards.
    expect(outcome.success).toBe(false)
    expect(outcome.results[0].success).toBe(false)
    expect(outcome.results[0].userMessage).toContain(
      '"self-skill" could not be installed:',
    )
    expect(await readFile(join(canonical, 'SKILL.md'), 'utf-8')).toContain(
      'name: self-skill',
    )
  })

  test('refuses an install when two skills sanitize to the same directory before copying anything', async () => {
    // Arrange — `My Skill` and `my--skill` are distinct frontmatter names
    // (so dedupe keeps both) but both sanitize to `my-skill`; copying the
    // second would wipe-and-recopy straight over the first. The fixture
    // directories deliberately differ in more than case so they coexist on
    // a case-insensitive filesystem.
    const { skillManager } = await managerModule
    routeRepo('acme/skills', [
      dirEntry('skills'),
      dirEntry('skills/first'),
      fileEntry(
        'skills/first/SKILL.md',
        '---\nname: My Skill\ndescription: Collision fixture one\n---\n',
      ),
      dirEntry('skills/second'),
      fileEntry(
        'skills/second/SKILL.md',
        '---\nname: my--skill\ndescription: Collision fixture two\n---\n',
      ),
    ])

    // Act
    const outcome = await skillManager.install({
      source: 'acme/skills',
      agents: [],
    })

    // Assert — the whole operation fails up front and nothing is written.
    expect(outcome).toEqual({
      success: false,
      results: [],
      userMessage:
        'These skills would install into the same directory: "My Skill" and "my--skill". Rename one of them and try again.',
    })
    expect(await stat(join(sourceDir, 'my-skill')).catch(() => null)).toBeNull()
    expect(await readLock().catch(() => null)).toBeNull()
  })

  test('does not overwrite the lock when it cannot be read back for a write', async () => {
    // Arrange — a healthy lock with records turns unreadable mid-flight
    // (chmod 000 stands in for EMFILE/EIO-style transient fs failures).
    const { skillManager } = await managerModule
    routeRepo('acme/skills', alphaFixtureEntries())
    await writeFile(
      lockPath,
      JSON.stringify({
        version: 3,
        skills: {
          'existing-skill': { source: 'acme/other', sourceType: 'github' },
        },
      }),
      'utf-8',
    )
    const originalBytes = await readFile(lockPath, 'utf-8')
    await chmod(lockPath, 0o000)

    try {
      // Act
      const outcome = await skillManager.install({
        source: 'acme/skills',
        agents: [],
      })

      // Assert — the install fails rather than writing a false-empty lock.
      expect(outcome.success).toBe(false)
    } finally {
      await chmod(lockPath, 0o644)
    }
    // The pre-existing records survived untouched — no false-empty overwrite.
    expect(await readFile(lockPath, 'utf-8')).toBe(originalBytes)
  })

  test('preserves a corrupt lock aside before replacing it with a valid write', async () => {
    // Arrange — torn bytes the CLI kill-mid-write signature leaves behind.
    const { skillManager } = await managerModule
    routeRepo('acme/skills', alphaFixtureEntries())
    const tornBytes = '{ "version": 3, "skills": { '
    await writeFile(lockPath, tornBytes, 'utf-8')

    // Act
    const outcome = await skillManager.install({
      source: 'acme/skills',
      agents: [],
    })

    // Assert — the install recovers, and the corrupt bytes survive beside it.
    expect(outcome.success).toBe(true)
    const agentsEntries = await readdir(join(sharedHome, '.agents'))
    const backups = agentsEntries.filter((entry) =>
      entry.startsWith('.skill-lock.json.corrupt-'),
    )
    expect(backups).toHaveLength(1)
    expect(
      await readFile(join(sharedHome, '.agents', backups[0]), 'utf-8'),
    ).toBe(tornBytes)
    expect((await readLock()).skills['alpha-skill']).toBeDefined()
  })

  test('treats a well-formed-but-wrong-shaped lock as empty on the lenient display read', async () => {
    // Arrange — valid JSON whose shape is not a lock file. The lenient read
    // (used to detect already-installed skills before copying) forgives it,
    // while the strict write path still preserves the bytes as corrupt.
    const { skillManager } = await managerModule
    routeRepo('acme/skills', alphaFixtureEntries())
    await writeFile(lockPath, '{ "version": 3, "skills": null }', 'utf-8')

    // Act
    const outcome = await skillManager.install({
      source: 'acme/skills',
      agents: [],
    })

    // Assert — the install treats the lock as empty and still completes.
    expect(outcome.success).toBe(true)
    expect((await readLock()).skills['alpha-skill']).toBeDefined()
    const agentsEntries = await readdir(join(sharedHome, '.agents'))
    expect(
      agentsEntries.some((entry) =>
        entry.startsWith('.skill-lock.json.corrupt-'),
      ),
    ).toBe(true)
  })

  test('removal reads a wrong-shaped lock as empty instead of crashing', async () => {
    // Arrange — valid JSON that is not a lock shape; remove's lenient display
    // read must forgive it exactly like the CLI's read path does.
    const { skillManager } = await managerModule
    await writeFile(lockPath, '{ "version": 3, "skills": null }', 'utf-8')

    // Act
    const outcome = await skillManager.remove(['alpha-skill'])

    // Assert — the empty read means the skill simply is not in the lock.
    expect(outcome.results).toHaveLength(1)
    expect(outcome.results[0].success).toBe(false)
  })

  test('removal reads unparseable lock bytes as empty instead of crashing', async () => {
    // Arrange — torn write bytes in the lock.
    const { skillManager } = await managerModule
    await writeFile(lockPath, '{ "version": 3, "skills": { ', 'utf-8')

    // Act
    const outcome = await skillManager.remove(['alpha-skill'])

    // Assert
    expect(outcome.results).toHaveLength(1)
    expect(outcome.results[0].success).toBe(false)
  })

  test('still attempts the write when a corrupt lock cannot be renamed aside', async () => {
    // Arrange — corrupt bytes plus a read-only `.agents` directory, so the
    // best-effort backup rename itself fails. The write then fails too, but
    // the backup failure must only warn rather than abort the cycle early.
    const { skillManager } = await managerModule
    routeRepo('acme/skills', alphaFixtureEntries())
    await writeFile(lockPath, '{ not json', 'utf-8')
    const agentsDir = join(sharedHome, '.agents')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await chmod(agentsDir, 0o555)
    let outcome
    try {
      // Act
      outcome = await skillManager.install({
        source: 'acme/skills',
        agents: [],
      })
    } finally {
      await chmod(agentsDir, 0o755)
    }

    // Assert — the backup failure surfaced as a warning and the write
    // failure — not a crash — decides the outcome.
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('could not back up corrupt lock'),
    )
    warnSpy.mockRestore()
    expect(outcome?.success).toBe(false)
  })
})
