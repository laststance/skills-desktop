import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Mutable stand-in for the electron-updater singleton. `applyUpdaterPreferences`
 * and `initAutoUpdaterForE2E` write config values onto it; the tests read them
 * back. `autoInstallOnAppQuit` starts `true` to mirror electron-updater's real
 * default so the consent-pin assertion is meaningful. `checkForUpdates` resolves
 * because `initAutoUpdaterForE2E` chains `.catch()` onto its result.
 */
const mockAutoUpdater = vi.hoisted(() => ({
  autoDownload: false,
  autoInstallOnAppQuit: true,
  forceDevUpdateConfig: false,
  currentVersion: '1.0.0',
  on: vi.fn(),
  setFeedURL: vi.fn(),
  checkForUpdates: vi.fn().mockResolvedValue(undefined),
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

import { applyUpdaterPreferences, initAutoUpdaterForE2E } from './updater'

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

describe('initAutoUpdaterForE2E', () => {
  beforeEach(() => {
    // Reset every field the seam touches so state does not leak between cases.
    mockAutoUpdater.autoDownload = false
    mockAutoUpdater.forceDevUpdateConfig = false
    mockAutoUpdater.currentVersion = '1.0.0'
    mockAutoUpdater.on.mockClear()
    mockAutoUpdater.setFeedURL.mockClear()
    mockAutoUpdater.checkForUpdates.mockClear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('forces dev update config so a check can run against the unpacked e2e build', () => {
    // Arrange + Act
    initAutoUpdaterForE2E({ feedUrl: 'http://127.0.0.1:54321' })

    // Assert
    expect(mockAutoUpdater.forceDevUpdateConfig).toBe(true)
  })

  it('disables auto-download so the dummy artifact is never fetched during detection', () => {
    // Arrange + Act
    initAutoUpdaterForE2E({ feedUrl: 'http://127.0.0.1:54321' })

    // Assert
    expect(mockAutoUpdater.autoDownload).toBe(false)
  })

  it('lowers currentVersion to the passed baseline so a higher feed version compares as available', () => {
    // Arrange + Act
    initAutoUpdaterForE2E({
      feedUrl: 'http://127.0.0.1:54321',
      currentVersion: '0.0.1',
    })

    // Assert
    expect(mockAutoUpdater.currentVersion).toBe('0.0.1')
  })

  it('points the updater at the localhost generic feed', () => {
    // Arrange + Act
    initAutoUpdaterForE2E({ feedUrl: 'http://127.0.0.1:54321' })

    // Assert
    expect(mockAutoUpdater.setFeedURL).toHaveBeenCalledWith({
      provider: 'generic',
      url: 'http://127.0.0.1:54321',
    })
  })

  it('triggers an update check immediately so detection runs without the boot delay', () => {
    // Arrange + Act
    initAutoUpdaterForE2E({ feedUrl: 'http://127.0.0.1:54321' })

    // Assert
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
  })
})
