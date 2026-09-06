import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'

import type { RootState } from '@/renderer/src/redux/store'
import type { SkillName } from '@/shared/types'

// ============================================================================
// State shape
// ----------------------------------------------------------------------------
// `status` is three-valued on purpose. `unavailable` means main could not read
// the lock or `~/.agents/skills`, which is NOT the same as "nothing is stale":
// with one side of the comparison missing, every surviving record would look
// deletable. The UI shows nothing at all in that state rather than a count it
// cannot stand behind.
//
// Intentionally NOT persisted — this mirrors the filesystem, so a cached copy
// would be wrong the moment the user deletes a skill outside the app.
// ============================================================================

/** Renderer view of the skills CLI lock: which records point at a skill that is gone. */
interface SkillLockState {
  /** Raw lock keys reported stale by the last scan. */
  staleNames: SkillName[]
  /** `idle` before the first scan; `unavailable` when main could not compare. */
  status: 'idle' | 'ok' | 'unavailable'
  /** True while a prune is in flight, so the confirm button can disable. */
  pruning: boolean
  /**
   * `requestId` of the newest scan whose result may still be applied. Four
   * call sites dispatch scans independently (mount, refresh thunk, listener,
   * post-prune), so a slow one can resolve after a newer one and put the old
   * list back. Cleared when a prune starts: any scan launched before the lock
   * was rewritten is describing a lock that no longer exists.
   */
  scanRequestId: string | null
}

const initialState: SkillLockState = {
  staleNames: [],
  status: 'idle',
  pruning: false,
  scanRequestId: null,
}

/**
 * Ask main which lock records no longer have a skill. Runs alongside the skill
 * refresh, so the dashboard count stays in step with the list.
 * @returns Scan result, including the `unavailable` case.
 * @example dispatch(fetchStaleLockEntries())
 */
export const fetchStaleLockEntries = createAsyncThunk(
  'skillLock/fetchStale',
  async () => {
    return window.electron.skills.scanStaleLockEntries()
  },
)

/**
 * Remove the currently-known stale records. Fired from the confirm dialog, so
 * it always acts on the list the user was just shown; main revalidates each
 * name before touching anything.
 * @param names - Raw lock keys to prune.
 * @returns Per-name prune outcome from main.
 * @example dispatch(pruneStaleLockEntries(['old-skill']))
 */
export const pruneStaleLockEntries = createAsyncThunk(
  'skillLock/prune',
  async (names: SkillName[]) => {
    return window.electron.skills.pruneLockEntries({ names })
  },
)

const skillLockSlice = createSlice({
  name: 'skillLock',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchStaleLockEntries.pending, (state, action) => {
        state.scanRequestId = action.meta.requestId
      })
      .addCase(fetchStaleLockEntries.fulfilled, (state, action) => {
        // Superseded by a newer scan, or invalidated by a prune.
        if (action.meta.requestId !== state.scanRequestId) return
        if (action.payload.status === 'ok') {
          state.status = 'ok'
          state.staleNames = action.payload.names
          return
        }
        // Main could not compare the two sides. Drop the count rather than
        // showing a stale one next to a "prune" button.
        state.status = 'unavailable'
        state.staleNames = []
      })
      .addCase(fetchStaleLockEntries.rejected, (state, action) => {
        if (action.meta.requestId !== state.scanRequestId) return
        state.status = 'unavailable'
        state.staleNames = []
      })
      .addCase(pruneStaleLockEntries.pending, (state) => {
        state.pruning = true
        state.scanRequestId = null
      })
      .addCase(pruneStaleLockEntries.fulfilled, (state, action) => {
        state.pruning = false
        // Anything that survived is still stale; a follow-up scan would find
        // it again, so keep it visible instead of flashing "all clear".
        state.staleNames = action.payload.failed
      })
      .addCase(pruneStaleLockEntries.rejected, (state) => {
        state.pruning = false
      })
  },
})

export default skillLockSlice.reducer

// ============================================================================
// Selectors
// ============================================================================

export const selectStaleLockEntryNames = (state: RootState): SkillName[] =>
  state.skillLock.staleNames

/**
 * How many lock records the user could prune right now.
 * Zero while the scan is unavailable, so no surface offers an action that main
 * would refuse to perform.
 * @param state - Root Redux state.
 * @returns Count of stale lock records.
 * @example useAppSelector(selectStaleLockEntryCount) // => 3
 */
export const selectStaleLockEntryCount = (state: RootState): number =>
  state.skillLock.status === 'ok' ? state.skillLock.staleNames.length : 0

export const selectIsPruningLockEntries = (state: RootState): boolean =>
  state.skillLock.pruning
