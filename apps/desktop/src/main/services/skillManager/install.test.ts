import { mkdtempSync, realpathSync } from 'node:fs'
import type { PathLike } from 'node:fs'
import type * as NodeFsPromises from 'node:fs/promises'
import {
  lstat,
  mkdir,
  readlink,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import type * as NodeOs from 'node:os'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest'

/**
 * Failure-injection tests for the install verification step. The filesystem
 * stays real everywhere; the only seam is a mutable arming flag inside the
 * `node:fs/promises` mock that turns ONE operation hostile for a narrowly
 * matched path. That is the only way to reach the post-write verification
 * failure paths — a successful copy followed by a broken stat cannot happen
 * on a healthy filesystem on its own.
 */

// Stamped synchronously at module load, before `main/constants` evaluates.
const sharedHome = realpathSync(
  mkdtempSync(join(tmpdir(), 'skill-manager-install-test-')),
)
const sourceDir = join(sharedHome, '.agents', 'skills')
const claudeSkillsDir = join(sharedHome, '.claude', 'skills')

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof NodeOs>('node:os')
  return { ...actual, homedir: () => sharedHome }
})

// `main/constants` imports from the bare `'os'` specifier — both need mocking.
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof NodeOs>('os')
  return { ...actual, homedir: () => sharedHome }
})

/**
 * Mutable arming state for the fs mock below. Every flag defaults off, so an
 * unarmed test exercises the completely real filesystem.
 */
const fsControl = vi.hoisted(() => ({
  /** stat() rejects with EACCES for paths containing this substring. */
  failStatFor: null as string | null,
  /** lstat() rejects with EACCES for paths containing this substring. */
  failLstatFor: null as string | null,
  /** realpath() always rejects with EACCES. */
  failRealpath: false,
  /** symlink() always rejects with EACCES. */
  failSymlink: false,
}))

function armedError(): Error {
  return Object.assign(new Error('armed EACCES for test'), { code: 'EACCES' })
}

function armedFor(path: PathLike, substring: string | null): boolean {
  return substring !== null && String(path).includes(substring)
}

vi.mock('node:fs/promises', async () => {
  const actual =
    await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
  return {
    ...actual,
    stat: async (path: PathLike) => {
      if (armedFor(path, fsControl.failStatFor)) throw armedError()
      return actual.stat(path)
    },
    lstat: async (path: PathLike) => {
      if (armedFor(path, fsControl.failLstatFor)) throw armedError()
      return actual.lstat(path)
    },
    realpath: async (path: PathLike) => {
      if (fsControl.failRealpath) throw armedError()
      return actual.realpath(path)
    },
    symlink: async (target: PathLike, path: PathLike): Promise<void> => {
      if (fsControl.failSymlink) throw armedError()
      return actual.symlink(target, path)
    },
  }
})

const managerModule = import('./index')

beforeEach(async () => {
  await rm(join(sharedHome, '.agents'), { recursive: true, force: true })
  await rm(join(sharedHome, '.claude'), { recursive: true, force: true })
  await rm(join(sharedHome, 'local-source'), { recursive: true, force: true })
  await mkdir(sourceDir, { recursive: true })
  delete process.env.XDG_STATE_HOME
  vi.stubEnv('CLAUDE_CONFIG_DIR', join(sharedHome, '.claude'))
})

afterEach(() => {
  vi.unstubAllEnvs()
  fsControl.failStatFor = null
  fsControl.failLstatFor = null
  fsControl.failRealpath = false
  fsControl.failSymlink = false
})

afterAll(async () => {
  await rm(sharedHome, { recursive: true, force: true })
})

/** Write a one-skill local collection the install can copy from. */
async function stageLocalSkill(name: string): Promise<string> {
  const skillDir = join(sharedHome, 'local-source', 'skills', name)
  await mkdir(skillDir, { recursive: true })
  await writeFile(
    join(skillDir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: Verification fixture\n---\n`,
    'utf-8',
  )
  return join(sharedHome, 'local-source')
}

describe('install verification', () => {
  test('fails the skill when the canonical directory cannot be verified after copying', async () => {
    // Arrange — stat() turns hostile for exactly the canonical directory, so
    // the copy succeeds but the post-write verification cannot confirm it.
    const { skillManager } = await managerModule
    const source = await stageLocalSkill('verify-stat')
    fsControl.failStatFor = join('.agents', 'skills', 'verify-stat')

    // Act
    const outcome = await skillManager.install({ source, agents: [] })

    // Assert — verification failure surfaces as a per-skill failure, and the
    // message names the skill rather than crashing the operation.
    expect(outcome.success).toBe(false)
    expect(outcome.results).toHaveLength(1)
    expect(outcome.results[0].success).toBe(false)
    expect(outcome.results[0].userMessage).toContain(
      '"verify-stat" could not be installed: Install verification failed',
    )
    expect(outcome.userMessage).toBe(outcome.results[0].userMessage)
  })

  test('fails the skill when an agent link cannot be verified after linking', async () => {
    // Arrange — lstat() turns hostile for the agent link path. The same
    // failure first hits createRelativeSymlink, where a non-ENOENT lstat
    // error only triggers the best-effort cleanup before linking proceeds;
    // the verification afterwards is what actually fails the install.
    const { skillManager } = await managerModule
    const source = await stageLocalSkill('verify-link')
    fsControl.failLstatFor = join('.claude', 'skills', 'verify-link')

    // Act
    const outcome = await skillManager.install({
      source,
      agents: ['claude-code'],
    })

    // Assert
    expect(outcome.success).toBe(false)
    expect(outcome.results[0].success).toBe(false)
    expect(outcome.results[0].userMessage).toContain(
      '"verify-link" could not be installed: Install verification failed',
    )
  })
})

describe('agent link fallback', () => {
  test('falls back to a full copy when the symlink cannot be created', async () => {
    // Arrange — symlink() always fails, the way it does on Windows machines
    // without developer mode; the copy fallback must carry the install.
    const { skillManager } = await managerModule
    const source = await stageLocalSkill('copy-fallback')
    fsControl.failSymlink = true

    // Act
    const outcome = await skillManager.install({
      source,
      agents: ['claude-code'],
    })

    // Assert — success, and the agent slot is a real directory, not a link.
    expect(outcome).toEqual({
      success: true,
      results: [{ name: 'copy-fallback', success: true }],
    })
    const linkPath = join(claudeSkillsDir, 'copy-fallback')
    expect((await lstat(linkPath)).isSymbolicLink()).toBe(false)
    expect((await lstat(linkPath)).isDirectory()).toBe(true)
  })

  test('computes the relative symlink lexically when the parent realpath cannot resolve', async () => {
    // Arrange — realpath() is broken wholesale; link creation must degrade
    // to the lexical parent path rather than failing the install.
    const { skillManager } = await managerModule
    const source = await stageLocalSkill('realpath-broken')
    fsControl.failRealpath = true

    // Act
    const outcome = await skillManager.install({
      source,
      agents: ['claude-code'],
    })

    // Assert — the link still lands, pointing at the canonical copy.
    expect(outcome).toEqual({
      success: true,
      results: [{ name: 'realpath-broken', success: true }],
    })
    const linkPath = join(claudeSkillsDir, 'realpath-broken')
    expect((await lstat(linkPath)).isSymbolicLink()).toBe(true)
    expect(await readlink(linkPath)).toBe(
      join('..', '..', '.agents', 'skills', 'realpath-broken'),
    )
  })
})

describe('copySkillTree overlap guard — deep symlinked ancestors', () => {
  test('refuses the copy when an uncreated destination tail hides inside the source through a symlinked ancestor', async () => {
    // Arrange — mirror of the review finding: `alias` is a symlink onto the
    // source itself, and the destination's `new` segment does not exist yet,
    // so only ancestor-level resolution can see the real copy target.
    const { copySkillTree } = await import('./copyLayout')
    const base = realpathSync(
      mkdtempSync(join(tmpdir(), 'skill-overlap-deep-')),
    )
    const src = join(base, 'demo')
    await mkdir(src, { recursive: true })
    await writeFile(
      join(src, 'SKILL.md'),
      '---\nname: demo\ndescription: x\n---\n',
    )
    await symlink(src, join(base, 'alias'))
    const dest = join(base, 'alias', 'new', 'demo')

    // Act + Assert — the guard fires before anything is wiped.
    await expect(copySkillTree(src, dest)).rejects.toThrow(
      'Install source and destination overlap',
    )
    expect((await lstat(join(src, 'SKILL.md'))).isFile()).toBe(true)
    await rm(base, { recursive: true, force: true })
  })

  test('allows the copy when the resolved destination only shares a lexical prefix', async () => {
    // Arrange — sibling directory `demo-copy` starts with the same bytes but
    // is neither the source nor inside it; the copy must proceed.
    const { copySkillTree } = await import('./copyLayout')
    const base = realpathSync(
      mkdtempSync(join(tmpdir(), 'skill-overlap-sibling-')),
    )
    const src = join(base, 'demo')
    await mkdir(src, { recursive: true })
    await writeFile(
      join(src, 'SKILL.md'),
      '---\nname: demo\ndescription: x\n---\n',
    )
    const dest = join(base, 'demo-copy')

    // Act
    await copySkillTree(src, dest)

    // Assert
    expect((await lstat(join(dest, 'SKILL.md'))).isFile()).toBe(true)
    await rm(base, { recursive: true, force: true })
  })
})
