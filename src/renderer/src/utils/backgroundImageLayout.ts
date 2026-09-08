import type { CSSProperties } from 'react'

import type { BackgroundLayout } from '@/shared/backgrounds'
import type { backgroundCropPixels } from '@/shared/utils/backgroundCropPixels'

/** Maps a validated crop to native image sizing or tile geometry when {@link BackgroundImage} renders.
 * @param layout - Selected Fill, Fit, or Tile behavior.
 * @param crop - Nonzero source-pixel rectangle validated by {@link backgroundCropPixels}.
 * @returns Resource mode, SVG view box, and CSS that crops before image sampling.
 * @example backgroundImageLayout('fill', { left: 0, top: 0, width: 1920, height: 1080, isLargeEnough: true })
 */
export function backgroundImageLayout(
  layout: BackgroundLayout,
  crop: NonNullable<ReturnType<typeof backgroundCropPixels>>,
) {
  return {
    mode: layout === 'tile' ? 'tile' : 'image',
    viewBox: `${crop.left} ${crop.top} ${crop.width} ${crop.height}`,
    imageStyle: {
      display: 'block',
      // Fit sizes the cropped image's own box; object-fit:contain can paint excluded pixels in its bars.
      width:
        layout === 'fill'
          ? '100%'
          : `min(100cqw, calc(100cqh * ${crop.width / crop.height}))`,
      height:
        layout === 'fill'
          ? '100%'
          : `min(100cqh, calc(100cqw * ${crop.height / crop.width}))`,
      objectFit: 'cover',
      objectViewBox: `xywh(${crop.left}px ${crop.top}px ${crop.width}px ${crop.height}px)`,
    } satisfies CSSProperties,
  }
}
