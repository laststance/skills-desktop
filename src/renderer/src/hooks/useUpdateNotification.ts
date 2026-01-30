import { useEffect } from 'react'

import type { UpdateInfo, DownloadProgress } from '../../../shared/types'
import { useAppDispatch } from '../redux/hooks'
import {
  setChecking,
  setAvailable,
  setNotAvailable,
  setProgress,
  setReady,
  setError,
} from '../redux/slices/updateSlice'

// Extended electron API with update functionality
interface UpdateAPI {
  onChecking: (callback: () => void) => () => void
  onAvailable: (callback: (info: UpdateInfo) => void) => () => void
  onNotAvailable: (callback: () => void) => () => void
  onProgress: (callback: (progress: DownloadProgress) => void) => () => void
  onDownloaded: (callback: (info: UpdateInfo) => void) => () => void
  onError: (callback: (error: { message: string }) => void) => () => void
  download: () => Promise<void>
  install: () => Promise<void>
  check: () => Promise<void>
}

interface ElectronAPIWithUpdate {
  update?: UpdateAPI
}

/**
 * Get update API from window.electron if available
 */
function getUpdateAPI(): UpdateAPI | undefined {
  const electron = window.electron as ElectronAPIWithUpdate
  return electron?.update
}

/**
 * Hook to subscribe to auto-update IPC events
 * Sets up listeners on mount and cleans up on unmount
 */
export function useUpdateNotification(): void {
  const dispatch = useAppDispatch()

  useEffect(() => {
    const updateAPI = getUpdateAPI()

    // Check if update API is available (production only)
    if (!updateAPI) {
      return
    }

    // Subscribe to update events
    const cleanups = [
      updateAPI.onChecking(() => {
        dispatch(setChecking())
      }),
      updateAPI.onAvailable((info: UpdateInfo) => {
        dispatch(setAvailable(info))
      }),
      updateAPI.onNotAvailable(() => {
        dispatch(setNotAvailable())
      }),
      updateAPI.onProgress((progress: DownloadProgress) => {
        dispatch(setProgress(progress))
      }),
      updateAPI.onDownloaded((info: UpdateInfo) => {
        dispatch(setReady(info))
      }),
      updateAPI.onError((error: { message: string }) => {
        dispatch(setError(error.message))
      }),
    ]

    // Cleanup all listeners on unmount
    return () => {
      cleanups.forEach((cleanup) => cleanup())
    }
  }, [dispatch])
}

/**
 * Download the available update
 */
export async function downloadUpdate(): Promise<void> {
  const updateAPI = getUpdateAPI()
  await updateAPI?.download()
}

/**
 * Install downloaded update and restart app
 */
export async function installUpdate(): Promise<void> {
  const updateAPI = getUpdateAPI()
  await updateAPI?.install()
}

/**
 * Manually check for updates
 */
export async function checkForUpdates(): Promise<void> {
  const updateAPI = getUpdateAPI()
  await updateAPI?.check()
}
