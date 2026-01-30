import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'

import type {
  UpdateStatus,
  UpdateInfo,
  DownloadProgress,
} from '../../../../shared/types'

interface UpdateState {
  status: UpdateStatus
  version: string | null
  releaseNotes: string | null
  progress: number
  error: string | null
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
