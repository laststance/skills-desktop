import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { InstallProgress } from '@/shared/types'

// The hook drives Redux through `useAppDispatch`; capturing dispatch lets us
// assert the exact action emitted for each forwarded install-progress IPC event.
const dispatchSpy = vi.fn()
vi.mock('@/renderer/src/redux/hooks', () => ({
  useAppDispatch: () => dispatchSpy,
}))

// Keep `setInstallProgress` as an identity-tagged action creator so we can
// assert the hook dispatches the EXACT payload it received from IPC, not just
// "something".
vi.mock('@/renderer/src/redux/slices/marketplaceSlice', () => ({
  setInstallProgress: (payload: InstallProgress) => ({
    type: 'marketplace/setInstallProgress',
    payload,
  }),
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

let onProgressMock: ReturnType<typeof vi.fn>
let cleanupMock: ReturnType<typeof vi.fn>
let registeredCallback: ((progress: InstallProgress) => void) | null

beforeEach(() => {
  dispatchSpy.mockReset()
  lastEffectCleanup = undefined
  cleanupMock = vi.fn()
  registeredCallback = null

  // Capture the progress listener the hook registers and hand back the cleanup
  // spy so the unmount test can assert the subscription is torn down.
  onProgressMock = vi.fn((callback: (progress: InstallProgress) => void) => {
    registeredCallback = callback
    return cleanupMock
  })

  vi.stubGlobal('window', {
    electron: {
      skillsCli: {
        onProgress: onProgressMock,
      },
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useMarketplaceProgress', () => {
  it('subscribes to install-progress IPC events on mount', async () => {
    // Arrange
    const { useMarketplaceProgress } = await import('./useMarketplaceProgress')

    // Act
    useMarketplaceProgress()

    // Assert — exactly one live subscription is registered
    expect(onProgressMock).toHaveBeenCalledTimes(1)
    expect(typeof registeredCallback).toBe('function')
  })

  it('streams a forwarded install-progress event into the marketplace slice', async () => {
    // Arrange
    const { useMarketplaceProgress } = await import('./useMarketplaceProgress')
    const progress: InstallProgress = {
      phase: 'cloning',
      message: 'Cloning skill repository…',
      percent: 42,
    }

    // Act — mount registers the listener, then a progress event arrives
    useMarketplaceProgress()
    registeredCallback?.(progress)

    // Assert — the IPC payload flows straight into the slice
    expect(dispatchSpy).toHaveBeenCalledTimes(1)
    expect(dispatchSpy).toHaveBeenCalledWith({
      type: 'marketplace/setInstallProgress',
      payload: {
        phase: 'cloning',
        message: 'Cloning skill repository…',
        percent: 42,
      },
    })
  })

  it('forwards every progress event so the UI tracks each pipeline stage', async () => {
    // Arrange
    const { useMarketplaceProgress } = await import('./useMarketplaceProgress')
    const cloning: InstallProgress = {
      phase: 'cloning',
      message: 'Cloning…',
    }
    const complete: InstallProgress = {
      phase: 'complete',
      message: 'Installed',
      percent: 100,
    }

    // Act — two sequential progress events arrive over the same subscription
    useMarketplaceProgress()
    registeredCallback?.(cloning)
    registeredCallback?.(complete)

    // Assert — both stages dispatch in order
    expect(dispatchSpy).toHaveBeenCalledTimes(2)
    expect(dispatchSpy).toHaveBeenNthCalledWith(1, {
      type: 'marketplace/setInstallProgress',
      payload: { phase: 'cloning', message: 'Cloning…' },
    })
    expect(dispatchSpy).toHaveBeenNthCalledWith(2, {
      type: 'marketplace/setInstallProgress',
      payload: { phase: 'complete', message: 'Installed', percent: 100 },
    })
  })

  it('tears down the progress subscription when the component unmounts', async () => {
    // Arrange
    const { useMarketplaceProgress } = await import('./useMarketplaceProgress')

    // Act — mount registers the subscription, then unmount runs the cleanup
    useMarketplaceProgress()
    if (typeof lastEffectCleanup !== 'function') {
      throw new Error('Expected the hook effect to return a cleanup function')
    }
    lastEffectCleanup()

    // Assert — cleanup runs the unsubscribe returned by onProgress
    expect(cleanupMock).toHaveBeenCalledTimes(1)
  })
})
