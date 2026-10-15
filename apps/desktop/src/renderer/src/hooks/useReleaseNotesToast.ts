import { useEffect } from 'react'
import { toast } from 'sonner'

import {
  useAppDispatch,
  useAppSelector,
  useAppStore,
} from '@/renderer/src/redux/hooks'
import { markReleaseNotesSeen } from '@/renderer/src/redux/slices/rendererPreferencesSlice'
import { getReleaseNotesUrl } from '@/renderer/src/utils/getReleaseNotesUrl'

/**
 * Publishes the update cue after Redux preferences hydrate, then records it through storage middleware.
 * Called by {@link App}; first installs stay silent and remounts cannot repeat a claimed version.
 * @example useReleaseNotesToast()
 */
// eslint-disable-next-line @laststance/react-next/no-single-use-hook-file -- Dedicated release cue module has direct browser tests and an App mock seam.
export function useReleaseNotesToast(): void {
  const dispatch = useAppDispatch()
  const store = useAppStore()
  const hydrated = useAppSelector((state) => state.rendererPreferences.hydrated)

  useEffect(() => {
    if (!hydrated) return
    const currentVersion = __APP_VERSION__
    // Read live state because StrictMode can replay this effect before another render.
    const lastSeenVersion = store.getState().rendererPreferences.lastSeenVersion
    if (lastSeenVersion === currentVersion) return
    dispatch(markReleaseNotesSeen(currentVersion))

    const shouldShowToast =
      lastSeenVersion !== null && lastSeenVersion !== currentVersion

    if (shouldShowToast) {
      const releaseNotesUrl = getReleaseNotesUrl(currentVersion)
      toast(`Updated to v${currentVersion}`, {
        description: 'See what changed in this release.',
        duration: 8000,
        closeButton: true,
        classNames: {
          // Sonner seats the 20px × at 8px from the left; pl-7 reserves that 28px on the 4px grid.
          title: 'text-popover-foreground pl-7',
        },
        action: {
          label: 'View',
          onClick: () => {
            window.open(releaseNotesUrl, '_blank', 'noopener,noreferrer')
          },
        },
      })
    }
  }, [dispatch, hydrated, store])
}
