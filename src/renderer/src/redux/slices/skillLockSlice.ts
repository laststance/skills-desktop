import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'

import { openLockPruneDialog } from '@/renderer/src/redux/slices/uiSlice'
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
  /**
   * `requestId` of the in-flight prune whose result may still replace the list.
   * Cleared by any scan that lands first: that scan read the lock after the
   * prune began writing, so its list is the newer truth and the prune's
   * `failed` must not put the pre-prune names back over it.
   */
  pruneRequestId: string | null
  /**
   * The exact list the prune dialog was opened on. The dialog is the consent
   * gate for a delegated recursive delete, so what it acts on has to be what
   * the user read — a scan landing while it is open would otherwise swap the
   * list out from under the confirm button. Deliberately NOT cleared on close:
   * the dialog stays mounted through its 200ms exit animation, so emptying it
   * there blanks the description, the list, and the button label mid-fade.
   */
  consentedNames: SkillName[]
}

const initialState: SkillLockState = {
  staleNames: [],
  status: 'idle',
  pruning: false,
  scanRequestId: null,
  pruneRequestId: null,
  consentedNames: [],
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
        // This scan read the lock after the prune started writing it, so its
        // answer outranks whatever that prune is about to report.
        state.pruneRequestId = null
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
        // Same reason as the fulfilled case, and it matters more here: `failed`
        // landing afterwards would list records behind an `unavailable` status
        // that says we cannot stand behind any count.
        state.pruneRequestId = null
        state.status = 'unavailable'
        state.staleNames = []
      })
      .addCase(pruneStaleLockEntries.pending, (state, action) => {
        state.pruning = true
        state.scanRequestId = null
        state.pruneRequestId = action.meta.requestId
      })
      .addCase(pruneStaleLockEntries.fulfilled, (state, action) => {
        state.pruning = false
        // A scan already answered from a newer read of the lock. `failed` is
        // the pre-scan view, so applying it would drop records that scan added.
        if (action.meta.requestId !== state.pruneRequestId) return
        state.pruneRequestId = null
        // Anything that survived is still stale; a follow-up scan would find
        // it again, so keep it visible instead of flashing "all clear".
        state.staleNames = action.payload.failed
      })
      .addCase(pruneStaleLockEntries.rejected, (state) => {
        state.pruning = false
        // `pruneRequestId` is deliberately left alone: a thunk settles once, so
        // this id can never match a later `fulfilled`, and the next `pending`
        // overwrites it. Clearing it here would only add an untestable branch.
      })
      // Snapshot for the dialog. Lives here rather than in `uiSlice` because
      // only this slice can see `staleNames` at the moment the dialog opens.
      // Unconditional, so reopening can never inherit the previous list — which
      // is also why nothing clears this on close.
      .addCase(openLockPruneDialog, (state) => {
        state.consentedNames = [...state.staleNames]
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

/**
 * The records the open prune dialog is asking about, frozen when it opened.
 * Every surface inside that dialog reads this instead of the live list, so the
 * names, the count, and the delete request can never disagree with each other.
 * @param state - Root Redux state.
 * @returns Lock keys the user is being asked to confirm.
 * @example useAppSelector(selectConsentedLockEntryNames) // => ['old-skill']
 */
export const selectConsentedLockEntryNames = (state: RootState): SkillName[] =>
  state.skillLock.consentedNames
