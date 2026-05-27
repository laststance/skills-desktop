import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Mutable stand-in for the electron-updater singleton. `applyUpdaterPreferences`
 * writes the config values onto it; the tests read them back. `autoInstallOnAppQuit`
 * starts `true` to mirror electron-updater's real default so the consent-pin
 * assertion below is meaningful.
 */
const mockAutoUpdater = vi.hoisted(() => ({
  autoDownload: false,
  autoInstallOnAppQuit: true,
}))

vi.mock('electron-updater', () => ({
  autoUpdater: mockAutoUpdater,
}))

// updater.ts transitively imports `electron` via typedSend (BrowserWindow)
// and the settings service (app). Neither is touched by the unit under test,
// so a minimal surface keeps the import graph from throwing at load time.
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp') },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}))

import { applyUpdaterPreferences } from './updater'

describe('applyUpdaterPreferences', () => {
  beforeEach(() => {
    mockAutoUpdater.autoDownload = false
    mockAutoUpdater.autoInstallOnAppQuit = true
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('enables background downloads on the updater when the user opts in', () => {
    // Arrange + Act
    applyUpdaterPreferences({ autoDownloadUpdates: true })

    // Assert
    expect(mockAutoUpdater.autoDownload).toBe(true)
  })

  it('restores manual downloads when the user turns the toggle back off', () => {
    // Arrange — simulate a prior opt-in that the user then turned back off.
    mockAutoUpdater.autoDownload = true

    // Act
    applyUpdaterPreferences({ autoDownloadUpdates: false })

    // Assert
    expect(mockAutoUpdater.autoDownload).toBe(false)
  })

  it('pins autoInstallOnAppQuit to false so a downloaded update never installs without UI consent', () => {
    // Arrange — electron-updater defaults this to true, which would silently
    // install a downloaded update on the next quit, bypassing the
    // confirm-via-UI install flow.

    // Act
    applyUpdaterPreferences({ autoDownloadUpdates: true })

    // Assert
    expect(mockAutoUpdater.autoInstallOnAppQuit).toBe(false)
  })
})
