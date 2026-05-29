import { EventEmitter } from 'node:events'
import type * as NodeFsPromises from 'node:fs/promises'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const handleMock = vi.fn()
const realpathMock = vi.fn()
const spawnMock = vi.fn()
const openPathMock = vi.fn()
const getSettingsMock = vi.fn()

/**
 * Mock surfaces:
 *  - electron.ipcMain → captures every typedHandle registration so tests can
 *    invoke handlers directly via getRegisteredHandler('folder:openInTerminal').
 *  - electron.shell.openPath → controls the success/error path for Reveal.
 *  - node:fs/promises.realpath → controls the not-found / found branch.
 *  - node:child_process.spawn → returns a fake EventEmitter so tests can fire
 *    `exit` / `error` events synchronously and assert how the handler reacts.
 *  - main/services/settings.getSettings → drives the preferredTerminal /
 *    customTerminalAppName branch coverage.
 */
vi.mock('electron', () => ({
  ipcMain: {
    handle: (...args: unknown[]) => handleMock(...args),
  },
  shell: {
    openPath: (...args: unknown[]) => openPathMock(...args),
  },
}))

vi.mock('node:fs/promises', async () => {
  const actual =
    await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
  return {
    ...actual,
    realpath: (...args: unknown[]) => realpathMock(...args),
  }
})

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}))

vi.mock('../services/settings', () => ({
  getSettings: () => getSettingsMock(),
}))

/**
 * Look up a registered IPC handler captured by the ipcMain mock.
 * Mirrors the helper in `skills.copyToAgents.integration.test.ts`.
 */
function getRegisteredHandler(
  channel: string,
): (event: unknown, ...args: unknown[]) => Promise<unknown> {
  const registration = handleMock.mock.calls.find(([name]) => name === channel)
  if (!registration) throw new Error(`No handler registered for ${channel}`)
  return registration[1] as (
    event: unknown,
    ...args: unknown[]
  ) => Promise<unknown>
}

/**
 * Build a fake child process that we can drive via `.emit('exit', code)` /
 * `.emit('error', err)`. Carries an `unref` spy so we can assert the handler
 * detaches the child from the main process.
 *
 * The fake child also captures all `once` registrations so the emit helper
 * below can buffer events fired before listeners are wired — needed because
 * `spawn` is called *after* `await realpath()` in the handler, so the test
 * cannot synchronously emit and expect a listener to be present yet.
 */
function makeFakeChild(): EventEmitter & { unref: () => void } {
  const ee = new EventEmitter() as EventEmitter & { unref: () => void }
  ee.unref = vi.fn()
  return ee
}

/**
 * Configure spawnMock to return a fake child AND auto-fire the requested
 * event after listeners are registered. Handles the listener-registration
 * race that makes synchronous `child.emit(...)` after `handler(...)` flaky.
 *
 * @param event - 'exit' or 'error'
 * @param payload - exit code (number) or Error
 * @returns The fake child instance the spawn mock will hand to the handler.
 */
function spawnFiringEvent(
  event: 'exit' | 'error',
  payload: number | Error,
): EventEmitter & { unref: () => void } {
  const child = makeFakeChild()
  spawnMock.mockReturnValueOnce(child)
  // setImmediate runs after the current microtask queue drains — by which
  // time the handler has resumed past every `await` and registered both
  // `child.once('exit')` and `child.once('error')`.
  setImmediate(() => child.emit(event, payload))
  return child
}

describe('folder IPC handlers (integration)', () => {
  beforeEach(async () => {
    vi.resetModules()
    handleMock.mockReset()
    realpathMock.mockReset()
    spawnMock.mockReset()
    openPathMock.mockReset()
    getSettingsMock.mockReset()
    // Default: the most common happy-path settings.
    getSettingsMock.mockReturnValue({
      defaultSkillTab: 'files',
      preferredTerminal: 'terminal',
    })
    // Re-import after resetModules so the mocks above take effect.
    const { registerFolderHandlers } = await import('./folder')
    registerFolderHandlers()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('folder:revealInFinder', () => {
    it('reveals an existing folder in Finder', async () => {
      // Arrange
      realpathMock.mockResolvedValue('/Users/me/.agents/skills')
      openPathMock.mockResolvedValue('')
      const handler = getRegisteredHandler('folder:revealInFinder')

      // Act
      const result = await handler({}, '/Users/me/.agents/skills')

      // Assert
      expect(result).toEqual({ ok: true })
    })

    it('tells the user the folder is gone instead of revealing it when the path no longer exists', async () => {
      // Arrange
      const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      realpathMock.mockRejectedValue(err)
      const handler = getRegisteredHandler('folder:revealInFinder')

      // Act
      const result = await handler({}, '/missing/path')

      // Assert
      expect(result).toEqual({
        ok: false,
        reason: 'not-found',
        message: 'Folder not found: /missing/path',
      })
      expect(openPathMock).not.toHaveBeenCalled()
    })

    it('treats a symlink cycle (ELOOP) as a missing folder rather than reveal it', async () => {
      // Arrange
      const err = Object.assign(new Error('ELOOP'), { code: 'ELOOP' })
      realpathMock.mockRejectedValue(err)
      const handler = getRegisteredHandler('folder:revealInFinder')

      // Act
      const result = await handler({}, '/cycle')

      // Assert
      expect(result).toMatchObject({ ok: false, reason: 'not-found' })
    })

    it('treats a file-in-the-path (ENOTDIR) as a missing folder rather than reveal it', async () => {
      // Arrange
      const err = Object.assign(new Error('ENOTDIR'), { code: 'ENOTDIR' })
      realpathMock.mockRejectedValue(err)
      const handler = getRegisteredHandler('folder:revealInFinder')

      // Act
      const result = await handler({}, '/file/inside')

      // Assert
      expect(result).toMatchObject({ ok: false, reason: 'not-found' })
      expect(openPathMock).not.toHaveBeenCalled()
    })

    it('surfaces an unexpected filesystem error (e.g. EPERM) to the IPC boundary instead of swallowing it', async () => {
      // Arrange
      const err = Object.assign(new Error('EPERM'), { code: 'EPERM' })
      realpathMock.mockRejectedValue(err)
      const handler = getRegisteredHandler('folder:revealInFinder')

      // Act / Assert
      await expect(handler({}, '/locked')).rejects.toThrow('EPERM')
      expect(openPathMock).not.toHaveBeenCalled()
    })

    it('reports a launch failure when Finder cannot open the folder', async () => {
      // Arrange
      realpathMock.mockResolvedValue('/x')
      openPathMock.mockResolvedValue('Permission denied')
      const handler = getRegisteredHandler('folder:revealInFinder')

      // Act
      const result = await handler({}, '/x')

      // Assert
      expect(result).toMatchObject({
        ok: false,
        reason: 'launch-failed',
      })
      expect(result).toHaveProperty(
        'message',
        expect.stringContaining('Permission denied'),
      )
    })
  })

  describe('folder:openInTerminal', () => {
    it('opens the folder in Terminal and detaches the launched process', async () => {
      // Arrange
      realpathMock.mockResolvedValue('/x')
      const child = spawnFiringEvent('exit', 0)
      const handler = getRegisteredHandler('folder:openInTerminal')

      // Act
      const result = await handler({}, '/x')

      // Assert
      expect(result).toEqual({ ok: true })
      expect(child.unref).toHaveBeenCalled()
      expect(spawnMock).toHaveBeenCalledWith('open', ['-a', 'Terminal', '/x'], {
        stdio: 'ignore',
      })
    })

    it('reports a missing folder without reading settings or spawning a terminal', async () => {
      // Arrange
      const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      realpathMock.mockRejectedValue(err)
      const handler = getRegisteredHandler('folder:openInTerminal')

      // Act
      const result = await handler({}, '/gone')

      // Assert
      expect(result).toMatchObject({ ok: false, reason: 'not-found' })
      expect(getSettingsMock).not.toHaveBeenCalled()
      expect(spawnMock).not.toHaveBeenCalled()
    })

    it('treats a file-in-the-path (ENOTDIR) as missing and never spawns a terminal', async () => {
      // Arrange
      const err = Object.assign(new Error('ENOTDIR'), { code: 'ENOTDIR' })
      realpathMock.mockRejectedValue(err)
      const handler = getRegisteredHandler('folder:openInTerminal')

      // Act
      const result = await handler({}, '/file/inside')

      // Assert
      expect(result).toMatchObject({ ok: false, reason: 'not-found' })
      expect(getSettingsMock).not.toHaveBeenCalled()
      expect(spawnMock).not.toHaveBeenCalled()
    })

    it('refuses to launch when a custom terminal is selected but no app name is configured', async () => {
      // Arrange
      realpathMock.mockResolvedValue('/x')
      getSettingsMock.mockReturnValue({
        defaultSkillTab: 'files',
        preferredTerminal: 'custom',
      })
      const handler = getRegisteredHandler('folder:openInTerminal')

      // Act
      const result = await handler({}, '/x')

      // Assert
      expect(result).toMatchObject({
        ok: false,
        reason: 'invalid-path',
      })
      expect(spawnMock).not.toHaveBeenCalled()
    })

    it('reports a launch failure when the terminal app is not installed (spawn exits non-zero)', async () => {
      // Arrange
      realpathMock.mockResolvedValue('/x')
      spawnFiringEvent('exit', 1)
      const handler = getRegisteredHandler('folder:openInTerminal')

      // Act
      const result = await handler({}, '/x')

      // Assert
      expect(result).toMatchObject({
        ok: false,
        reason: 'launch-failed',
      })
    })

    it('reports a launch failure with the underlying error message when spawn errors', async () => {
      // Arrange
      realpathMock.mockResolvedValue('/x')
      spawnFiringEvent('error', new Error('spawn ENOENT'))
      const handler = getRegisteredHandler('folder:openInTerminal')

      // Act
      const result = await handler({}, '/x')

      // Assert
      expect(result).toMatchObject({
        ok: false,
        reason: 'launch-failed',
      })
      expect(result).toHaveProperty(
        'message',
        expect.stringContaining('spawn ENOENT'),
      )
    })

    it('honors a terminal preference changed in Settings without an app restart', async () => {
      // Arrange
      realpathMock.mockResolvedValue('/x')
      const handler = getRegisteredHandler('folder:openInTerminal')

      // Act / Assert — first click launches the default Terminal.
      spawnFiringEvent('exit', 0)
      await handler({}, '/x')
      expect(spawnMock).toHaveBeenLastCalledWith(
        'open',
        ['-a', 'Terminal', '/x'],
        { stdio: 'ignore' },
      )

      // Act / Assert — user switched Settings to iTerm; next click uses iTerm.
      getSettingsMock.mockReturnValue({
        defaultSkillTab: 'files',
        preferredTerminal: 'iterm',
      })
      spawnFiringEvent('exit', 0)
      await handler({}, '/x')
      expect(spawnMock).toHaveBeenLastCalledWith(
        'open',
        ['-a', 'iTerm', '/x'],
        { stdio: 'ignore' },
      )
    })
  })
})
