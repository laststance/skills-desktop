import { EventEmitter } from 'events'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CLI_REMOVE_BUSY_CODE,
  CLI_REMOVE_TIMEOUT_CODE,
  type SkillName,
} from '../../shared/types'

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
  spawnMock: vi.fn<() => FakeChildProcess>(),
}))

vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...(args as [])),
}))

// Pin homedir so sanitizeCliMessage's regex matches deterministically —
// the service caches homedir() at module load, so mocking must happen before
// importing the service under test.
const FAKE_HOME = '/Users/testuser'
vi.mock('os', async () => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await vi.importActual<typeof import('os')>('os')
  return {
    ...actual,
    homedir: () => FAKE_HOME,
  }
})

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

describe('skillsCliService.remove', () => {
  beforeEach(() => {
    vi.useRealTimers()
    vi.resetModules()
    spawnMock.mockReset()
  })

  it('returns outcome:"removed" on exit code 0', async () => {
    simulateCli({ exitCode: 0 })

    const { skillsCliService } = await import('./skillsCliService')
    const result = await skillsCliService.remove('brainstorming' as SkillName)

    expect(result).toEqual({
      skillName: 'brainstorming',
      outcome: 'removed',
    })
  })

  it('returns sanitized stderr as the error message on non-zero exit', async () => {
    // stderr contains the user's home directory — must be stripped before
    // crossing the IPC boundary. The message stays actionable (the skill
    // name + the ENOENT) just without the user-identifying prefix.
    simulateCli({
      stderr: `ENOENT: /Users/testuser/.agents/skills/missing not found\n`,
      exitCode: 1,
    })

    const { skillsCliService } = await import('./skillsCliService')
    const result = await skillsCliService.remove('missing' as SkillName)

    if (result.outcome !== 'error') {
      throw new Error('Expected error outcome')
    }
    expect(result.error.message).toBe(
      'ENOENT: ~/.agents/skills/missing not found',
    )
    expect(result.error.code).toBe(1)
  })

  it('strips ANSI escape sequences from the error message', async () => {
    // Some CLI tools emit ANSI even with FORCE_COLOR=0 (e.g. in pipes or when
    // respecting user TTY state). sanitize must drop them so toasts stay
    // readable in non-terminal contexts.
    simulateCli({
      stderr: '\x1B[31mFailed to remove brainstorming\x1B[0m',
      exitCode: 1,
    })

    const { skillsCliService } = await import('./skillsCliService')
    const result = await skillsCliService.remove('brainstorming' as SkillName)

    if (result.outcome !== 'error') {
      throw new Error('Expected error outcome')
    }
    expect(result.error.message).toBe('Failed to remove brainstorming')
  })

  it('falls back to stdout when stderr is empty on failure', async () => {
    simulateCli({
      stdout: 'Skill not found in lock file',
      stderr: '',
      exitCode: 1,
    })

    const { skillsCliService } = await import('./skillsCliService')
    const result = await skillsCliService.remove('ghost' as SkillName)

    if (result.outcome !== 'error') {
      throw new Error('Expected error outcome')
    }
    expect(result.error.message).toBe('Skill not found in lock file')
  })

  it('falls back to a default message when both streams are empty', async () => {
    simulateCli({ stdout: '', stderr: '', exitCode: 1 })

    const { skillsCliService } = await import('./skillsCliService')
    const result = await skillsCliService.remove('x' as SkillName)

    if (result.outcome !== 'error') {
      throw new Error('Expected error outcome')
    }
    expect(result.error.message).toBe('CLI remove failed')
  })

  it('returns a timeout error code when a CLI child exceeds SPAWN_TIMEOUT_MS', async () => {
    vi.useFakeTimers()
    const fake = simulateCli({ autoClose: false })

    const { skillsCliService } = await import('./skillsCliService')
    const promise = skillsCliService.remove('brainstorming' as SkillName)

    await vi.advanceTimersByTimeAsync(60_000)
    const result = await promise

    if (result.outcome !== 'error') {
      throw new Error('Expected error outcome')
    }
    expect(result.error.code).toBe(CLI_REMOVE_TIMEOUT_CODE)
    expect(result.error.message).toBe('CLI command timed out after 60s')
    expect(fake.kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('returns a busy error when another CLI remove is already in flight', async () => {
    const first = simulateCli({ autoClose: false })

    const { skillsCliService } = await import('./skillsCliService')
    const firstPromise = skillsCliService.remove('first' as SkillName)
    const secondResult = await skillsCliService.remove('second' as SkillName)

    expect(secondResult).toEqual({
      skillName: 'second',
      outcome: 'error',
      error: {
        message: 'Another CLI operation is already in progress',
        code: CLI_REMOVE_BUSY_CODE,
      },
    })

    first.emit('close', 0)
    await firstPromise
  })

  it('invokes spawn with npx skills@<VERSION> remove <name> --global -y', async () => {
    simulateCli({ exitCode: 0 })

    const { skillsCliService } = await import('./skillsCliService')
    await skillsCliService.remove('brainstorming' as SkillName)

    expect(spawnMock).toHaveBeenCalledTimes(1)
    const [command, args] = spawnMock.mock.calls[0] as unknown as [
      string,
      string[],
      object,
    ]
    expect(command).toBe('npx')
    expect(args[0]).toMatch(/^skills@/)
    expect(args.slice(1)).toEqual(['remove', 'brainstorming', '--global', '-y'])
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
