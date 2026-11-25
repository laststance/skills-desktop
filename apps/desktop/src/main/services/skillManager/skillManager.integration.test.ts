import { mkdtempSync, realpathSync } from 'node:fs'
import {
  lstat,
  mkdir,
  readFile,
  readlink,
  rm,
  stat,
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

interface FixtureServer {
  server: Server
  baseUrl: string
  /** Per-test route table; first match wins. */
  routes: Map<
    string,
    { status: number; body: Buffer | string; contentType?: string }
  >
}

async function startFixtureServer(): Promise<FixtureServer> {
  const routes = new Map<
    string,
    { status: number; body: Buffer | string; contentType?: string }
  >()
  const server = createServer((req, res) => {
    const route = req.url ? routes.get(req.url) : undefined
    if (!route) {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('not found')
      return
    }
    res.writeHead(route.status, {
      'content-type': route.contentType ?? 'application/octet-stream',
    })
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
