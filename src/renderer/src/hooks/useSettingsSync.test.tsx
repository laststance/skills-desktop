/**
 * Node-lane tests for `useSettingsSync` — the hook that wires the renderer's
 * Redux settings slice to the main-process JSON store over IPC.
 *
 * The hook touches `window.electron.settings.{get,onChanged}` and dispatches
 * `setSettings`. We render it through a real React root under happy-dom so the
 * mount → effect → cleanup lifecycle runs for real, and assert on the spied
 * dispatch + the IPC subscription/unsubscribe contract.
 *
 * @vitest-environment happy-dom
 */

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_SETTINGS, type Settings } from '@/shared/settings'

// The hook reads dispatch via the typed `useAppDispatch` wrapper. Mocking it to
// return a spy lets us assert the dispatched action shape without standing up a
// real Provider — and keeps the test pinned to the hook's IPC behavior.
const dispatchSpy = vi.fn()
vi.mock('@/renderer/src/redux/hooks', () => ({
  useAppDispatch: () => dispatchSpy,
}))

// Keep `setSettings` as an identity-tagged action creator so we can assert the
// hook dispatches the EXACT payload it received from IPC, not just "something".
vi.mock('@/renderer/src/redux/slices/settingsSlice', () => ({
  setSettings: (payload: Settings) => ({
    type: 'settings/setSettings',
    payload,
  }),
}))

import { useSettingsSync } from './useSettingsSync'

/** Deferred promise handle so a test can resolve `settings.get()` on demand. */
interface Deferred<Value> {
  promise: Promise<Value>
  resolve: (value: Value) => void
}

function createDeferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

let getMock: ReturnType<typeof vi.fn>
let onChangedMock: ReturnType<typeof vi.fn>
let unsubscribeMock: ReturnType<typeof vi.fn>
let onChangedCallback: ((settings: Settings) => void) | null

beforeEach(() => {
  dispatchSpy.mockReset()
  unsubscribeMock = vi.fn()
  onChangedCallback = null

  // `get()` resolves immediately with the default snapshot by default; tests
  // that need to control timing override it with a deferred.
  getMock = vi.fn().mockResolvedValue(DEFAULT_SETTINGS)

  // Capture the registered listener so a test can drive a `settings:changed`
  // broadcast, and hand back the unsubscribe spy for the cleanup assertion.
  onChangedMock = vi.fn((callback: (settings: Settings) => void) => {
    onChangedCallback = callback
    return unsubscribeMock
  })

  vi.stubGlobal('window', {
    electron: {
      settings: {
        get: getMock,
        onChanged: onChangedMock,
      },
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Mount `useSettingsSync` on a fresh React root and return an `unmount` that
 * tears the root down (running the hook's cleanup) inside `act`.
 */
async function mountHook(): Promise<{ unmount: () => Promise<void> }> {
  const container = document.createElement('div')
  const root = createRoot(container)

  function HookHarness(): null {
    useSettingsSync()
    return null
  }

  await act(async () => {
    root.render(<HookHarness />)
  })

  return {
    unmount: async () => {
      await act(async () => {
        root.unmount()
      })
    },
  }
}

describe('useSettingsSync', () => {
  it('hydrates the settings slice from the persisted snapshot on mount', async () => {
    // Arrange — `get()` resolves with the default snapshot (set in beforeEach)

    // Act
    await mountHook()

    // Assert — the resolved snapshot is dispatched into the slice
    expect(getMock).toHaveBeenCalledTimes(1)
    expect(dispatchSpy).toHaveBeenCalledWith({
      type: 'settings/setSettings',
      payload: DEFAULT_SETTINGS,
    })
  })

  it('subscribes to cross-window settings changes on mount', async () => {
    // Arrange — beforeEach wires onChanged to capture the listener

    // Act
    await mountHook()

    // Assert — exactly one live subscription is registered
    expect(onChangedMock).toHaveBeenCalledTimes(1)
    expect(typeof onChangedCallback).toBe('function')
  })

  it('propagates a settings save from another window into the slice', async () => {
    // Arrange — mount so the onChanged listener is registered
    await mountHook()
    dispatchSpy.mockClear()
    const changedSettings: Settings = {
      ...DEFAULT_SETTINGS,
      defaultSkillTab: 'info',
      autoDownloadUpdates: true,
    }

    // Act — simulate a `settings:changed` broadcast from the Settings window
    await act(async () => {
      onChangedCallback?.(changedSettings)
    })

    // Assert — the broadcast payload flows straight into the slice
    expect(dispatchSpy).toHaveBeenCalledTimes(1)
    expect(dispatchSpy).toHaveBeenCalledWith({
      type: 'settings/setSettings',
      payload: changedSettings,
    })
  })

  it('tears down the change subscription when the component unmounts', async () => {
    // Arrange — mount registers the subscription
    const { unmount } = await mountHook()

    // Act
    await unmount()

    // Assert — cleanup runs the unsubscribe returned by onChanged
    expect(unsubscribeMock).toHaveBeenCalledTimes(1)
  })

  it('skips the late hydration dispatch when the component unmounts before the snapshot resolves', async () => {
    // Arrange — make `get()` hang so we can unmount before it resolves
    const deferred = createDeferred<Settings>()
    getMock.mockReturnValue(deferred.promise)
    const lateSettings: Settings = {
      ...DEFAULT_SETTINGS,
      defaultSkillTab: 'info',
      autoDownloadUpdates: true,
    }

    // Act — unmount first, THEN resolve the in-flight snapshot
    const { unmount } = await mountHook()
    await unmount()
    await act(async () => {
      deferred.resolve(lateSettings)
      await deferred.promise
    })

    // Assert — the cancelled guard drops the late write entirely
    expect(dispatchSpy).not.toHaveBeenCalledWith({
      type: 'settings/setSettings',
      payload: lateSettings,
    })
  })
})
