import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'

import { DEFAULT_SETTINGS, type Settings } from '../../../../shared/settings'

/**
 * Renderer-side cache of the user settings owned by the main process.
 *
 * Source of truth lives at `app.getPath('userData')/settings.json`;
 * this slice mirrors that JSON so React components can read it
 * synchronously. Hydration + cross-window sync flows through the
 * `useSettingsSync` hook — components must NOT call
 * `window.electron.settings.get()` directly.
 *
 * The slice intentionally exposes only an idempotent `setSettings`
 * replacement (not per-field reducers). Local field updates dispatched
 * from a Settings section UI happen via the same action after the
 * `settings:set` IPC roundtrip resolves, keeping cache and disk in
 * lockstep.
 *
 * NOT included in `redux-storage-middleware` slices array — persistence
 * is owned by main, so layering localStorage on top would create a
 * dual-write race.
 */
const settingsSlice = createSlice({
  name: 'settings',
  initialState: DEFAULT_SETTINGS,
  reducers: {
    setSettings: (_state, action: PayloadAction<Settings>) => action.payload,
  },
})

export const { setSettings } = settingsSlice.actions
export default settingsSlice.reducer
