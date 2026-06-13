import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import { semanticVersion, type UpdateInfo } from '@/shared/types'

// Captured updater event callbacks so tests can drive status transitions
// the way the main process would emit `update:*` IPC events.
let onCheckingCallback: (() => void) | null = null
let onAvailableCallback: ((info: UpdateInfo) => void) | null = null
let onNotAvailableCallback: (() => void) | null = null
let onErrorCallback: ((error: { message: string }) => void) | null = null

const mockOnChecking = vi.fn()
const mockOnAvailable = vi.fn()
const mockOnNotAvailable = vi.fn()
const mockOnError = vi.fn()
const mockCheck = vi.fn()

// Cleanup spies returned by each listener registration; asserted on unmount.
const cleanupChecking = vi.fn()
const cleanupAvailable = vi.fn()
const cleanupNotAvailable = vi.fn()
const cleanupError = vi.fn()

/**
 * Stub `window.electron.update` with a working updater bridge that records
 * each subscribed callback and hands back a cleanup spy.
 */
function stubUpdaterAvailable(): void {
  mockOnChecking.mockImplementation((callback: () => void) => {
    onCheckingCallback = callback
    return cleanupChecking
  })
  mockOnAvailable.mockImplementation((callback: (info: UpdateInfo) => void) => {
    onAvailableCallback = callback
    return cleanupAvailable
  })
  mockOnNotAvailable.mockImplementation((callback: () => void) => {
    onNotAvailableCallback = callback
    return cleanupNotAvailable
  })
  mockOnError.mockImplementation(
    (callback: (error: { message: string }) => void) => {
      onErrorCallback = callback
      return cleanupError
    },
  )
  vi.stubGlobal('electron', {
    update: {
      onChecking: mockOnChecking,
      onAvailable: mockOnAvailable,
      onNotAvailable: mockOnNotAvailable,
      onError: mockOnError,
      check: mockCheck,
    },
  })
}

beforeEach(() => {
  onCheckingCallback = null
  onAvailableCallback = null
  onNotAvailableCallback = null
  onErrorCallback = null
  mockOnChecking.mockReset()
  mockOnAvailable.mockReset()
  mockOnNotAvailable.mockReset()
  mockOnError.mockReset()
  mockCheck.mockReset()
  mockCheck.mockResolvedValue(undefined)
  cleanupChecking.mockReset()
  cleanupAvailable.mockReset()
  cleanupNotAvailable.mockReset()
  cleanupError.mockReset()
  vi.stubGlobal('__APP_VERSION__', '0.21.1')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Settings → About', () => {
  it('shows the running app version and the external project links', async () => {
    // Arrange
    stubUpdaterAvailable()
    const { About } = await import('./About')

    // Act
    const screen = await render(<About />)

    // Assert
    await expect.element(screen.getByText('Version 0.21.1')).toBeVisible()
    await expect
      .element(screen.getByRole('link', { name: /GitHub repository/i }))
      .toHaveAttribute('href', 'https://github.com/laststance/skills-desktop')
    await expect
      .element(screen.getByRole('link', { name: /Releases/i }))
      .toHaveAttribute(
        'href',
        'https://github.com/laststance/skills-desktop/releases',
      )
    await expect
      .element(screen.getByRole('link', { name: /License \(MIT\)/i }))
      .toHaveAttribute('href', 'https://opensource.org/licenses/MIT')
  })

  it('starts with an enabled check button and no status line', async () => {
    // Arrange
    stubUpdaterAvailable()
    const { About } = await import('./About')

    // Act
    const screen = await render(<About />)

    // Assert
    await expect
      .element(screen.getByRole('button', { name: /Check for Updates/i }))
      .toBeEnabled()
    expect(screen.container.querySelector('[role="status"]')).toBeNull()
  })

  it('reports checking progress when the user clicks Check for Updates', async () => {
    // Arrange
    stubUpdaterAvailable()
    const { About } = await import('./About')
    const screen = await render(<About />)

    // Act
    await screen.getByRole('button', { name: /Check for Updates/i }).click()

    // Assert
    await expect.poll(() => mockCheck.mock.calls.length).toBe(1)
    await expect
      .element(screen.getByText('Checking for updates…'))
      .toBeVisible()
    await expect
      .element(screen.getByRole('button', { name: /Check for Updates/i }))
      .toBeDisabled()
  })

  it('confirms the app is up to date when no update is available', async () => {
    // Arrange
    stubUpdaterAvailable()
    const { About } = await import('./About')
    const screen = await render(<About />)
    await expect.poll(() => onNotAvailableCallback).not.toBeNull()

    // Act
    onNotAvailableCallback?.()

    // Assert
    await expect
      .element(screen.getByText('Skills Desktop is up to date.'))
      .toBeVisible()
  })

  it('announces the available version and points the user to the main window', async () => {
    // Arrange
    stubUpdaterAvailable()
    const { About } = await import('./About')
    const screen = await render(<About />)
    await expect.poll(() => onAvailableCallback).not.toBeNull()

    // Act
    onAvailableCallback?.({ version: semanticVersion('9.9.9') })

    // Assert
    await expect
      .element(
        screen.getByText('Update available: v9.9.9. See the main window.'),
      )
      .toBeVisible()
  })

  it('surfaces the failure reason when the update check errors out', async () => {
    // Arrange
    stubUpdaterAvailable()
    const { About } = await import('./About')
    const screen = await render(<About />)
    await expect.poll(() => onErrorCallback).not.toBeNull()

    // Act
    onErrorCallback?.({ message: 'network unreachable' })

    // Assert
    await expect
      .element(screen.getByText('Update check failed: network unreachable'))
      .toBeVisible()
  })

  it('shows the checking label when the main process emits a checking event', async () => {
    // Arrange
    stubUpdaterAvailable()
    const { About } = await import('./About')
    const screen = await render(<About />)
    await expect.poll(() => onCheckingCallback).not.toBeNull()

    // Act
    onCheckingCallback?.()

    // Assert
    await expect
      .element(screen.getByText('Checking for updates…'))
      .toBeVisible()
  })

  it('unsubscribes from every updater event when the pane unmounts', async () => {
    // Arrange
    stubUpdaterAvailable()
    const { About } = await import('./About')
    const screen = await render(<About />)
    await expect.poll(() => onCheckingCallback).not.toBeNull()

    // Act
    await screen.unmount()

    // Assert
    expect(cleanupChecking).toHaveBeenCalledTimes(1)
    expect(cleanupAvailable).toHaveBeenCalledTimes(1)
    expect(cleanupNotAvailable).toHaveBeenCalledTimes(1)
    expect(cleanupError).toHaveBeenCalledTimes(1)
  })

  it('disables update checks and explains why in development builds', async () => {
    // Arrange — no `update` bridge, mimicking a dev build without auto-update.
    vi.stubGlobal('electron', {})
    const { About } = await import('./About')

    // Act
    const screen = await render(<About />)

    // Assert
    await expect
      .element(screen.getByRole('button', { name: /Check for Updates/i }))
      .toBeDisabled()
    await expect
      .element(
        screen.getByText('Auto-updates are disabled in development builds.'),
      )
      .toBeVisible()
    expect(mockCheck).not.toHaveBeenCalled()
  })
})
