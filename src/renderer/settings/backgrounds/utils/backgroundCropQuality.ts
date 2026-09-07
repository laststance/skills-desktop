import type { BackgroundCrop } from '@/shared/backgrounds'
import {
  BACKGROUND_MIN_LONG_EDGE_PX,
  BACKGROUND_MIN_SHORT_EDGE_PX,
} from '@/shared/constants'
import { backgroundCropPixels } from '@/shared/utils/backgroundCropPixels'

/** Gives {@link BackgroundCropEditor} the exact oriented pixels validated again by Main.
 * @returns Selected dimensions and an actionable rejection reason, or null when valid.
 * @example backgroundCropQuality(1920, 1080, { x: 0, y: 0, width: 100, height: 100 }).error // null
 */
export function backgroundCropQuality(
  width: number,
  height: number,
  crop: BackgroundCrop,
): { width: number; height: number; error: string | null } {
  const pixels = backgroundCropPixels(crop, width, height)
  return {
    width: pixels?.width ?? 0,
    height: pixels?.height ?? 0,
    error: pixels?.isLargeEnough
      ? null
      : `Select a larger area: the long edge must be at least ${BACKGROUND_MIN_LONG_EDGE_PX} px and the short edge at least ${BACKGROUND_MIN_SHORT_EDGE_PX} px.`,
  }
}
