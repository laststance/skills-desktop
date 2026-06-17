import { useEffect } from 'react'

import { useAppDispatch } from '@/renderer/src/redux/hooks'
import { setActivityEvents } from '@/renderer/src/redux/slices/activitySlice'
import { FEATURE_FLAGS } from '@/shared/featureFlags'

/**
 * Subscribes the Redux activity slice to the main-process event log, mirroring
 * `useSettingsSync`.
 *
 * Two-step contract (when enabled):
 *   1. On mount: pull a snapshot via `activity:list` and hydrate the slice.
 *   2. While mounted: subscribe to `activity:changed` so an add/remove/sync in
 *      the main process propagates to the timeline without polling.
 *
 * Gated on `ENABLE_DASHBOARD_EXPERIMENTAL`: while the flag is off the widget is
 * hidden from the picker and the main-process recorder is a no-op, so there is
 * nothing to hydrate or subscribe to and the effect returns early — keeping the
 * feature fully dark with zero IPC traffic.
 * @example
 * function App() {
 *   useActivitySync()
 *   return <Layout />
 * }
 */
export function useActivitySync(): void {
  const dispatch = useAppDispatch()

  useEffect(() => {
    if (!FEATURE_FLAGS.ENABLE_DASHBOARD_EXPERIMENTAL) return

    let isCancelled = false

    void window.electron.activity.list().then((events) => {
      // Skip the late write if the component unmounted between the IPC call
      // and its resolution (same cleanup contract as useSettingsSync).
      if (!isCancelled) dispatch(setActivityEvents(events))
    })

    const unsubscribe = window.electron.activity.onChanged((events) => {
      dispatch(setActivityEvents(events))
    })

    return () => {
      isCancelled = true
      unsubscribe()
    }
  }, [dispatch])
}
