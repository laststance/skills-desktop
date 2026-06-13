import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import { DEFAULT_SETTINGS, type Settings } from '@/shared/settings'
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
 * @param overrides - Settings fields to merge over `DEFAULT_SETTINGS`.
 * @returns Redux store with Settings defaults (plus overrides) preloaded.
 * @example const store = await createStore({ preferredTerminal: 'custom' })
 */
async function createStore(
  overrides?: Partial<Settings>,
): Promise<ReturnType<typeof configureStore>> {
  const { default: settingsReducer } =
    await import('@/renderer/src/redux/slices/settingsSlice')
  return configureStore({
    reducer: {
      settings: settingsReducer,
    },
    preloadedState: {
      settings: { ...DEFAULT_SETTINGS, ...overrides },
    },
  })
}

/**
 * Render General with the current `mockCliCommandGetStatus` behavior left
 * untouched — callers control whether the mount probe resolves or rejects.
 * @param overrides - Settings fields to merge over `DEFAULT_SETTINGS`.
 * @returns The vitest-browser render screen.
 * @example await renderGeneralRaw({ windowSize: { width: 1000, height: 700 } })
 */
async function renderGeneralRaw(overrides?: Partial<Settings>) {
  const store = await createStore(overrides)
  const { General } = await import('./General')
  return render(
    <Provider store={store}>
      <General />
    </Provider>,
  )
}

/**
 * Render General with the provided CLI command status returned on mount.
 * @param status - Initial command status returned by the preload mock.
 * @param overrides - Settings fields to merge over `DEFAULT_SETTINGS`.
 * @returns The vitest-browser render screen.
 * @example await renderGeneral(notInstalledStatus)
 */
async function renderGeneral(
  status: CliCommandStatus,
  overrides?: Partial<Settings>,
) {
  mockCliCommandGetStatus.mockResolvedValueOnce(status)
  return renderGeneralRaw(overrides)
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

  it('shows a fallback message when the command status probe fails on open', async () => {
    // Arrange
    mockCliCommandGetStatus.mockRejectedValueOnce(new Error('ipc down'))

    // Act
    const screen = await renderGeneralRaw()

    // Assert
    await expect
      .element(screen.getByText('Could not read command status.'))
      .toBeVisible()
  })

  it('surfaces an install failure message when installing the command throws', async () => {
    // Arrange
    mockCliCommandInstall.mockRejectedValueOnce(new Error('write denied'))
    const screen = await renderGeneral(notInstalledStatus)

    // Act
    const installButton = screen.getByRole('button', {
      name: /Install command/i,
    })
    await expect.element(installButton).toBeEnabled()
    await installButton.click()

    // Assert
    await expect
      .element(screen.getByText('Could not install command.'))
      .toBeVisible()
  })

  it('surfaces a removal failure message when removing the command throws', async () => {
    // Arrange
    mockCliCommandRemove.mockRejectedValueOnce(new Error('unlink denied'))
    const screen = await renderGeneral(installedStatus)

    // Act
    const removeButton = screen.getByRole('button', {
      name: /Remove command/i,
    })
    await expect.element(removeButton).toBeEnabled()
    await removeButton.click()

    // Assert
    await expect
      .element(screen.getByText('Could not remove command.'))
      .toBeVisible()
  })
})

describe('Settings → General default skill tab', () => {
  it('persists the chosen default tab when a different tab is selected', async () => {
    // Arrange
    const screen = await renderGeneral(notInstalledStatus)

    // Act
    const infoToggle = screen.getByRole('radio', { name: 'Info' })
    await infoToggle.click()

    // Assert
    await expect
      .poll(() => mockSettingsSet.mock.calls.length)
      .toBeGreaterThanOrEqual(1)
    expect(mockSettingsSet).toHaveBeenLastCalledWith({
      defaultSkillTab: 'info',
    })
  })
})

describe('Settings → General preferred terminal', () => {
  it('persists the selected terminal when a different option is chosen', async () => {
    // Arrange
    const screen = await renderGeneral(notInstalledStatus)

    // Act
    const select = screen.getByRole('combobox', { name: 'Preferred terminal' })
    await select.selectOptions('iTerm')

    // Assert
    await expect
      .poll(() => mockSettingsSet.mock.calls.length)
      .toBeGreaterThanOrEqual(1)
    expect(mockSettingsSet).toHaveBeenLastCalledWith({
      preferredTerminal: 'iterm',
    })
  })
})

describe('Settings → General custom terminal app name', () => {
  it('commits the trimmed custom app name when focus leaves the field', async () => {
    // Arrange
    const screen = await renderGeneral(notInstalledStatus, {
      preferredTerminal: 'custom',
    })

    // Act
    const customInput = screen.getByRole('textbox', {
      name: 'Custom terminal app name',
    })
    await customInput.fill('Hyper')
    // Move focus to another control so the input's onBlur commit fires.
    const note = screen.getByLabelText('Current saved startup window size')
    await note.click()

    // Assert
    await expect
      .poll(() => mockSettingsSet.mock.calls.length)
      .toBeGreaterThanOrEqual(1)
    expect(mockSettingsSet).toHaveBeenLastCalledWith({
      customTerminalAppName: 'Hyper',
    })
  })
})

describe('Settings → General startup window size', () => {
  it('saves the live main-window bounds when "Use current window size" is clicked', async () => {
    // Arrange
    mockWindowGetMainBounds.mockReset()
    mockWindowGetMainBounds.mockResolvedValue({ width: 1200, height: 800 })
    const screen = await renderGeneral(notInstalledStatus)

    // Act
    const saveButton = screen.getByRole('button', {
      name: 'Use current window size',
    })
    await expect.element(saveButton).toBeEnabled()
    await saveButton.click()

    // Assert
    await expect
      .poll(() => mockSettingsSet.mock.calls.length)
      .toBeGreaterThanOrEqual(1)
    expect(mockSettingsSet).toHaveBeenLastCalledWith({
      windowSize: { width: 1200, height: 800 },
    })
  })

  it('disables capture and explains why when the main window is already closed at save time', async () => {
    // Arrange
    // First call (mount probe) keeps the button enabled; the click-time
    // call resolves to null because the main window has since closed.
    mockWindowGetMainBounds.mockReset()
    mockWindowGetMainBounds
      .mockResolvedValueOnce({ width: 1200, height: 800 })
      .mockResolvedValueOnce(null)
    const screen = await renderGeneral(notInstalledStatus)

    // Act
    const saveButton = screen.getByRole('button', {
      name: 'Use current window size',
    })
    await expect.element(saveButton).toBeEnabled()
    await saveButton.click()

    // Assert
    await expect
      .element(
        screen.getByText(
          /Main window is closed — open it again, then reopen Settings/i,
        ),
      )
      .toBeVisible()
    expect(mockSettingsSet).not.toHaveBeenCalled()
  })

  it('disables capture and explains why when reading bounds throws at save time', async () => {
    // Arrange
    mockWindowGetMainBounds.mockReset()
    mockWindowGetMainBounds
      .mockResolvedValueOnce({ width: 1200, height: 800 })
      .mockRejectedValueOnce(new Error('ipc disconnected'))
    const screen = await renderGeneral(notInstalledStatus)

    // Act
    const saveButton = screen.getByRole('button', {
      name: 'Use current window size',
    })
    await expect.element(saveButton).toBeEnabled()
    await saveButton.click()

    // Assert
    await expect
      .element(
        screen.getByText(
          /Main window is closed — open it again, then reopen Settings/i,
        ),
      )
      .toBeVisible()
    expect(mockSettingsSet).not.toHaveBeenCalled()
  })

  it('disables capture and explains why when the main window is absent at open', async () => {
    // Arrange
    mockWindowGetMainBounds.mockReset()
    mockWindowGetMainBounds.mockRejectedValueOnce(new Error('no main window'))

    // Act
    const screen = await renderGeneral(notInstalledStatus)

    // Assert
    await expect
      .element(
        screen.getByText(
          /Main window is closed — open it again, then reopen Settings/i,
        ),
      )
      .toBeVisible()
    const saveButton = screen.getByRole('button', {
      name: 'Use current window size',
    })
    await expect.element(saveButton).toBeDisabled()
  })

  it('clears the persisted size when "Reset to default" is clicked', async () => {
    // Arrange
    const screen = await renderGeneral(notInstalledStatus, {
      windowSize: { width: 1000, height: 700 },
    })

    // Act
    const resetButton = screen.getByRole('button', {
      name: 'Reset to default',
    })
    await expect.element(resetButton).toBeEnabled()
    await resetButton.click()

    // Assert
    await expect
      .poll(() => mockSettingsSet.mock.calls.length)
      .toBeGreaterThanOrEqual(1)
    expect(mockSettingsSet).toHaveBeenLastCalledWith({ windowSize: undefined })
  })
})
