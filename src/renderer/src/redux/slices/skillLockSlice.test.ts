import { configureStore } from '@reduxjs/toolkit'
import { describe, expect, test } from 'vitest'

import skillLockReducer, {
  fetchStaleLockEntries,
  pruneStaleLockEntries,
  selectIsPruningLockEntries,
  selectStaleLockEntryCount,
  selectStaleLockEntryNames,
} from './skillLockSlice'

/**
 * Minimal store holding only the slice under test. Selectors take `RootState`
 * but read one branch, so a one-slice store keeps the fixtures honest.
 * @returns Store with just the `skillLock` reducer mounted.
 * @example const store = createTestStore()
 */
function createTestStore() {
  return configureStore({ reducer: { skillLock: skillLockReducer } })
}

/** Selectors are typed against RootState; this store only carries one branch. */
type TestStore = ReturnType<typeof createTestStore>
const readState = (store: TestStore) =>
  store.getState() as unknown as Parameters<typeof selectStaleLockEntryCount>[0]

describe('skillLockSlice', () => {
  test('surfaces the stale records reported by a successful scan', async () => {
    // Arrange
    const store = createTestStore()

    // Act
    store.dispatch(fetchStaleLockEntries.pending('req-1', undefined))
    store.dispatch(
      fetchStaleLockEntries.fulfilled(
        { status: 'ok', names: ['old-skill', 'another-skill'] },
        'req-1',
        undefined,
      ),
    )

    // Assert
    expect(selectStaleLockEntryNames(readState(store))).toEqual([
      'old-skill',
      'another-skill',
    ])
    expect(selectStaleLockEntryCount(readState(store))).toBe(2)
  })

  test('shows no count at all when main could not compare the lock against disk', async () => {
    // Arrange
    // `unavailable` is not "0 stale". With one side of the diff unreadable, a
    // count here would sit next to a button that deletes lock records.
    const store = createTestStore()
    store.dispatch(fetchStaleLockEntries.pending('req-1', undefined))
    store.dispatch(
      fetchStaleLockEntries.fulfilled(
        { status: 'ok', names: ['old-skill'] },
        'req-1',
        undefined,
      ),
    )

    // Act
    store.dispatch(fetchStaleLockEntries.pending('req-2', undefined))
    store.dispatch(
      fetchStaleLockEntries.fulfilled(
        { status: 'unavailable' },
        'req-2',
        undefined,
      ),
    )

    // Assert
    expect(selectStaleLockEntryCount(readState(store))).toBe(0)
    expect(selectStaleLockEntryNames(readState(store))).toEqual([])
  })

  test('shows no count when the scan itself fails', async () => {
    // Arrange
    const store = createTestStore()

    // Act
    store.dispatch(fetchStaleLockEntries.pending('req-1', undefined))
    store.dispatch(
      fetchStaleLockEntries.rejected(new Error('IPC exploded'), 'req-1'),
    )

    // Assert
    expect(selectStaleLockEntryCount(readState(store))).toBe(0)
  })

  test('keeps records that survived the prune visible instead of flashing all clear', async () => {
    // Arrange
    // `skills remove` exits 0 even when a removal failed, so main reports
    // survivors explicitly. They are still stale and still actionable.
    const store = createTestStore()
    store.dispatch(fetchStaleLockEntries.pending('req-1', undefined))
    store.dispatch(
      fetchStaleLockEntries.fulfilled(
        { status: 'ok', names: ['pruned-ok', 'stubborn'] },
        'req-1',
        undefined,
      ),
    )

    // Act
    store.dispatch(
      pruneStaleLockEntries.fulfilled(
        { pruned: ['pruned-ok'], skipped: [], failed: ['stubborn'] },
        'req-2',
        ['pruned-ok', 'stubborn'],
      ),
    )

    // Assert
    expect(selectStaleLockEntryNames(readState(store))).toEqual(['stubborn'])
    expect(selectIsPruningLockEntries(readState(store))).toBe(false)
  })

  test('marks the prune in flight so the confirm button can disable', async () => {
    // Arrange
    const store = createTestStore()

    // Act
    store.dispatch(pruneStaleLockEntries.pending('req-1', ['old-skill']))

    // Assert
    expect(selectIsPruningLockEntries(readState(store))).toBe(true)
  })

  test('clears the in-flight flag when the prune request fails outright', async () => {
    // Arrange
    const store = createTestStore()
    store.dispatch(pruneStaleLockEntries.pending('req-1', ['old-skill']))

    // Act
    store.dispatch(
      pruneStaleLockEntries.rejected(new Error('IPC exploded'), 'req-1', [
        'old-skill',
      ]),
    )

    // Assert
    expect(selectIsPruningLockEntries(readState(store))).toBe(false)
  })

  test('ignores a slow scan that lands after a newer scan already answered', async () => {
    // Arrange
    // Four call sites dispatch scans independently (mount, refresh thunk,
    // listener, post-prune), so two can overlap. Applying whichever finishes
    // last would show a list the filesystem has already moved past.
    const store = createTestStore()
    store.dispatch(fetchStaleLockEntries.pending('req-slow', undefined))
    store.dispatch(fetchStaleLockEntries.pending('req-fresh', undefined))
    store.dispatch(
      fetchStaleLockEntries.fulfilled(
        { status: 'ok', names: ['current-truth'] },
        'req-fresh',
        undefined,
      ),
    )

    // Act
    store.dispatch(
      fetchStaleLockEntries.fulfilled(
        { status: 'ok', names: ['long-gone', 'also-gone'] },
        'req-slow',
        undefined,
      ),
    )

    // Assert
    expect(selectStaleLockEntryNames(readState(store))).toEqual([
      'current-truth',
    ])
  })

  test('keeps the current list when a superseded scan is the one that fails', async () => {
    // Arrange — the stale scan that lost the race is the one that errored. Its
    // failure says nothing about the lock, so blanking the list on it would
    // hide records the newer scan just confirmed are still there.
    const store = createTestStore()
    store.dispatch(fetchStaleLockEntries.pending('req-slow', undefined))
    store.dispatch(fetchStaleLockEntries.pending('req-fresh', undefined))
    store.dispatch(
      fetchStaleLockEntries.fulfilled(
        { status: 'ok', names: ['current-truth'] },
        'req-fresh',
        undefined,
      ),
    )

    // Act
    store.dispatch(
      fetchStaleLockEntries.rejected(new Error('IPC exploded'), 'req-slow'),
    )

    // Assert
    expect(selectStaleLockEntryNames(readState(store))).toEqual([
      'current-truth',
    ])
    expect(selectStaleLockEntryCount(readState(store))).toBe(1)
  })

  test('does not let a scan started before a prune put the pruned records back', async () => {
    // Arrange
    // The dialog re-scans after pruning, but a scan already in flight when the
    // user confirmed describes the lock as it was BEFORE the rewrite. Letting
    // it land would repopulate the widget with records that are now gone.
    const store = createTestStore()
    store.dispatch(fetchStaleLockEntries.pending('req-before-prune', undefined))
    store.dispatch(pruneStaleLockEntries.pending('req-prune', ['old-skill']))
    store.dispatch(
      pruneStaleLockEntries.fulfilled(
        { pruned: ['old-skill'], skipped: [], failed: [] },
        'req-prune',
        ['old-skill'],
      ),
    )

    // Act
    store.dispatch(
      fetchStaleLockEntries.fulfilled(
        { status: 'ok', names: ['old-skill'] },
        'req-before-prune',
        undefined,
      ),
    )

    // Assert
    expect(selectStaleLockEntryNames(readState(store))).toEqual([])
  })
})
