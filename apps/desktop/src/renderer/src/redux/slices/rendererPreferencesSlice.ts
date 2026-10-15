import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

/** Durable renderer choices; {@link rendererPreferencesHydrated} gates startup cues. */
export interface RendererPreferencesState {
  markdownPreviewMode: 'code' | 'reading'
  lastSeenVersion: string | null
  /** Runtime readiness, never trusted or written by the storage adapter. */
  hydrated: boolean
}

const initialState: RendererPreferencesState = {
  markdownPreviewMode: 'code',
  lastSeenVersion: null,
  hydrated: false,
}

const rendererPreferencesSlice = createSlice({
  name: 'rendererPreferences',
  initialState,
  reducers: {
    /** Records the mode selected by {@link FileContent}, shared by every preview surface.
     * @example dispatch(setMarkdownPreviewMode('reading'))
     */
    setMarkdownPreviewMode: (
      state,
      action: PayloadAction<RendererPreferencesState['markdownPreviewMode']>,
    ) => {
      state.markdownPreviewMode = action.payload
    },
    /** Claims the release cue before {@link useReleaseNotesToast} publishes it, preventing remount duplicates.
     * @example dispatch(markReleaseNotesSeen('0.33.0'))
     */
    markReleaseNotesSeen: (state, action: PayloadAction<string>) => {
      state.lastSeenVersion = action.payload
    },
    /** Adopts validated storage events without marking remote preferences for another write.
     * @example dispatch(syncRendererPreferences({ markdownPreviewMode: 'reading', lastSeenVersion: null }))
     */
    syncRendererPreferences: (
      state,
      action: PayloadAction<Omit<RendererPreferencesState, 'hydrated'>>,
    ) => {
      Object.assign(state, action.payload)
    },
    /** Releases startup consumers after the persistence factory finishes loading, including an empty install.
     * @example dispatch(rendererPreferencesHydrated())
     */
    rendererPreferencesHydrated: (state) => {
      state.hydrated = true
    },
  },
})

export const {
  setMarkdownPreviewMode,
  markReleaseNotesSeen,
  syncRendererPreferences,
  rendererPreferencesHydrated,
} = rendererPreferencesSlice.actions

export default rendererPreferencesSlice.reducer

/** Supplies {@link FileContent} with the session choice even while storage rejects writes.
 * @example const mode = useAppSelector(selectMarkdownPreviewMode)
 */
export const selectMarkdownPreviewMode = (state: {
  rendererPreferences: RendererPreferencesState
}): RendererPreferencesState['markdownPreviewMode'] =>
  state.rendererPreferences.markdownPreviewMode
