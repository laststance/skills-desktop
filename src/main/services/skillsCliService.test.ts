import { EventEmitter } from 'events'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SKILLS_CLI_VERSION } from '@/shared/constants'

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
    const first = simulateCli({ autoClose: false })
    const second = simulateCli({ autoClose: false })

    const { skillsCliService } = await import('./skillsCliService')
    const searchA = skillsCliService.search('a')
    const searchB = skillsCliService.search('b')

    skillsCliService.cancel()

    expect(first.kill).toHaveBeenCalledWith('SIGTERM')
    expect(second.kill).toHaveBeenCalledWith('SIGTERM')

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
    simulateCli({
      stdout:
        'vercel-labs/skills@find-skills\n└ https://skills.sh/vercel-labs/skills/find-skills\n',
    })

    const { skillsCliService } = await import('./skillsCliService')
    await skillsCliService.search('find-skills')

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

  it('parses current skills find output with install counts', async () => {
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
    const results = await skillsCliService.search('react')

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

  it('parses legacy skills find output without install counts', async () => {
    simulateCli({
      stdout: [
        'vercel-labs/agent-skills@vercel-react-best-practices',
        '└ https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices',
      ].join('\n'),
    })

    const { skillsCliService } = await import('./skillsCliService')
    const results = await skillsCliService.search('react')

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
})
