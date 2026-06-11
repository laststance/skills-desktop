import { describe, it, expect, vi, beforeEach } from 'vitest'

const handleMock = vi.fn()
const getCliCommandStatusMock = vi.fn()
const installCliCommandMock = vi.fn()
const removeCliCommandMock = vi.fn()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (...args: unknown[]) => handleMock(...args),
  },
}))

vi.mock('../services/cliCommandService', () => ({
  getCliCommandStatus: () => getCliCommandStatusMock(),
  installCliCommand: () => installCliCommandMock(),
  removeCliCommand: () => removeCliCommandMock(),
}))

/**
 * Find a registered IPC handler by channel name so tests can invoke it directly.
 * @param channel - IPC channel name captured from ipcMain.handle.
 * @returns The registered handler function.
 * @example getRegisteredHandler('cliCommand:getStatus')
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

describe('cliCommand IPC handlers', () => {
  beforeEach(async () => {
    vi.resetModules()
    handleMock.mockReset()
    getCliCommandStatusMock.mockReset()
    installCliCommandMock.mockReset()
    removeCliCommandMock.mockReset()
    const { registerCliCommandHandlers } = await import('./cliCommand')
    registerCliCommandHandlers()
  })

  it('returns command status through the no-arg status channel', async () => {
    // Arrange
    const expectedStatus = {
      status: 'not-installed',
      commandName: 'skills-desktop',
      commandPath: '/Users/test/.local/bin/skills-desktop',
      message: 'Command is not installed.',
    }
    getCliCommandStatusMock.mockResolvedValue(expectedStatus)
    const handler = getRegisteredHandler('cliCommand:getStatus')

    // Act
    const result = await handler({})

    // Assert
    expect(result).toEqual(expectedStatus)
    expect(getCliCommandStatusMock).toHaveBeenCalledTimes(1)
  })

  it('installs the command through the no-arg install channel', async () => {
    // Arrange
    const expectedResult = {
      ok: true,
      status: {
        status: 'installed',
        commandName: 'skills-desktop',
        commandPath: '/Users/test/.local/bin/skills-desktop',
        message: 'Command is installed.',
      },
      message: 'Command installed.',
    }
    installCliCommandMock.mockResolvedValue(expectedResult)
    const handler = getRegisteredHandler('cliCommand:install')

    // Act
    const result = await handler({})

    // Assert
    expect(result).toEqual(expectedResult)
    expect(installCliCommandMock).toHaveBeenCalledTimes(1)
  })

  it('removes the command through the no-arg remove channel', async () => {
    // Arrange
    const expectedResult = {
      ok: true,
      status: {
        status: 'not-installed',
        commandName: 'skills-desktop',
        commandPath: '/Users/test/.local/bin/skills-desktop',
        message: 'Command is not installed.',
      },
      message: 'Command removed.',
    }
    removeCliCommandMock.mockResolvedValue(expectedResult)
    const handler = getRegisteredHandler('cliCommand:remove')

    // Act
    const result = await handler({})

    // Assert
    expect(result).toEqual(expectedResult)
    expect(removeCliCommandMock).toHaveBeenCalledTimes(1)
  })
})
