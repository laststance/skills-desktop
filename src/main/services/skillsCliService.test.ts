import { EventEmitter } from 'events'

import { beforeEach, describe, expect, it, vi } from 'vitest'

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
