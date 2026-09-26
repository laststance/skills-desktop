import { BackgroundCropSchema, type BackgroundCrop } from '../backgrounds'
import {
  BACKGROUND_FULL_CROP_PERCENT,
  BACKGROUND_MIN_LONG_EDGE_PX,
  BACKGROUND_MIN_SHORT_EDGE_PX,
} from '../constants'

/** Keeps Main extraction and gallery feedback identical when either converts an oriented-source crop.
 * @param crop - Percentage crop relative to the full oriented source.
 * @param width - Real oriented source width, never the preview width.
 * @param height - Real oriented source height, never the preview height.
 * @returns Floored source pixels and resolution eligibility, or null for invalid coordinates/dimensions.
 * @example backgroundCropPixels({ x: 0, y: 0, width: 50, height: 50 }, 3840, 2160) // { left: 0, top: 0, width: 1920, height: 1080, isLargeEnough: true }
 */
export function backgroundCropPixels(
  crop: BackgroundCrop,
  width: number,
  height: number,
): {
  left: number
  top: number
  width: number
  height: number
  isLargeEnough: boolean
} | null {
  // Invalid dimensions or out-of-bounds percentages must never reach Sharp or native clipping.
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    !BackgroundCropSchema.safeParse(crop).success
  )
    return null
  const cropWidth = Math.floor(
    (width * crop.width) / BACKGROUND_FULL_CROP_PERCENT,
  )
  const cropHeight = Math.floor(
    (height * crop.height) / BACKGROUND_FULL_CROP_PERCENT,
  )
  return {
    left: Math.floor((width * crop.x) / BACKGROUND_FULL_CROP_PERCENT),
    top: Math.floor((height * crop.y) / BACKGROUND_FULL_CROP_PERCENT),
    width: cropWidth,
    height: cropHeight,
    isLargeEnough:
      Math.max(cropWidth, cropHeight) >= BACKGROUND_MIN_LONG_EDGE_PX &&
      Math.min(cropWidth, cropHeight) >= BACKGROUND_MIN_SHORT_EDGE_PX,
  }
}
