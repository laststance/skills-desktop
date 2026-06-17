/**
 * Node-lane tests for `useActivitySync` — the hook that wires the renderer's
 * Redux activity slice to the main-process activity-log store over IPC.
 *
 * Structurally a mirror of `useSettingsSync`, with one extra gate: the whole
 * subscribe/hydrate body is skipped unless `ENABLE_DASHBOARD_EXPERIMENTAL` is
 * on. The flag-OFF early return is already exercised by the real `App.tsx`
 * mount (flag ships false); these tests force the flag ON so the enabled data
 * path — `activity:list` hydration, `activity:changed` subscription, and the
 * unmount cleanup — runs for real under happy-dom.
 *
 * @vitest-environment happy-dom
 */

// The flag ships false, so without this override the hook returns early and the
// IPC body never runs. Forcing it on is what exercises the enabled contract.
vi.mock('@/shared/featureFlags', () => ({
  FEATURE_FLAGS: { ENABLE_DASHBOARD_EXPERIMENTAL: true },
}))

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ActivityLog } from '@/shared/activityLog'

// The hook reads dispatch via the typed `useAppDispatch` wrapper. Mocking it to
// return a spy lets us assert the dispatched action shape without standing up a
// real Provider — and keeps the test pinned to the hook's IPC behavior.
const dispatchSpy = vi.fn()
vi.mock('@/renderer/src/redux/hooks', () => ({
  useAppDispatch: () => dispatchSpy,
}))

// Keep `setActivityEvents` as an identity-tagged action creator so we can assert
// the hook dispatches the EXACT payload it received from IPC, not just "something".
vi.mock('@/renderer/src/redux/slices/activitySlice', () => ({
  setActivityEvents: (payload: ActivityLog) => ({
    type: 'activity/setActivityEvents',
    payload,
  }),
}))

import { useActivitySync } from './useActivitySync'

/** Deferred promise handle so a test can resolve `activity.list()` on demand. */
interface Deferred<Value> {
  promise: Promise<Value>
  resolve: (value: Value) => void
}

/**
 * Builds a promise whose resolution a test controls, for driving the
 * mount-before-resolve race in the late-write test.
 * @returns A `{ promise, resolve }` pair.
 * @example
 * const d = createDeferred<ActivityLog>(); d.resolve([])
 */
function createDeferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

const SNAPSHOT_EVENTS: ActivityLog = [
  {
    id: 'e1',
    timestamp: '2026-06-18T10:00:00.000Z',
    type: 'created',
    skillName: 'alpha-skill',
    agentName: 'Claude Code',
  },
]

const BROADCAST_EVENTS: ActivityLog = [
  {
    id: 's1',
    timestamp: '2026-06-18T11:00:00.000Z',
    type: 'synced',
    skillName: 'Sync',
    detail: '3 created · 0 replaced · 1 skipped',
  },
  ...SNAPSHOT_EVENTS,
]

let listMock: ReturnType<typeof vi.fn>
let onChangedMock: ReturnType<typeof vi.fn>
let unsubscribeMock: ReturnType<typeof vi.fn>
let onChangedCallback: ((events: ActivityLog) => void) | null

beforeEach(() => {
  dispatchSpy.mockReset()
  unsubscribeMock = vi.fn()
  onChangedCallback = null

  // `list()` resolves immediately with a one-event snapshot by default; tests
  // that need to control timing override it with a deferred.
  listMock = vi.fn().mockResolvedValue(SNAPSHOT_EVENTS)

  // Capture the registered listener so a test can drive an `activity:changed`
  // broadcast, and hand back the unsubscribe spy for the cleanup assertion.
  onChangedMock = vi.fn((callback: (events: ActivityLog) => void) => {
    onChangedCallback = callback
    return unsubscribeMock
  })

  vi.stubGlobal('window', {
    electron: {
      activity: {
        list: listMock,
        onChanged: onChangedMock,
      },
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Mount `useActivitySync` on a fresh React root and return an `unmount` that
 * tears the root down (running the hook's cleanup) inside `act`.
 * @returns An object whose `unmount()` unmounts the root inside `act`.
 */
async function mountHook(): Promise<{ unmount: () => Promise<void> }> {
  const container = document.createElement('div')
  const root = createRoot(container)

  function HookHarness(): null {
    useActivitySync()
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

describe('useActivitySync', () => {
  it('hydrates the activity slice from the persisted snapshot on mount', async () => {
    // Arrange — `list()` resolves with the snapshot (set in beforeEach)

    // Act
    await mountHook()

    // Assert — the resolved snapshot is dispatched into the slice
    expect(listMock).toHaveBeenCalledTimes(1)
    expect(dispatchSpy).toHaveBeenCalledWith({
      type: 'activity/setActivityEvents',
      payload: SNAPSHOT_EVENTS,
    })
  })

  it('subscribes to cross-process activity changes on mount', async () => {
    // Arrange — beforeEach wires onChanged to capture the listener

    // Act
    await mountHook()

    // Assert — exactly one live subscription is registered
    expect(onChangedMock).toHaveBeenCalledTimes(1)
    expect(typeof onChangedCallback).toBe('function')
  })

  it('propagates an activity-log change from the main process into the slice', async () => {
    // Arrange — mount so the onChanged listener is registered
    await mountHook()
    dispatchSpy.mockClear()

    // Act — simulate an `activity:changed` broadcast from the main process
    await act(async () => {
      onChangedCallback?.(BROADCAST_EVENTS)
    })

    // Assert — the broadcast payload flows straight into the slice
    expect(dispatchSpy).toHaveBeenCalledTimes(1)
    expect(dispatchSpy).toHaveBeenCalledWith({
      type: 'activity/setActivityEvents',
      payload: BROADCAST_EVENTS,
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
    // Arrange — make `list()` hang so we can unmount before it resolves
    const deferred = createDeferred<ActivityLog>()
    listMock.mockReturnValue(deferred.promise)

    // Act — unmount first, THEN resolve the in-flight snapshot
    const { unmount } = await mountHook()
    await unmount()
    await act(async () => {
      deferred.resolve(SNAPSHOT_EVENTS)
      await deferred.promise
    })

    // Assert — the cancelled guard drops the late write entirely
    expect(dispatchSpy).not.toHaveBeenCalledWith({
      type: 'activity/setActivityEvents',
      payload: SNAPSHOT_EVENTS,
    })
  })
})
