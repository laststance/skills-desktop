import type {
  BackgroundSelection,
  BackgroundSnapshot,
} from '@/shared/backgrounds'

/** Distinguishes a failed saved image from the brief settings-before-display publication interval for both windows.
 * @returns Whether Main/Appearance should offer recovery instead of showing the accepted image loading.
 * @example isBackgroundUnavailable(snapshot, settings.background.selected, failedUrl)
 */
export function isBackgroundUnavailable(
  snapshot: BackgroundSnapshot,
  selected: BackgroundSelection | null,
  failedUrl: string | null,
): boolean {
  if (snapshot.display) return failedUrl === snapshot.display.image.url
  // Main publishes settings before its display; an accepted Apply is still preparing that matching update.
  return Boolean(
    selected &&
    snapshot.revision >= 0 &&
    snapshot.operation?.status !== 'applying',
  )
}
