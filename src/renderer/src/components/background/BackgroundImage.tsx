import {
  useId,
  useState,
  type ReactElement,
  type ReactEventHandler,
} from 'react'

import { backgroundImageLayout } from '@/renderer/src/utils/backgroundImageLayout'
import { backgroundSourceKey } from '@/renderer/src/utils/backgroundSourceKey'
import type { BackgroundDisplay, BackgroundLayout } from '@/shared/backgrounds'
import { backgroundCropPixels } from '@/shared/utils/backgroundCropPixels'

/** Clips the accepted image once for {@link BackgroundCanvas} and Appearance, retaining direct online hotlinks.
 * @returns Native cropped Fill/Fit images or a 1:1 Tile pattern, preserving every excluded source pixel.
 * @example <BackgroundImage display={snapshot.display} layout="fit" retryRevision={0} />
 */
export function BackgroundImage({
  display,
  layout,
  retryRevision,
  onLoad,
  onError,
  decorative = false,
}: {
  display: BackgroundDisplay
  layout: BackgroundLayout
  retryRevision: number
  onLoad?: ReactEventHandler<HTMLImageElement | SVGImageElement>
  onError?: ReactEventHandler<HTMLImageElement | SVGImageElement>
  decorative?: boolean
}): ReactElement | null {
  const id = useId()
  const [imageState, setImageState] = useState<{
    resourceKey: string
    status: 'ready' | 'unavailable'
  } | null>(null)
  const crop = backgroundCropPixels(
    display.crop,
    display.image.width,
    display.image.height,
  )
  if (!crop || crop.width === 0 || crop.height === 0) return null
  const rendering = backgroundImageLayout(layout, crop)
  const imageId = `${id}-image`
  const clipId = `${id}-crop`
  const tileId = `${id}-tile`
  const resourceKey = `${backgroundSourceKey(display.selection.source)}:${display.image.url}:${retryRevision}:${rendering.mode}`
  const status =
    imageState?.resourceKey === resourceKey ? imageState.status : 'loading'
  const handleLoad: typeof onLoad = (event) => {
    setImageState({ resourceKey, status: 'ready' })
    onLoad?.(event)
  }
  const handleError: typeof onError = (event) => {
    setImageState({ resourceKey, status: 'unavailable' })
    onError?.(event)
  }

  // Crop before image sampling: clipping an enlarged full image alone blends excluded edge pixels into the crop.
  if (rendering.mode === 'image') {
    return (
      <div
        data-background-image
        data-background-layout={layout}
        data-background-state={status}
        style={{
          display: 'grid',
          placeItems: 'center',
          containerType: 'size',
          width: '100%',
          height: '100%',
          overflow: 'hidden',
        }}
      >
        <img
          key={resourceKey}
          data-background-resource
          src={display.image.url}
          alt={decorative ? '' : display.title}
          aria-hidden={decorative || undefined}
          style={{
            ...rendering.imageStyle,
            visibility: status === 'unavailable' ? 'hidden' : undefined,
          }}
          onLoad={handleLoad}
          onError={handleError}
        />
      </div>
    )
  }

  return (
    <svg
      data-background-image
      data-background-layout={layout}
      data-background-state={status}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : display.title}
      aria-hidden={decorative || undefined}
      width="100%"
      height="100%"
      overflow="hidden"
      className="block"
      style={{
        visibility: status === 'unavailable' ? 'hidden' : undefined,
      }}
    >
      <defs>
        {/* Only a source change or explicit Retry replaces the resource; operation updates keep it loaded. */}
        <image
          key={resourceKey}
          data-background-resource
          id={imageId}
          href={display.image.url}
          width={display.image.width}
          height={display.image.height}
          // Tile preserves source pixels; nearest sampling stops excluded edge colors bleeding on Retina displays.
          style={{ imageRendering: 'pixelated' }}
          onLoad={handleLoad}
          onError={handleError}
        />
        <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
          <rect
            x={crop.left}
            y={crop.top}
            width={crop.width}
            height={crop.height}
          />
        </clipPath>
        <pattern
          id={tileId}
          patternUnits="userSpaceOnUse"
          width={crop.width}
          height={crop.height}
          viewBox={rendering.viewBox}
        >
          <use href={`#${imageId}`} clipPath={`url(#${clipId})`} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${tileId})`} />
    </svg>
  )
}
