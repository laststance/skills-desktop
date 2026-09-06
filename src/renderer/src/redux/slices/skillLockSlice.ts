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
  /**
   * `requestId` of the newest scan whose result may still be applied. Four
   * call sites dispatch scans independently (mount, refresh thunk, listener,
   * post-prune), so a slow one can resolve after a newer one and put the old
   * list back. Cleared when a prune starts: any scan launched before the lock
   * was rewritten is describing a lock that no longer exists.
   */
  scanRequestId: string | null
  /**
   * `requestId` of the prune in flight, or null when none is. Doubles as the
   * busy flag behind {@link selectIsPruningLockEntries} rather than sitting
   * beside a separate boolean, so "a prune is running" and "which prune" cannot
   * drift apart: only the prune that set this may clear it, and an older one
   * settling can never re-enable the confirm button mid-delete.
   */
  pruneRequestId: string | null
  /**
   * Set when a scan lands while a prune is in flight. That scan read the lock
   * after the prune began writing, so its list is the newer truth and the
   * prune's `failed` must not put the pre-prune names back over it. Kept apart
   * from {@link SkillLockState.pruneRequestId} because that one still has to
   * let its own prune release the busy state — clearing it here would leave the
   * dialog stuck on "Pruning..." with every control disabled.
   */
  staleNamesSupersededByScan: boolean
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
  scanRequestId: null,
  pruneRequestId: null,
  staleNamesSupersededByScan: false,
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
        // answer outranks whatever that prune is about to report. It does not
        // touch `pruneRequestId`: that prune still has to be able to end itself.
        state.staleNamesSupersededByScan = true
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
        state.staleNamesSupersededByScan = true
        state.status = 'unavailable'
        state.staleNames = []
      })
      .addCase(pruneStaleLockEntries.pending, (state, action) => {
        state.scanRequestId = null
        state.pruneRequestId = action.meta.requestId
        state.staleNamesSupersededByScan = false
      })
      .addCase(pruneStaleLockEntries.fulfilled, (state, action) => {
        // Only the prune that owns the busy state may release it. An older one
        // settling here would report "not pruning" while a newer delete is
        // still running, re-enabling the confirm button mid-delegation.
        if (action.meta.requestId !== state.pruneRequestId) return
        state.pruneRequestId = null
        // A scan already answered from a newer read of the lock. `failed` is
        // the pre-scan view, so applying it would drop records that scan added.
        if (state.staleNamesSupersededByScan) return
        // Anything that survived is still stale; a follow-up scan would find
        // it again, so keep it visible instead of flashing "all clear".
        state.staleNames = action.payload.failed
      })
      .addCase(pruneStaleLockEntries.rejected, (state, action) => {
        // Same ownership check as the fulfilled case: releasing the busy state
        // is the newest prune's to do, never an older one's.
        if (action.meta.requestId !== state.pruneRequestId) return
        state.pruneRequestId = null
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

/**
 * Whether a prune is in flight, derived from the in-flight request id so a
 * separate boolean can never contradict it; read by {@link LockPruneDialog} to
 * disable both footer buttons during a delegated delete.
 * @param state - Root Redux state.
 * @returns True while a prune has been dispatched and has not settled.
 * @example useAppSelector(selectIsPruningLockEntries) // => false
 */
export const selectIsPruningLockEntries = (state: RootState): boolean =>
  state.skillLock.pruneRequestId !== null

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
