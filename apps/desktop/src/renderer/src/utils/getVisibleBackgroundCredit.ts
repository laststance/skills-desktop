import type {
  BackgroundDisplay,
  BackgroundImageDescriptor,
} from '@/shared/backgrounds'

/** Picks the credit {@link BackgroundAttribution} pins to the window corner: only a credited image actually on screen needs attribution.
 * @param display - Main-window display from the background snapshot; null before any image is applied.
 * @param failedUrl - Image URL whose native load last failed, recorded by {@link BackgroundCanvas}.
 * @returns
 * - The display's credit while its image is on screen
 * - null for no display, uncredited uploads, or a failed image (the Retry notice owns the corner then)
 * @example
 * getVisibleBackgroundCredit(unsplashDisplay, null) // => { photographerName: 'Kellen Riggin', ... }
 * getVisibleBackgroundCredit(unsplashDisplay, unsplashDisplay.image.url) // => null
 */
export function getVisibleBackgroundCredit(
  display: BackgroundDisplay | null,
  failedUrl: BackgroundImageDescriptor['url'] | null,
): BackgroundDisplay['credit'] {
  // A failed image is not on screen, so it owes no credit.
  if (!display || failedUrl === display.image.url) return null
  return display.credit
}
