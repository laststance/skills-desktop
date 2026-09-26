import type { BackgroundCrop } from '@/shared/backgrounds'

/** Matches cropper drafts with Main's schema-normalized crop regardless of object property order.
 * @returns True only when all four percentage coordinates match.
 * @example areBackgroundCropsEqual({x:0,y:0,width:100,height:100}, {width:100,height:100,x:0,y:0}) // true
 */
export function areBackgroundCropsEqual(
  left: BackgroundCrop,
  right: BackgroundCrop,
): boolean {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  )
}
