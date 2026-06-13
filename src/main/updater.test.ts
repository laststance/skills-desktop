import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Mutable stand-in for the electron-updater singleton. `applyUpdaterPreferences`
 * and `initAutoUpdaterForE2E` write config values onto it; the tests read them
 * back. `autoInstallOnAppQuit` starts `true` to mirror electron-updater's real
 * default so the consent-pin assertion is meaningful. `checkForUpdates` resolves
 * because `initAutoUpdaterForE2E` chains `.catch()` onto its result.
 *
 * `on` records each registered lifecycle handler by event name into
 * `registeredHandlers` so tests can fire a handler (e.g. simulate
 * `update-available`) and assert the resulting IPC broadcast.
 */
const registeredHandlers = vi.hoisted(
  () => new Map<string, (...args: unknown[]) => void>(),
)

const mockAutoUpdater = vi.hoisted(() => ({
  autoDownload: false,
  autoInstallOnAppQuit: true,
  forceDevUpdateConfig: false,
  currentVersion: '1.0.0',
  on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
    registeredHandlers.set(event, handler)
  }),
  setFeedURL: vi.fn(),
  checkForUpdates: vi.fn().mockResolvedValue(undefined),
  downloadUpdate: vi.fn(),
  quitAndInstall: vi.fn(),
}))

vi.mock('electron-updater', () => ({
  autoUpdater: mockAutoUpdater,
}))

// Persisted user preference read by initAutoUpdater. Hoisted so the electron
// mock factory can reference it; tests overwrite the return value per case.
const mockGetSettings = vi.hoisted(() =>
  vi.fn(() => ({ autoDownloadUpdates: false })),
)

vi.mock('./services/settings', () => ({
  getSettings: mockGetSettings,
}))

/**
 * Fake renderer target. `broadcastTypedEvent` iterates `getAllWindows()` and
 * calls `webContents.send(channel, payload)` on each live window; tests read
 * `sentMessages` back to assert the exact channel + payload a handler emitted.
 */
const sentMessages = vi.hoisted(
  () => [] as Array<{ channel: string; payload: unknown }>,
)

const mockGetAllWindows = vi.hoisted(() =>
  vi.fn(() => [
    {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        send: (channel: string, payload: unknown) => {
          sentMessages.push({ channel, payload })
        },
      },
    },
  ]),
)

// updater.ts transitively imports `electron` via typedSend (BrowserWindow)
// and the settings service (app). The BrowserWindow surface is now a real
// fake so broadcast assertions can observe the forwarded IPC message.
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp') },
  BrowserWindow: { getAllWindows: mockGetAllWindows },
}))

import {
  applyUpdaterPreferences,
  checkForUpdates,
  downloadUpdate,
  initAutoUpdater,
  initAutoUpdaterForE2E,
  installUpdate,
} from './updater'

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

  it('rejects a non-loopback feed URL so the offline seam can never hit a real network host', () => {
    // Arrange — a public https host that must be refused before any wiring.
    const publicFeedUrl = 'https://example.com'

    // Act + Assert
    expect(() => initAutoUpdaterForE2E({ feedUrl: publicFeedUrl })).toThrow(
      'E2E update feed must use a loopback http URL: https://example.com',
    )
    // The guard runs first, so the feed is never wired in on rejection.
    expect(mockAutoUpdater.setFeedURL).not.toHaveBeenCalled()
  })

  it('logs an E2E-tagged error when the immediate check rejects so a failed feed surfaces in the harness logs', async () => {
    // Arrange — the localhost feed fetch fails (e.g. server not yet up).
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {})
    const feedFetchError = new Error('connection refused')
    mockAutoUpdater.checkForUpdates.mockRejectedValueOnce(feedFetchError)

    // Act
    initAutoUpdaterForE2E({ feedUrl: 'http://127.0.0.1:54321' })
    // Let the rejected checkForUpdates promise settle so .catch runs.
    await Promise.resolve()
    await Promise.resolve()

    // Assert
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to check for updates (E2E):',
      feedFetchError,
    )

    consoleErrorSpy.mockRestore()
  })
})

describe('updater lifecycle events forwarded to the renderer', () => {
  // Silence the informational console output the handlers emit so the test
  // run stays clean; restored after each case.
  let consoleLogSpy: ReturnType<typeof vi.spyOn>
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    sentMessages.length = 0
    registeredHandlers.clear()
    mockAutoUpdater.on.mockClear()
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    // Registers every lifecycle handler onto the updater (and thus into
    // registeredHandlers) without a boot delay.
    initAutoUpdaterForE2E({ feedUrl: 'http://127.0.0.1:54321' })
  })

  afterEach(() => {
    consoleLogSpy.mockRestore()
    consoleErrorSpy.mockRestore()
    vi.clearAllMocks()
  })

  it('broadcasts the checking state when the updater starts a check', () => {
    // Arrange — fire the registered checking-for-update handler.
    const checkingHandler = registeredHandlers.get('checking-for-update')

    // Act
    checkingHandler?.()

    // Assert
    expect(sentMessages).toContainEqual({
      channel: 'update:checking',
      payload: undefined,
    })
  })

  it('broadcasts the new version and its release notes when an update is available', () => {
    // Arrange
    const availableHandler = registeredHandlers.get('update-available')

    // Act
    availableHandler?.({ version: '2.3.0', releaseNotes: 'Bug fixes' })

    // Assert
    expect(sentMessages).toContainEqual({
      channel: 'update:available',
      payload: { version: '2.3.0', releaseNotes: 'Bug fixes' },
    })
  })

  it('omits release notes when the feed provides them as structured HTML blocks instead of a string', () => {
    // Arrange — electron-updater can hand back an array of release-note
    // objects; the UI only renders plain-string notes, so non-strings drop.
    const availableHandler = registeredHandlers.get('update-available')

    // Act
    availableHandler?.({
      version: '2.4.0',
      releaseNotes: [{ version: '2.4.0', note: '<p>HTML</p>' }],
    })

    // Assert
    expect(sentMessages).toContainEqual({
      channel: 'update:available',
      payload: { version: '2.4.0', releaseNotes: undefined },
    })
  })

  it('broadcasts the not-available state when the installed version is already current', () => {
    // Arrange
    const notAvailableHandler = registeredHandlers.get('update-not-available')

    // Act
    notAvailableHandler?.()

    // Assert
    expect(sentMessages).toContainEqual({
      channel: 'update:not-available',
      payload: undefined,
    })
  })

  it('broadcasts the failure message when the updater errors so the UI can surface it', () => {
    // Arrange
    const errorHandler = registeredHandlers.get('error')

    // Act
    errorHandler?.(new Error('network down'))

    // Assert
    expect(sentMessages).toContainEqual({
      channel: 'update:error',
      payload: { message: 'network down' },
    })
  })

  it('broadcasts live transfer stats while the update downloads so the UI shows progress', () => {
    // Arrange
    const progressHandler = registeredHandlers.get('download-progress')

    // Act
    progressHandler?.({
      percent: 42.5,
      bytesPerSecond: 1024,
      total: 5000,
      transferred: 2125,
    })

    // Assert
    expect(sentMessages).toContainEqual({
      channel: 'update:progress',
      payload: {
        percent: 42.5,
        bytesPerSecond: 1024,
        total: 5000,
        transferred: 2125,
      },
    })
  })

  it('broadcasts the downloaded version so the UI can offer the install action', () => {
    // Arrange
    const downloadedHandler = registeredHandlers.get('update-downloaded')

    // Act
    downloadedHandler?.({ version: '2.3.0', releaseNotes: 'Bug fixes' })

    // Assert
    expect(sentMessages).toContainEqual({
      channel: 'update:downloaded',
      payload: { version: '2.3.0', releaseNotes: 'Bug fixes' },
    })
  })

  it('omits release notes from the downloaded broadcast when the feed provides them as structured HTML blocks instead of a string', () => {
    // Arrange — electron-updater can hand back an array of release-note objects
    // on the downloaded event too; the UI only renders plain-string notes, so
    // non-strings drop to undefined before the install prompt is shown.
    const downloadedHandler = registeredHandlers.get('update-downloaded')

    // Act
    downloadedHandler?.({
      version: '2.4.0',
      releaseNotes: [{ version: '2.4.0', note: '<p>HTML</p>' }],
    })

    // Assert
    expect(sentMessages).toContainEqual({
      channel: 'update:downloaded',
      payload: { version: '2.4.0', releaseNotes: undefined },
    })
  })
})

describe('initAutoUpdater (boot-time check)', () => {
  beforeEach(() => {
    sentMessages.length = 0
    registeredHandlers.clear()
    mockAutoUpdater.autoDownload = false
    mockAutoUpdater.autoInstallOnAppQuit = true
    mockAutoUpdater.on.mockClear()
    mockAutoUpdater.checkForUpdates.mockClear()
    mockGetSettings.mockReturnValue({ autoDownloadUpdates: false })
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('seeds the updater from the persisted auto-download preference at startup', () => {
    // Arrange — the user previously opted into background downloads.
    mockGetSettings.mockReturnValue({ autoDownloadUpdates: true })

    // Act
    initAutoUpdater()

    // Assert
    expect(mockAutoUpdater.autoDownload).toBe(true)
  })

  it('registers the lifecycle handlers at startup so events reach the renderer', () => {
    // Arrange + Act
    initAutoUpdater()

    // Assert
    expect(registeredHandlers.has('update-available')).toBe(true)
  })

  it('defers the first update check by the boot delay so the renderer can subscribe first', () => {
    // Arrange
    initAutoUpdater()

    // Assert — nothing fired yet, only after the delay elapses.
    expect(mockAutoUpdater.checkForUpdates).not.toHaveBeenCalled()

    // Act — advance past the 3s boot delay.
    vi.advanceTimersByTime(3000)

    // Assert
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('logs an error when the delayed boot-time check rejects instead of crashing the main process', async () => {
    // Arrange
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {})
    const checkError = new Error('boot check failed')
    mockAutoUpdater.checkForUpdates.mockRejectedValueOnce(checkError)
    initAutoUpdater()

    // Act — run the boot-delay timer, then let the rejected promise settle.
    vi.advanceTimersByTime(3000)
    await vi.runAllTimersAsync()

    // Assert
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to check for updates:',
      checkError,
    )

    consoleErrorSpy.mockRestore()
  })
})

describe('renderer-triggered update IPC actions', () => {
  beforeEach(() => {
    mockAutoUpdater.downloadUpdate.mockClear()
    mockAutoUpdater.quitAndInstall.mockClear()
    mockAutoUpdater.checkForUpdates.mockClear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('starts the download when the renderer requests it', () => {
    // Arrange + Act
    downloadUpdate()

    // Assert
    expect(mockAutoUpdater.downloadUpdate).toHaveBeenCalledTimes(1)
  })

  it('quits and installs when the renderer confirms the install', () => {
    // Arrange + Act
    installUpdate()

    // Assert
    expect(mockAutoUpdater.quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('runs a manual update check when the renderer requests one', async () => {
    // Arrange + Act
    await checkForUpdates()

    // Assert
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
  })
})
