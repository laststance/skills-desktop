import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'

import type { RootState } from '@/renderer/src/redux/store'
import type { ActivityEvent, ActivityLog } from '@/shared/activityLog'

/**
 * Renderer-side cache of the activity log owned by the main process.
 *
 * Source of truth lives at `app.getPath('userData')/activity-log.json`; this
 * slice mirrors that newest-first array so the Activity Timeline widget reads
 * it synchronously. Hydration + live updates flow through the `useActivitySync`
 * hook — components must NOT call `window.electron.activity.list()` directly.
 *
 * Like the settings slice, it exposes only an idempotent `setActivityEvents`
 * replacement (not per-event reducers) and is intentionally NOT persisted by
 * `redux-storage-middleware`: persistence is owned by main, so layering
 * localStorage on top would create a dual-write race.
 */
const initialState: ActivityLog = []

const activitySlice = createSlice({
  name: 'activity',
  initialState,
  reducers: {
    setActivityEvents: (_state, action: PayloadAction<ActivityLog>) =>
      action.payload,
  },
})

export const { setActivityEvents } = activitySlice.actions
export default activitySlice.reducer

/**
 * Renderer selector for the newest-first activity events. Centralizing the read
 * here gives the widget one stable hook signature and the right place to swap
 * the storage shape later.
 * @param state - Root Redux state.
 * @returns The newest-first list of recorded activity events.
 * @example
 * useAppSelector(selectActivityEvents) // => [{ id: '…', type: 'synced', skillName: 'Sync', … }]
 */
export const selectActivityEvents = (state: RootState): ActivityEvent[] =>
  state.activity
