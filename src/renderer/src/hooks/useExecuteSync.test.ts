import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { executeSyncAction } from '@/renderer/src/redux/slices/uiSlice'
import type { SyncExecuteOptions } from '@/shared/types'

// `useExecuteSync` is a thin wrapper around React's `useState` / `useRef`, the
// typed redux dispatch, and the sonner toast. The node lane has no React
// renderer, so we mock the three hook primitives with persistent stand-ins that
// behave exactly like a single mounted component instance would: `useRef`
// returns one stable box, `useState` keeps its last value across `run` calls.
// This lets us drive the real `run` logic (re-entrancy guard, rejected-match,
// toast, finally cleanup) directly.

const toastErrorMock = vi.fn()
vi.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}))

// One persistent ref box per test, mirroring a stable `useRef` across renders.
let refBox: { current: boolean }
// Captured `useState` setter + the latest value it was given.
let latestIsExecutingState: boolean
const setIsExecutingMock = vi.fn((next: boolean) => {
  latestIsExecutingState = next
})

vi.mock('react', () => ({
  useRef: () => refBox,
  useState: () => [latestIsExecutingState, setIsExecutingMock],
}))

// Controllable dispatch injected via the typed redux hook.
const dispatchMock = vi.fn()
vi.mock('@/renderer/src/redux/hooks', () => ({
  useAppDispatch: () => dispatchMock,
}))

beforeEach(() => {
  refBox = { current: false }
  latestIsExecutingState = false
  setIsExecutingMock.mockClear()
  toastErrorMock.mockClear()
  dispatchMock.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

const sampleOptions: SyncExecuteOptions = { replaceConflicts: [] }

describe('useExecuteSync', () => {
  it('reports success and skips the failure toast when the sync thunk fulfills', async () => {
    // Arrange
    dispatchMock.mockResolvedValue({
      type: executeSyncAction.fulfilled.type,
      payload: { synced: 1 },
    })
    const { useExecuteSync } = await import('./useExecuteSync')
    const { run } = useExecuteSync('Sync failed')

    // Act
    const succeeded = await run(sampleOptions)

    // Assert
    expect(succeeded).toBe(true)
    expect(dispatchMock).toHaveBeenCalledTimes(1)
    expect(toastErrorMock).not.toHaveBeenCalled()
  })

  it('raises a failure toast with the rejection message and reports failure when the thunk rejects', async () => {
    // Arrange
    dispatchMock.mockResolvedValue({
      type: executeSyncAction.rejected.type,
      error: { message: 'Disk is full' },
    })
    const { useExecuteSync } = await import('./useExecuteSync')
    const { run } = useExecuteSync('Cleanup failed')

    // Act
    const succeeded = await run(sampleOptions)

    // Assert
    expect(succeeded).toBe(false)
    expect(toastErrorMock).toHaveBeenCalledTimes(1)
    expect(toastErrorMock).toHaveBeenCalledWith('Cleanup failed', {
      description: 'Disk is full',
    })
  })

  it('falls back to the generic description when the rejection carries no message', async () => {
    // Arrange
    dispatchMock.mockResolvedValue({
      type: executeSyncAction.rejected.type,
      error: { message: '' },
    })
    const { useExecuteSync } = await import('./useExecuteSync')
    const { run } = useExecuteSync('Sync failed')

    // Act
    const succeeded = await run(sampleOptions)

    // Assert
    expect(succeeded).toBe(false)
    expect(toastErrorMock).toHaveBeenCalledWith('Sync failed', {
      description: 'Unexpected error',
    })
  })

  it('ignores a re-entrant run that arrives while a previous run is still in flight', async () => {
    // Arrange — a dispatch we resolve manually so the first run stays in flight.
    let resolveFirstDispatch: (action: unknown) => void = () => {}
    const inFlightDispatch = new Promise((resolve) => {
      resolveFirstDispatch = resolve
    })
    dispatchMock.mockReturnValueOnce(inFlightDispatch)
    const { useExecuteSync } = await import('./useExecuteSync')
    const { run } = useExecuteSync('Sync failed')

    // Act — start the first run (do NOT await), then fire a second run.
    const firstRunPromise = run(sampleOptions)
    const secondRunResult = await run(sampleOptions)

    // Assert — the second call is short-circuited before dispatching again.
    expect(secondRunResult).toBe(false)
    expect(dispatchMock).toHaveBeenCalledTimes(1)

    // Let the first run settle so no promise dangles.
    resolveFirstDispatch({
      type: executeSyncAction.fulfilled.type,
      payload: { synced: 0 },
    })
    const firstRunResult = await firstRunPromise
    expect(firstRunResult).toBe(true)
  })

  it('toggles the executing ref and state up at start and back down once the thunk settles', async () => {
    // Arrange
    dispatchMock.mockResolvedValue({
      type: executeSyncAction.fulfilled.type,
      payload: { synced: 2 },
    })
    const { useExecuteSync } = await import('./useExecuteSync')
    const { run } = useExecuteSync('Sync failed')

    // Act
    await run(sampleOptions)

    // Assert — the finally block must release both guards.
    expect(refBox.current).toBe(false)
    expect(setIsExecutingMock).toHaveBeenNthCalledWith(1, true)
    expect(setIsExecutingMock).toHaveBeenNthCalledWith(2, false)
  })

  it('releases both guards even when the dispatch throws unexpectedly', async () => {
    // Arrange
    dispatchMock.mockRejectedValue(new Error('thunk exploded'))
    const { useExecuteSync } = await import('./useExecuteSync')
    const { run } = useExecuteSync('Sync failed')

    // Act + Assert — the throw propagates but finally still resets the guards.
    await expect(run(sampleOptions)).rejects.toThrow('thunk exploded')
    expect(refBox.current).toBe(false)
    expect(setIsExecutingMock).toHaveBeenNthCalledWith(2, false)
  })
})
