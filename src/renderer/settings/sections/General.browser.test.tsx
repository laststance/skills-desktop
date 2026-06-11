import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import { DEFAULT_SETTINGS } from '@/shared/settings'
import type {
  CliCommandOperationResult,
  CliCommandStatus,
} from '@/shared/types'

const mockSettingsSet = vi.fn()
const mockWindowGetMainBounds = vi.fn()
const mockCliCommandGetStatus = vi.fn()
const mockCliCommandInstall = vi.fn()
const mockCliCommandRemove = vi.fn()

const commandPath = '/Users/test/.local/bin/skills-desktop'

const notInstalledStatus: CliCommandStatus = {
  status: 'not-installed',
  commandName: 'skills-desktop',
  commandPath,
  message: 'Command is not installed.',
}

const installedStatus: CliCommandStatus = {
  status: 'installed',
  commandName: 'skills-desktop',
  commandPath,
  message: 'Command is installed.',
}

const blockedStatus: CliCommandStatus = {
  status: 'blocked',
  commandName: 'skills-desktop',
  commandPath,
  message: `${commandPath} is already occupied by an unmanaged file.`,
}

beforeEach(() => {
  mockSettingsSet.mockReset()
  mockSettingsSet.mockResolvedValue(undefined)
  mockWindowGetMainBounds.mockReset()
  mockWindowGetMainBounds.mockResolvedValue({ width: 1200, height: 800 })
  mockCliCommandGetStatus.mockReset()
  mockCliCommandInstall.mockReset()
  mockCliCommandRemove.mockReset()
  vi.stubGlobal('electron', {
    settings: { set: mockSettingsSet },
    window: { getMainBounds: mockWindowGetMainBounds },
    cliCommand: {
      getStatus: mockCliCommandGetStatus,
      install: mockCliCommandInstall,
      remove: mockCliCommandRemove,
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Build a minimal Redux store for the General settings pane.
 * @returns Redux store with Settings defaults preloaded.
 * @example const store = await createStore()
 */
async function createStore(): Promise<ReturnType<typeof configureStore>> {
  const { default: settingsReducer } =
    await import('@/renderer/src/redux/slices/settingsSlice')
  return configureStore({
    reducer: {
      settings: settingsReducer,
    },
    preloadedState: {
      settings: { ...DEFAULT_SETTINGS },
    },
  })
}

/**
 * Render General with the provided CLI command status returned on mount.
 * @param status - Initial command status returned by the preload mock.
 * @returns The vitest-browser render screen.
 * @example await renderGeneral(notInstalledStatus)
 */
async function renderGeneral(status: CliCommandStatus) {
  mockCliCommandGetStatus.mockResolvedValueOnce(status)
  const store = await createStore()
  const { General } = await import('./General')
  return render(
    <Provider store={store}>
      <General />
    </Provider>,
  )
}

describe('Settings → General command line command', () => {
  it('installs the command and switches the action to removal', async () => {
    // Arrange
    const installResult: CliCommandOperationResult = {
      ok: true,
      status: installedStatus,
      message: `Command installed at ${commandPath}.`,
    }
    mockCliCommandInstall.mockResolvedValueOnce(installResult)
    const screen = await renderGeneral(notInstalledStatus)

    // Act
    const installButton = screen.getByRole('button', {
      name: /Install command/i,
    })
    await expect.element(installButton).toBeEnabled()
    await installButton.click()

    // Assert
    await expect.poll(() => mockCliCommandInstall.mock.calls.length).toBe(1)
    await expect
      .element(screen.getByRole('button', { name: /Remove command/i }))
      .toBeVisible()
    await expect
      .element(screen.getByText(`Command installed at ${commandPath}.`))
      .toBeVisible()
  })

  it('removes the command and switches the action back to installation', async () => {
    // Arrange
    const removeResult: CliCommandOperationResult = {
      ok: true,
      status: notInstalledStatus,
      message: 'Command removed.',
    }
    mockCliCommandRemove.mockResolvedValueOnce(removeResult)
    const screen = await renderGeneral(installedStatus)

    // Act
    const removeButton = screen.getByRole('button', {
      name: /Remove command/i,
    })
    await expect.element(removeButton).toBeEnabled()
    await removeButton.click()

    // Assert
    await expect.poll(() => mockCliCommandRemove.mock.calls.length).toBe(1)
    await expect
      .element(screen.getByRole('button', { name: /Install command/i }))
      .toBeVisible()
    await expect.element(screen.getByText('Command removed.')).toBeVisible()
  })

  it('disables mutation when another file already occupies the command path', async () => {
    // Arrange
    const screen = await renderGeneral(blockedStatus)

    // Act
    const installButton = screen.getByRole('button', {
      name: /Install command/i,
    })

    // Assert
    await expect.element(installButton).toBeDisabled()
    await expect.element(screen.getByText(blockedStatus.message)).toBeVisible()
    expect(mockCliCommandInstall).not.toHaveBeenCalled()
    expect(mockCliCommandRemove).not.toHaveBeenCalled()
  })
})
