import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'

import type {
  DownloadProgress,
  SemanticVersion,
  UpdateInfo,
  UpdateStatus,
} from '../../../../shared/types'

/**
 * Redux state tracking the auto-update lifecycle.
 * Populated by electron-updater events forwarded over IPC.
 */
interface UpdateState {
  /** Current phase of the auto-update flow. */
  status: UpdateStatus
  /** Advertised version of the available or ready update, if any. @example "0.11.0" */
  version: SemanticVersion | null
  /** Markdown release notes attached to `version`, if provided by the publisher. */
  releaseNotes: string | null
  /** Download progress percentage (0–100). */
  progress: number
  /** Human-readable error from the last failed update step. */
  error: string | null
  /** true once the user has clicked "later" — suppresses the banner until next app start. */
  dismissed: boolean
}

const initialState: UpdateState = {
  status: 'idle',
  version: null,
  releaseNotes: null,
  progress: 0,
  error: null,
  dismissed: false,
}

const updateSlice = createSlice({
  name: 'update',
  initialState,
  reducers: {
    setChecking: (state) => {
      state.status = 'checking'
      state.error = null
    },
    setAvailable: (state, action: PayloadAction<UpdateInfo>) => {
      state.status = 'available'
      state.version = action.payload.version
      state.releaseNotes = action.payload.releaseNotes ?? null
      state.dismissed = false
    },
    setNotAvailable: (state) => {
      state.status = 'idle'
    },
    setDownloading: (state) => {
      state.status = 'downloading'
    },
    setProgress: (state, action: PayloadAction<DownloadProgress>) => {
      state.status = 'downloading'
      state.progress = action.payload.percent
    },
    setReady: (state, action: PayloadAction<UpdateInfo>) => {
      state.status = 'ready'
      state.version = action.payload.version
      state.releaseNotes = action.payload.releaseNotes ?? null
      state.progress = 100
    },
    setError: (state, action: PayloadAction<string>) => {
      state.status = 'error'
      state.error = action.payload
    },
    dismiss: (state) => {
      state.dismissed = true
    },
    reset: () => initialState,
  },
})

export const {
  setChecking,
  setAvailable,
  setNotAvailable,
  setDownloading,
  setProgress,
  setReady,
  setError,
  dismiss,
  reset,
} = updateSlice.actions

export default updateSlice.reducer
