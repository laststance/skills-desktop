import { useEffect } from 'react'

import { useAppDispatch } from '@/renderer/src/redux/hooks'
import { setSettings } from '@/renderer/src/redux/slices/settingsSlice'

/**
 * Hydrates both window entry points and adopts canonical broadcasts; main suppresses superseded self-echoes, while {@link useUpdateSettings} guards direct replies.
 * @returns Nothing; unmount cancels hydration and removes the change subscription.
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
