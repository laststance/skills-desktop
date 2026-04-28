import { useEffect } from 'react'
import { toast } from 'sonner'

import { RELEASE_NOTES_LAST_SEEN_VERSION_KEY } from '../../../shared/constants'
import { getReleaseNotesUrl } from '../utils/getReleaseNotesUrl'

/**
 * Show a one-shot "What's new" toast after the app has been updated to a
 * version the user hasn't seen yet.
 *
 * Detection strategy:
 * - Read the last-seen version from localStorage on mount.
 * - If absent → first install, silently store the current version (no toast).
 * - If present and equal → user already saw notes for this version, no-op.
 * - If present and different → fire the toast once, then store the current
 *   version so the next launch is silent.
 *
 * Why localStorage instead of Redux: this is a transient first-launch cue,
 * not app state. Nothing else reads or writes the value, so a slice would
 * just add ceremony.
 *
 * @example
 * // Inside <App /> root:
 * useReleaseNotesToast()
 */
export function useReleaseNotesToast(): void {
  useEffect(() => {
    const currentVersion = __APP_VERSION__
    const lastSeenVersion = window.localStorage.getItem(
      RELEASE_NOTES_LAST_SEEN_VERSION_KEY,
    )

    // Persist the running version unconditionally at the end so future
    // launches are silent. We compute whether to toast first, then write.
    const shouldShowToast =
      lastSeenVersion !== null && lastSeenVersion !== currentVersion

    if (shouldShowToast) {
      const releaseNotesUrl = getReleaseNotesUrl(currentVersion)
      toast(`Updated to v${currentVersion}`, {
        description: 'See what changed in this release.',
        duration: 8000,
        action: {
          label: 'View',
          onClick: () => {
            window.open(releaseNotesUrl, '_blank', 'noopener,noreferrer')
          },
        },
      })
    }

    window.localStorage.setItem(
      RELEASE_NOTES_LAST_SEEN_VERSION_KEY,
      currentVersion,
    )
  }, [])
}
