import { useEffect } from 'react'

import { useAppDispatch } from '@/renderer/src/redux/hooks'
import {
  setChecking,
  setAvailable,
  setNotAvailable,
  setProgress,
  setReady,
  setError,
} from '@/renderer/src/redux/slices/updateSlice'

/**
 * Update IPC surface, sourced from the global `Window.electron.update`
 * declaration in `types/electron.d.ts`. Reusing the global type via an
 * Indexed Access Type avoids drift between the preload contract and the
 * renderer-side consumer (a previous duplicated `UpdateAPI` interface here
 * silently went out of sync when `onError` switched to `UpdateErrorPayload`).
 */
type UpdateAPI = Window['electron']['update']

/**
 * Get update API from window.electron if available.
 * Returns `undefined` outside production where auto-updater is not wired
 * (the global declaration types it as required, so we narrow at runtime).
 */
function getUpdateAPI(): UpdateAPI | undefined {
  return window.electron?.update
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

    // Subscribe to update events. Callback parameter types are inferred from
    // `UpdateAPI = Window['electron']['update']` so they always track the
    // canonical preload contract (UpdateInfo / DownloadProgress / UpdateErrorPayload).
    const cleanups = [
      updateAPI.onChecking(() => {
        dispatch(setChecking())
      }),
      updateAPI.onAvailable((info) => {
        dispatch(setAvailable(info))
      }),
      updateAPI.onNotAvailable(() => {
        dispatch(setNotAvailable())
      }),
      updateAPI.onProgress((progress) => {
        dispatch(setProgress(progress))
      }),
      updateAPI.onDownloaded((info) => {
        dispatch(setReady(info))
      }),
      updateAPI.onError((error) => {
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
