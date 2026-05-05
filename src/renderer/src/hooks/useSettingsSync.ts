import { useEffect } from 'react'

import { useAppDispatch } from '@/renderer/src/redux/hooks'
import { setSettings } from '@/renderer/src/redux/slices/settingsSlice'

/**
 * Subscribes the Redux settings slice to the main-process JSON store.
 *
 * Two-step contract:
 *   1. On mount: pull a snapshot via `settings:get` and hydrate the
 *      slice. This races initial paint deliberately — components reading
 *      `defaultSkillTab` get the persisted value before they need it.
 *   2. While mounted: subscribe to `settings:changed` so a save in
 *      the Settings window propagates to the main window (and vice
 *      versa) without either side polling.
 *
 * The unsubscribe is returned from `onChanged` so React's cleanup runs it
 * automatically on unmount; nothing leaks when the component tears down.
 *
 * Reused by both renderer entry points — main window (mounted in
 * `App.tsx`) and Settings window (mounted in `SettingsApp.tsx`) — so
 * either route into the same source of truth without duplicate hooks.
 * @example
 * function App() {
 *   useSettingsSync()
 *   return <Layout />
 * }
 */
export function useSettingsSync(): void {
  const dispatch = useAppDispatch()

  useEffect(() => {
    let isCancelled = false

    void window.electron.settings.get().then((nextSettings) => {
      // Guard against the rare case where the component unmounts
      // between the IPC call and its resolution — dispatch on an
      // unmounted store is harmless but the cleanup contract is
      // clearer when we explicitly skip the late write.
      if (!isCancelled) dispatch(setSettings(nextSettings))
    })

    const unsubscribe = window.electron.settings.onChanged((nextSettings) => {
      dispatch(setSettings(nextSettings))
    })

    return () => {
      isCancelled = true
      unsubscribe()
    }
  }, [dispatch])
}
