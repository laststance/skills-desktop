import { useState, type ReactElement } from 'react'

import { useBackgroundSnapshot } from '@/renderer/src/hooks/useBackgroundSnapshot'
import { useAppSelector } from '@/renderer/src/redux/hooks'

import { BackgroundImage } from './BackgroundImage'
import { BackgroundImageRetry } from './BackgroundImageRetry'

/** Adds one theme-backed image below all three App panes without moving their content or webviews.
 * @returns An independent decorative layer and an accessible retry only when the committed image fails.
 * @example <BackgroundCanvas />
 */
export function BackgroundCanvas(): ReactElement | null {
  const snapshot = useBackgroundSnapshot()
  const background = useAppSelector((state) => state.settings.background)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const display = snapshot.display
  const unavailable = display
    ? failedUrl === display.image.url
    : background.selected && snapshot.revision >= 0
  if (!display && !background.selected) return null

  return (
    <>
      <div data-testid="background-canvas" className="background-canvas">
        {display ? (
          <BackgroundImage
            display={display}
            layout={background.layout}
            retryRevision={snapshot.displayRetryRevision}
            decorative
            onLoad={() => setFailedUrl(null)}
            onError={() => setFailedUrl(display.image.url)}
          />
        ) : null}
      </div>
      {unavailable ? (
        <div
          role="status"
          className="opaque-surface no-drag absolute bottom-2 right-2 z-10 flex max-w-[calc(100%-1rem)] items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs"
        >
          Background unavailable.
          <BackgroundImageRetry />
        </div>
      ) : null}
    </>
  )
}
