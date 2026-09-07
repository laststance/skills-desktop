import { configureStore } from '@reduxjs/toolkit'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { LOCK_RESCAN_GRACE_MS, UNDO_WINDOW_MS } from '@/shared/constants'
import type { ToastId, TombstoneId } from '@/shared/types'
import { toIsoTimestamp, tombstoneId } from '@/shared/types'

/**
 * Integration tests for the post-delete lock rescan in listener.ts.
 *
 * Deleting a skill only moves it to the trash, so its lock record is still
 * restorable and deliberately not counted as stale. Main prunes the record
 * when the tombstone is evicted, but that prune is best effort. Mount and
 * `refreshAllData` are the only other scan triggers, so if this listener stops
 * firing, a failed background prune stays invisible until the user navigates
 * away from the dashboard and back — which is the original bug.
 */
const mockScanStaleLockEntries = vi.fn()

vi.stubGlobal('window', {
  electron: { skills: { scanStaleLockEntries: mockScanStaleLockEntries } },
})

/**
 * Build a store with a freshly-evaluated listener middleware. `vi.resetModules`
 * in `beforeEach` is required so the top-level `startListening(...)` calls in
 * listener.ts re-execute against a new middleware instance.
 * @returns Store carrying the `skillLock` and `ui` branches.
 * @example const store = await createStore()
 */
async function createStore() {
  const { listenerMiddleware } = await import('./listener')
  const [{ default: skillLockReducer }, { default: uiReducer }] =
    await Promise.all([
      import('./slices/skillLockSlice'),
      import('./slices/uiSlice'),
    ])
  return configureStore({
    reducer: { skillLock: skillLockReducer, ui: uiReducer },
    middleware: (getDefault) =>
      getDefault().prepend(listenerMiddleware.middleware),
  })
}

/**
 * Undo-toast payload matching what MainContent emits after a bulk delete.
 * @param kind - `delete` tombstones to the trash; `unlink` tombstones nothing.
 * @param id - Toast id, distinct per dispatch so bursts are distinguishable.
 * @returns Payload accepted by `setUndoToast`.
 * @example undoToastPayload('delete', 'bulk-delete-1')
 */
function undoToastPayload(kind: 'delete' | 'unlink', id: string) {
  return {
    id: id as ToastId,
    kind,
    skillNames: ['old-skill'],
    tombstoneIds:
      kind === 'delete'
        ? [tombstoneId('1700000000000-old-skill-aaaaaaaa')]
        : ([] as TombstoneId[]),
    expiresAt: toIsoTimestamp(
      new Date(Date.now() + UNDO_WINDOW_MS).toISOString(),
    ),
    summary: 'Deleted 1 skill.',
  }
}

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  mockScanStaleLockEntries.mockReset()
  mockScanStaleLockEntries.mockResolvedValue({ status: 'ok', names: [] })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('skill-lock rescan after the undo window', () => {
  test('surfaces a lock record whose background prune failed, without leaving the dashboard', async () => {
    // Arrange
    const store = await createStore()
    const { setUndoToast } = await import('./slices/uiSlice')

    // Act
    mockScanStaleLockEntries.mockResolvedValue({
      status: 'ok',
      names: ['old-skill'],
    })
    store.dispatch(setUndoToast(undoToastPayload('delete', 'bulk-delete-1')))
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS + LOCK_RESCAN_GRACE_MS)

    // Assert
    expect(mockScanStaleLockEntries).toHaveBeenCalledTimes(1)
    expect(store.getState().skillLock.staleNames).toEqual(['old-skill'])
  })

  test('holds the rescan until the undo window has actually closed', async () => {
    // Arrange — scanning while the tombstone is still restorable would report
    // nothing (the trash entry excludes it) and waste the one trailing scan.
    const store = await createStore()
    const { setUndoToast } = await import('./slices/uiSlice')

    // Act
    store.dispatch(setUndoToast(undoToastPayload('delete', 'bulk-delete-1')))
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS - 1)

    // Assert
    expect(mockScanStaleLockEntries).not.toHaveBeenCalled()
  })

  test('never rescans for an unlink, which moves nothing to the trash', async () => {
    // Arrange
    const store = await createStore()
    const { setUndoToast } = await import('./slices/uiSlice')

    // Act
    store.dispatch(setUndoToast(undoToastPayload('unlink', 'bulk-unlink-1')))
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS + LOCK_RESCAN_GRACE_MS)

    // Assert
    expect(mockScanStaleLockEntries).not.toHaveBeenCalled()
  })

  test('collapses back-to-back deletes into one trailing rescan', async () => {
    // Arrange — each delete restarts the wait, so a user clearing several
    // skills in a row triggers one scan after the last window, not one each.
    const store = await createStore()
    const { setUndoToast } = await import('./slices/uiSlice')

    // Act
    store.dispatch(setUndoToast(undoToastPayload('delete', 'bulk-delete-1')))
    await vi.advanceTimersByTimeAsync(5_000)
    store.dispatch(setUndoToast(undoToastPayload('delete', 'bulk-delete-2')))
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS + LOCK_RESCAN_GRACE_MS)

    // Assert
    expect(mockScanStaleLockEntries).toHaveBeenCalledTimes(1)
  })
})
