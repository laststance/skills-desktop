import type { PayloadAction } from '@reduxjs/toolkit'
import { createSelector, createSlice } from '@reduxjs/toolkit'

import type { RootState } from '@/renderer/src/redux/store'
import { DEFAULT_SETTINGS, type Settings } from '@/shared/settings'
import type { AgentId } from '@/shared/types'

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

/**
 * Renderer selector for `Settings.hiddenAgentIds`. Centralizing the
 * read here lets sidebar / settings-pane components reach for one
 * stable hook signature instead of inlining the slice path each time
 * — also the right place to swap the storage shape (e.g. Set) later.
 * @param state - Root Redux state
 * @returns The list of agent ids the user has hidden from the sidebar
 * @example
 * useAppSelector(selectHiddenAgentIds) // => ['cursor', 'zed']
 */
export const selectHiddenAgentIds = (state: RootState): AgentId[] =>
  state.settings.hiddenAgentIds

/**
 * Selects the preview typography and theme when Appearance or CodePreview renders so both consumers share one stable projection.
 * @param state - Root Redux state containing the persisted preview settings.
 * @returns Persisted font sizes and curated code-theme id used by preview controls and content.
 * @example
 * const { codeThemeId } = useAppSelector(selectPreviewAppearanceSettings)
 */
export const selectPreviewAppearanceSettings = createSelector(
  [
    (state: RootState): Settings['markdownFontSizePx'] =>
      state.settings.markdownFontSizePx,
    (state: RootState): Settings['codeFontSizePx'] =>
      state.settings.codeFontSizePx,
    (state: RootState): Settings['codeThemeId'] => state.settings.codeThemeId,
  ],
  (markdownFontSizePx, codeFontSizePx, codeThemeId) => ({
    markdownFontSizePx,
    codeFontSizePx,
    codeThemeId,
  }),
)
