import { EventEmitter } from 'events'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SKILLS_CLI_VERSION } from '@/shared/constants'
import { repositoryId } from '@/shared/types'
import type { InstallProgress } from '@/shared/types'

/**
 * Fake child process so we can drive stdout/stderr/close from the test.
 * The real `ChildProcess` has ~40 fields we do not touch; the cast is safe
 * because execCli() only consumes `.stdout.on('data')`, `.stderr.on('data')`,
 * `.on('close')`, `.on('error')`, and `.kill()`.
 */
class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  kill = vi.fn()
}

// vi.mock factories are HOISTED to the top of the file — any closure vars
// they reference must be declared inside vi.hoisted() so they exist at mock
// evaluation time. Otherwise spawnMock is `undefined` when the service first
// imports child_process and the handlers never fire (→ test timeouts).
const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn<(...args: unknown[]) => FakeChildProcess>(),
}))

vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}))

const ORIGINAL_PATH = process.env.PATH

/**
 * Drive the fake process to simulate a CLI invocation. `spawn` is called by
 * `execCli` synchronously, so we stage the fake ahead of the call and emit
 * events on the next microtask — after the Promise handlers register.
 *
 * @param stdout - stdout text chunks to emit
 * @param stderr - stderr text chunks to emit
 * @param exitCode - close event code (0 = success)
 */
function simulateCli({
  stdout = '',
  stderr = '',
  exitCode = 0,
  autoClose = true,
}: {
  stdout?: string
  stderr?: string
  exitCode?: number
  autoClose?: boolean
}): FakeChildProcess {
  const fake = new FakeChildProcess()
  spawnMock.mockImplementationOnce(() => {
    if (autoClose) {
      // Defer emission until after execCli finishes attaching listeners
      queueMicrotask(() => {
        if (stdout) fake.stdout.emit('data', Buffer.from(stdout))
        if (stderr) fake.stderr.emit('data', Buffer.from(stderr))
        fake.emit('close', exitCode)
      })
    }
    return fake
  })
  return fake
}

describe('skillsCliService.cancel', () => {
  beforeEach(() => {
    vi.useRealTimers()
    vi.resetModules()
    spawnMock.mockReset()
  })

  afterEach(() => {
    process.env.PATH = ORIGINAL_PATH
  })

  it('kills all running CLI children on cancel()', async () => {
    // Arrange
    const first = simulateCli({ autoClose: false })
    const second = simulateCli({ autoClose: false })
    const { skillsCliService } = await import('./skillsCliService')
    const searchA = skillsCliService.search('a')
    const searchB = skillsCliService.search('b')

    // Act
    skillsCliService.cancel()

    // Assert
    expect(first.kill).toHaveBeenCalledWith('SIGTERM')
    expect(second.kill).toHaveBeenCalledWith('SIGTERM')

    // Drain the killed children so the pending search promises settle.
    first.emit('close', 0)
    second.emit('close', 0)
    await Promise.all([searchA, searchB])
  })
})

describe('skillsCliService.execCli environment', () => {
  beforeEach(() => {
    vi.useRealTimers()
    vi.resetModules()
    spawnMock.mockReset()
    process.env.PATH = '/usr/bin:/bin:/usr/sbin:/sbin'
  })

  afterEach(() => {
    process.env.PATH = ORIGINAL_PATH
  })

  it('adds common Node toolchain paths so Finder-launched installs can find npx', async () => {
    // Arrange
    simulateCli({
      stdout:
        'vercel-labs/skills@find-skills\n└ https://skills.sh/vercel-labs/skills/find-skills\n',
    })
    const { skillsCliService } = await import('./skillsCliService')

    // Act
    await skillsCliService.search('find-skills')

    // Assert
    expect(spawnMock).toHaveBeenCalledWith(
      'npx',
      [`skills@${SKILLS_CLI_VERSION}`, 'find', 'find-skills'],
      expect.objectContaining({
        env: expect.objectContaining({
          FORCE_COLOR: '0',
          PATH: expect.stringMatching(/\/usr\/bin.*\/opt\/homebrew\/bin/),
        }),
      }),
    )
  })

  it('builds a clean PATH from only the toolchain fallbacks when the process has no inherited PATH', async () => {
    // Arrange — a Finder launch can leave PATH unset entirely; deleting the var
    // makes it genuinely `undefined` (assigning `undefined` would coerce to the
    // string 'undefined' and never exercise the empty-string fallback).
    delete process.env.PATH
    simulateCli({
      stdout:
        'vercel-labs/skills@find-skills\n└ https://skills.sh/vercel-labs/skills/find-skills\n',
    })
    const { skillsCliService } = await import('./skillsCliService')

    // Act — search must not crash on the missing PATH and still resolve.
    const results = await skillsCliService.search('find-skills')

    // Assert — the spawned env PATH contains the toolchain fallbacks and never
    // leaks the literal string 'undefined' from a missing inherited PATH.
    expect(results).toHaveLength(1)
    const spawnEnv = spawnMock.mock.calls[0]?.[2] as { env: { PATH: string } }
    expect(spawnEnv.env.PATH).toContain('/opt/homebrew/bin')
    expect(spawnEnv.env.PATH).not.toContain('undefined')
  })
})

describe('skillsCliService.search', () => {
  beforeEach(() => {
    vi.useRealTimers()
    vi.resetModules()
    spawnMock.mockReset()
  })

  afterEach(() => {
    process.env.PATH = ORIGINAL_PATH
  })

  it('shows search results ranked with their install counts from the current CLI output', async () => {
    // Arrange
    simulateCli({
      stdout: [
        'Install with npx skills add <owner/repo@skill>',
        '',
        'vercel-labs/agent-skills@vercel-react-best-practices 402.7K installs',
        '└ https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices',
        '',
        'google-labs-code/stitch-skills@react:components 44.5K installs',
        '└ https://skills.sh/google-labs-code/stitch-skills/react:components',
      ].join('\n'),
    })
    const { skillsCliService } = await import('./skillsCliService')

    // Act
    const results = await skillsCliService.search('react')

    // Assert
    expect(results).toEqual([
      {
        rank: 1,
        name: 'vercel-react-best-practices',
        repo: 'vercel-labs/agent-skills',
        url: 'https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices',
        installCount: 402700,
      },
      {
        rank: 2,
        name: 'react:components',
        repo: 'google-labs-code/stitch-skills',
        url: 'https://skills.sh/google-labs-code/stitch-skills/react:components',
        installCount: 44500,
      },
    ])
  })

  it('shows search results without an install count when the legacy CLI output omits one', async () => {
    // Arrange
    simulateCli({
      stdout: [
        'vercel-labs/agent-skills@vercel-react-best-practices',
        '└ https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices',
      ].join('\n'),
    })
    const { skillsCliService } = await import('./skillsCliService')

    // Act
    const results = await skillsCliService.search('react')

    // Assert
    expect(results).toEqual([
      {
        rank: 1,
        name: 'vercel-react-best-practices',
        repo: 'vercel-labs/agent-skills',
        url: 'https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices',
      },
    ])
    expect(results[0]).not.toHaveProperty('installCount')
  })

  it('synthesizes a skills.sh URL for a result row whose CLI output has no matching URL line', async () => {
    // Arrange — the first row carries a real `└ https://...` line, the second
    // row is followed by free text that does not match the URL pattern, so its
    // url must be reconstructed from the repo and skill name.
    simulateCli({
      stdout: [
        'vercel-labs/agent-skills@with-url 10 installs',
        '└ https://skills.sh/vercel-labs/agent-skills/with-url',
        'vercel-labs/agent-skills@no-url 20 installs',
        'No more results found',
      ].join('\n'),
    })
    const { skillsCliService } = await import('./skillsCliService')

    // Act
    const results = await skillsCliService.search('skills')

    // Assert — the URL-less row falls back to the constructed skills.sh link.
    expect(results).toEqual([
      {
        rank: 1,
        name: 'with-url',
        repo: 'vercel-labs/agent-skills',
        url: 'https://skills.sh/vercel-labs/agent-skills/with-url',
        installCount: 10,
      },
      {
        rank: 2,
        name: 'no-url',
        repo: 'vercel-labs/agent-skills',
        url: 'https://skills.sh/vercel-labs/agent-skills/no-url',
        installCount: 20,
      },
    ])
  })
})

describe('skillsCliService.install', () => {
  beforeEach(() => {
    vi.useRealTimers()
    vi.resetModules()
    spawnMock.mockReset()
  })

  afterEach(() => {
    process.env.PATH = ORIGINAL_PATH
  })

  it('installs globally without agent flags for a Universal-only Marketplace install', async () => {
    // Arrange
    simulateCli({ stdout: 'Installation complete' })
    const { skillsCliService } = await import('./skillsCliService')

    // Act
    await skillsCliService.install({
      repo: repositoryId('vercel-labs/skills'),
      global: true,
      agents: [],
      skills: ['task'],
    })

    // Assert
    expect(spawnMock).toHaveBeenCalledWith(
      'npx',
      [
        `skills@${SKILLS_CLI_VERSION}`,
        'add',
        'vercel-labs/skills',
        '-y',
        '--global',
        '--skill',
        'task',
      ],
      expect.any(Object),
    )
  })

  it('adds one --agent flag per selected symlink target for Universal plus agents', async () => {
    // Arrange
    simulateCli({ stdout: 'Installation complete' })
    const { skillsCliService } = await import('./skillsCliService')

    // Act
    await skillsCliService.install({
      repo: repositoryId('vercel-labs/skills'),
      global: true,
      agents: ['claude-code', 'cursor'],
      skills: ['task'],
    })

    // Assert
    expect(spawnMock).toHaveBeenCalledWith(
      'npx',
      [
        `skills@${SKILLS_CLI_VERSION}`,
        'add',
        'vercel-labs/skills',
        '-y',
        '--global',
        '--agent',
        'claude-code',
        '--agent',
        'cursor',
        '--skill',
        'task',
      ],
      expect.any(Object),
    )
  })

  it('omits the --global flag for a project-local install', async () => {
    // Arrange
    simulateCli({ stdout: 'Installation complete' })
    const { skillsCliService } = await import('./skillsCliService')

    // Act
    await skillsCliService.install({
      repo: repositoryId('vercel-labs/skills'),
      global: false,
      agents: [],
      skills: ['task'],
    })

    // Assert — local scope means the CLI is invoked without `--global`.
    expect(spawnMock).toHaveBeenCalledWith(
      'npx',
      [
        `skills@${SKILLS_CLI_VERSION}`,
        'add',
        'vercel-labs/skills',
        '-y',
        '--skill',
        'task',
      ],
      expect.any(Object),
    )
  })

  it('omits every --skill flag when installing the entire repository', async () => {
    // Arrange — no `skills` key means "install every skill in the repo".
    simulateCli({ stdout: 'Installation complete' })
    const { skillsCliService } = await import('./skillsCliService')

    // Act
    await skillsCliService.install({
      repo: repositoryId('vercel-labs/skills'),
      global: true,
      agents: [],
    })

    // Assert — the whole-repo install carries no `--skill` selector.
    expect(spawnMock).toHaveBeenCalledWith(
      'npx',
      [
        `skills@${SKILLS_CLI_VERSION}`,
        'add',
        'vercel-labs/skills',
        '-y',
        '--global',
      ],
      expect.any(Object),
    )
  })
})

describe('skillsCliService.search failure handling', () => {
  beforeEach(() => {
    vi.useRealTimers()
    vi.resetModules()
    spawnMock.mockReset()
  })

  afterEach(() => {
    process.env.PATH = ORIGINAL_PATH
  })

  it('shows no results when the skills CLI exits with an error', async () => {
    // Arrange — non-zero exit code with stderr exercises both the failure
    // early-return and the stderr accumulation handler.
    simulateCli({
      stdout: '',
      stderr: 'network unreachable',
      exitCode: 1,
    })
    const { skillsCliService } = await import('./skillsCliService')

    // Act
    const results = await skillsCliService.search('react')

    // Assert
    expect(results).toEqual([])
  })

  it('skips a malformed result row whose repo segment has no owner slash', async () => {
    // Arrange — `notarepo@skill` matches the loose line pattern but fails the
    // strict REPO_PATTERN (no `owner/repo` slash), so it must be discarded.
    simulateCli({
      stdout: [
        'notarepo@skill 100 installs',
        '└ https://skills.sh/notarepo/skill',
        'vercel-labs/agent-skills@valid-skill 5 installs',
        '└ https://skills.sh/vercel-labs/agent-skills/valid-skill',
      ].join('\n'),
    })
    const { skillsCliService } = await import('./skillsCliService')

    // Act
    const results = await skillsCliService.search('skill')

    // Assert — only the well-formed row survives, ranked first.
    expect(results).toEqual([
      {
        rank: 1,
        name: 'valid-skill',
        repo: 'vercel-labs/agent-skills',
        url: 'https://skills.sh/vercel-labs/agent-skills/valid-skill',
        installCount: 5,
      },
    ])
  })
})

describe('skillsCliService.install failure and progress', () => {
  beforeEach(() => {
    vi.useRealTimers()
    vi.resetModules()
    spawnMock.mockReset()
  })

  afterEach(() => {
    process.env.PATH = ORIGINAL_PATH
  })

  it('emits an error progress event carrying the CLI stderr when an install fails', async () => {
    // Arrange
    const fake = simulateCli({ autoClose: false })
    const { skillsCliService } = await import('./skillsCliService')
    const emittedPhases: InstallProgress[] = []
    skillsCliService.on('progress', (progress: InstallProgress) => {
      emittedPhases.push(progress)
    })

    // Act — drive a failing exit with stderr content.
    const installPromise = skillsCliService.install({
      repo: repositoryId('vercel-labs/skills'),
      global: true,
      agents: [],
      skills: ['task'],
    })
    fake.stderr.emit('data', Buffer.from('permission denied'))
    fake.emit('close', 1)
    await installPromise

    // Assert
    expect(emittedPhases).toContainEqual({
      phase: 'error',
      message: 'permission denied',
      percent: undefined,
    })
  })

  it('emits a generic error message when a failed install produces no stderr', async () => {
    // Arrange
    const fake = simulateCli({ autoClose: false })
    const { skillsCliService } = await import('./skillsCliService')
    const emittedPhases: InstallProgress[] = []
    skillsCliService.on('progress', (progress: InstallProgress) => {
      emittedPhases.push(progress)
    })

    // Act — failing exit with empty stderr falls back to default copy.
    const installPromise = skillsCliService.install({
      repo: repositoryId('vercel-labs/skills'),
      global: true,
      agents: [],
      skills: ['task'],
    })
    fake.emit('close', 1)
    await installPromise

    // Assert
    expect(emittedPhases).toContainEqual({
      phase: 'error',
      message: 'Installation failed',
      percent: undefined,
    })
  })

  it('reports cloning, installing, and linking phases as the CLI streams progress', async () => {
    // Arrange — three separate chunks, one keyword each, because the ts-pattern
    // matcher returns on the FIRST hit; a single combined chunk would only
    // exercise the cloning branch.
    const fake = simulateCli({ autoClose: false })
    const { skillsCliService } = await import('./skillsCliService')
    const emittedPhases: InstallProgress[] = []
    skillsCliService.on('progress', (progress: InstallProgress) => {
      emittedPhases.push(progress)
    })

    // Act
    const installPromise = skillsCliService.install({
      repo: repositoryId('vercel-labs/skills'),
      global: true,
      agents: [],
      skills: ['task'],
    })
    fake.stdout.emit('data', Buffer.from('Downloading repository archive'))
    fake.stdout.emit('data', Buffer.from('Installing skill files now'))
    fake.stdout.emit('data', Buffer.from('Creating symlink for agent'))
    fake.emit('close', 0)
    await installPromise

    // Assert
    expect(emittedPhases).toContainEqual({
      phase: 'cloning',
      message: 'Cloning repository...',
      percent: undefined,
    })
    expect(emittedPhases).toContainEqual({
      phase: 'installing',
      message: 'Installing skill files...',
      percent: undefined,
    })
    expect(emittedPhases).toContainEqual({
      phase: 'linking',
      message: 'Creating agent symlinks...',
      percent: undefined,
    })
  })
})

describe('skillsCliService.execCli error and timeout paths', () => {
  beforeEach(() => {
    vi.resetModules()
    spawnMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    process.env.PATH = ORIGINAL_PATH
  })

  it('returns no results when spawning npx itself fails', async () => {
    // Arrange — the spawn `error` event (e.g. npx missing on PATH) resolves
    // the command as a failure, so search() yields an empty list.
    vi.useRealTimers()
    const fake = simulateCli({ autoClose: false })
    const { skillsCliService } = await import('./skillsCliService')

    // Act
    const searchPromise = skillsCliService.search('react')
    fake.emit('error', new Error('spawn npx ENOENT'))
    const results = await searchPromise

    // Assert
    expect(results).toEqual([])
  })

  it('ignores a late close event after the process already errored out', async () => {
    // Arrange — once finalize() has settled on the error path, a trailing
    // close must be a no-op (the settled guard), and the search still resolves.
    vi.useRealTimers()
    const fake = simulateCli({ autoClose: false })
    const { skillsCliService } = await import('./skillsCliService')

    // Act
    const searchPromise = skillsCliService.search('react')
    fake.emit('error', new Error('spawn npx ENOENT'))
    fake.emit('close', 0)
    const results = await searchPromise

    // Assert — the second finalize was ignored; the error result stands.
    expect(results).toEqual([])
  })

  it('aborts the CLI command and reports a timeout when npx hangs past the limit', async () => {
    // Arrange — fake timers let us fast-forward past the spawn timeout without
    // emitting any close/error, so the timeout handler fires and kills npx.
    // Mirrors the module-private SPAWN_TIMEOUT_MS in skillsCliService.ts; keep
    // this >= that value so advancing the clock always trips the timeout handler.
    const PAST_SPAWN_TIMEOUT_MS = 60_000
    vi.useFakeTimers()
    const fake = simulateCli({ autoClose: false })
    const { skillsCliService } = await import('./skillsCliService')

    // Act
    const searchPromise = skillsCliService.search('react')
    await vi.advanceTimersByTimeAsync(PAST_SPAWN_TIMEOUT_MS)
    const results = await searchPromise

    // Assert — search swallows the failure into an empty list, and the child
    // was sent the kill signal by the timeout handler.
    expect(results).toEqual([])
    expect(fake.kill).toHaveBeenCalledWith('SIGTERM')
  })
})
