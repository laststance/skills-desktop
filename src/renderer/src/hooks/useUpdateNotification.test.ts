import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  DownloadProgress,
  UpdateErrorPayload,
  UpdateInfo,
} from '@/shared/types'
import { semanticVersion } from '@/shared/types'

// The hook drives Redux through `useAppDispatch`; capturing dispatch lets us
// assert the exact action emitted for each forwarded auto-update IPC event.
const dispatchSpy = vi.fn()
vi.mock('@/renderer/src/redux/hooks', () => ({
  useAppDispatch: () => dispatchSpy,
}))

// React's `useEffect` does not run on its own outside a renderer. We mock it to
// run the effect body synchronously and stash the returned cleanup so tests can
// exercise both the subscribe path and the unmount/cleanup path in the node lane.
let lastEffectCleanup: (() => void) | void
vi.mock('react', () => ({
  useEffect: (effect: () => (() => void) | void) => {
    lastEffectCleanup = effect()
  },
}))

/**
 * Build a fully-stubbed `window.electron.update` surface whose event listeners
 * record the callback the hook registers and return a per-listener cleanup spy.
 * @returns the stub plus references to every registered callback and cleanup spy
 */
function createUpdateApiStub() {
  const checkingCleanup = vi.fn()
  const availableCleanup = vi.fn()
  const notAvailableCleanup = vi.fn()
  const progressCleanup = vi.fn()
  const downloadedCleanup = vi.fn()
  const errorCleanup = vi.fn()

  const registered: {
    checking?: () => void
    available?: (info: UpdateInfo) => void
    notAvailable?: () => void
    progress?: (progress: DownloadProgress) => void
    downloaded?: (info: UpdateInfo) => void
    error?: (error: UpdateErrorPayload) => void
  } = {}

  const download = vi.fn().mockResolvedValue(undefined)
  const install = vi.fn().mockResolvedValue(undefined)

  const update = {
    onChecking: (callback: () => void) => {
      registered.checking = callback
      return checkingCleanup
    },
    onAvailable: (callback: (info: UpdateInfo) => void) => {
      registered.available = callback
      return availableCleanup
    },
    onNotAvailable: (callback: () => void) => {
      registered.notAvailable = callback
      return notAvailableCleanup
    },
    onProgress: (callback: (progress: DownloadProgress) => void) => {
      registered.progress = callback
      return progressCleanup
    },
    onDownloaded: (callback: (info: UpdateInfo) => void) => {
      registered.downloaded = callback
      return downloadedCleanup
    },
    onError: (callback: (error: UpdateErrorPayload) => void) => {
      registered.error = callback
      return errorCleanup
    },
    download,
    install,
    check: vi.fn().mockResolvedValue(undefined),
  }

  return {
    update,
    registered,
    cleanups: {
      checkingCleanup,
      availableCleanup,
      notAvailableCleanup,
      progressCleanup,
      downloadedCleanup,
      errorCleanup,
    },
    download,
    install,
  }
}

beforeEach(() => {
  dispatchSpy.mockReset()
  lastEffectCleanup = undefined
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useUpdateNotification', () => {
  it('does nothing when the auto-updater IPC surface is absent outside production', async () => {
    // Arrange
    vi.stubGlobal('window', { electron: undefined })
    const { useUpdateNotification } = await import('./useUpdateNotification')

    // Act
    useUpdateNotification()

    // Assert
    expect(dispatchSpy).not.toHaveBeenCalled()
    expect(lastEffectCleanup).toBeUndefined()
  })

  it('marks the update flow as checking when the checking IPC event arrives', async () => {
    // Arrange
    const apiStub = createUpdateApiStub()
    vi.stubGlobal('window', { electron: { update: apiStub.update } })
    const { useUpdateNotification } = await import('./useUpdateNotification')

    // Act
    useUpdateNotification()
    apiStub.registered.checking?.()

    // Assert
    expect(dispatchSpy).toHaveBeenCalledWith({
      type: 'update/setChecking',
      payload: undefined,
    })
  })

  it('records the available version and release notes when an update is found', async () => {
    // Arrange
    const apiStub = createUpdateApiStub()
    vi.stubGlobal('window', { electron: { update: apiStub.update } })
    const availableInfo: UpdateInfo = {
      version: semanticVersion('0.22.0'),
      releaseNotes: 'Marketplace search added',
    }
    const { useUpdateNotification } = await import('./useUpdateNotification')

    // Act
    useUpdateNotification()
    apiStub.registered.available?.(availableInfo)

    // Assert
    expect(dispatchSpy).toHaveBeenCalledWith({
      type: 'update/setAvailable',
      payload: { version: '0.22.0', releaseNotes: 'Marketplace search added' },
    })
  })

  it('returns to idle when the checker reports no update is available', async () => {
    // Arrange
    const apiStub = createUpdateApiStub()
    vi.stubGlobal('window', { electron: { update: apiStub.update } })
    const { useUpdateNotification } = await import('./useUpdateNotification')

    // Act
    useUpdateNotification()
    apiStub.registered.notAvailable?.()

    // Assert
    expect(dispatchSpy).toHaveBeenCalledWith({
      type: 'update/setNotAvailable',
      payload: undefined,
    })
  })

  it('streams download progress into the update slice while downloading', async () => {
    // Arrange
    const apiStub = createUpdateApiStub()
    vi.stubGlobal('window', { electron: { update: apiStub.update } })
    const progress: DownloadProgress = {
      percent: 45.2,
      bytesPerSecond: 524288,
      total: 10485760,
      transferred: 4739174,
    }
    const { useUpdateNotification } = await import('./useUpdateNotification')

    // Act
    useUpdateNotification()
    apiStub.registered.progress?.(progress)

    // Assert
    expect(dispatchSpy).toHaveBeenCalledWith({
      type: 'update/setProgress',
      payload: {
        percent: 45.2,
        bytesPerSecond: 524288,
        total: 10485760,
        transferred: 4739174,
      },
    })
  })

  it('marks the update ready to install once the download finishes', async () => {
    // Arrange
    const apiStub = createUpdateApiStub()
    vi.stubGlobal('window', { electron: { update: apiStub.update } })
    const downloadedInfo: UpdateInfo = { version: semanticVersion('0.23.0') }
    const { useUpdateNotification } = await import('./useUpdateNotification')

    // Act
    useUpdateNotification()
    apiStub.registered.downloaded?.(downloadedInfo)

    // Assert
    expect(dispatchSpy).toHaveBeenCalledWith({
      type: 'update/setReady',
      payload: { version: '0.23.0' },
    })
  })

  it('surfaces the error message when an update step fails', async () => {
    // Arrange
    const apiStub = createUpdateApiStub()
    vi.stubGlobal('window', { electron: { update: apiStub.update } })
    const errorPayload: UpdateErrorPayload = {
      message: 'Network unreachable while downloading',
    }
    const { useUpdateNotification } = await import('./useUpdateNotification')

    // Act
    useUpdateNotification()
    apiStub.registered.error?.(errorPayload)

    // Assert
    expect(dispatchSpy).toHaveBeenCalledWith({
      type: 'update/setError',
      payload: 'Network unreachable while downloading',
    })
  })

  it('tears down every IPC listener on unmount to avoid duplicate dispatches', async () => {
    // Arrange
    const apiStub = createUpdateApiStub()
    vi.stubGlobal('window', { electron: { update: apiStub.update } })
    const { useUpdateNotification } = await import('./useUpdateNotification')

    // Act
    useUpdateNotification()
    if (typeof lastEffectCleanup !== 'function') {
      throw new Error('Expected the hook effect to return a cleanup function')
    }
    lastEffectCleanup()

    // Assert
    expect(apiStub.cleanups.checkingCleanup).toHaveBeenCalledTimes(1)
    expect(apiStub.cleanups.availableCleanup).toHaveBeenCalledTimes(1)
    expect(apiStub.cleanups.notAvailableCleanup).toHaveBeenCalledTimes(1)
    expect(apiStub.cleanups.progressCleanup).toHaveBeenCalledTimes(1)
    expect(apiStub.cleanups.downloadedCleanup).toHaveBeenCalledTimes(1)
    expect(apiStub.cleanups.errorCleanup).toHaveBeenCalledTimes(1)
  })
})

describe('downloadUpdate', () => {
  it('asks the auto-updater to download when the IPC surface is present', async () => {
    // Arrange
    const apiStub = createUpdateApiStub()
    vi.stubGlobal('window', { electron: { update: apiStub.update } })
    const { downloadUpdate } = await import('./useUpdateNotification')

    // Act
    await downloadUpdate()

    // Assert
    expect(apiStub.download).toHaveBeenCalledTimes(1)
  })

  it('resolves without error when no auto-updater is wired', async () => {
    // Arrange
    vi.stubGlobal('window', { electron: undefined })
    const { downloadUpdate } = await import('./useUpdateNotification')

    // Act
    const result = await downloadUpdate()

    // Assert
    expect(result).toBeUndefined()
  })
})

describe('installUpdate', () => {
  it('installs and restarts via the auto-updater when the IPC surface is present', async () => {
    // Arrange
    const apiStub = createUpdateApiStub()
    vi.stubGlobal('window', { electron: { update: apiStub.update } })
    const { installUpdate } = await import('./useUpdateNotification')

    // Act
    await installUpdate()

    // Assert
    expect(apiStub.install).toHaveBeenCalledTimes(1)
  })

  it('resolves without error when no auto-updater is wired', async () => {
    // Arrange
    vi.stubGlobal('window', { electron: undefined })
    const { installUpdate } = await import('./useUpdateNotification')

    // Act
    const result = await installUpdate()

    // Assert
    expect(result).toBeUndefined()
  })
})
