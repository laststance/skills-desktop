import type { ReactElement } from 'react'

import { useBackgroundSnapshot } from '@/renderer/src/hooks/useBackgroundSnapshot'
import { useAppDispatch, useAppSelector } from '@/renderer/src/redux/hooks'
import { setFailedBackgroundUrl } from '@/renderer/src/redux/slices/uiSlice'
import { isBackgroundUnavailable } from '@/renderer/src/utils/isBackgroundUnavailable'

import { BackgroundImage } from './BackgroundImage'
import { BackgroundImageRetry } from './BackgroundImageRetry'

/** Adds one theme-backed image below all three App panes without moving their content or webviews.
 * @returns An independent decorative layer and an accessible retry only when the committed image fails.
 * @example <BackgroundCanvas />
 */
export function BackgroundCanvas(): ReactElement {
  const dispatch = useAppDispatch()
  const snapshot = useBackgroundSnapshot()
  const background = useAppSelector((state) => state.settings.background)
  // Shared so the inspector credit can yield the bottom-right corner to Retry.
  const failedUrl = useAppSelector((state) => state.ui.failedBackgroundUrl)
  const display = snapshot.display
  const unavailable = isBackgroundUnavailable(
    snapshot,
    background.selected,
    failedUrl,
  )
  return (
    <>
      {display || background.selected ? (
        <div data-testid="background-canvas" className="background-canvas">
          {display ? (
            <BackgroundImage
              display={display}
              layout={background.layout}
              retryRevision={snapshot.displayRetryRevision}
              decorative
              onLoad={() => dispatch(setFailedBackgroundUrl(null))}
              onError={() =>
                dispatch(setFailedBackgroundUrl(display.image.url))
              }
            />
          ) : null}
        </div>
      ) : null}
      {/* Mount the empty live region before a failure so assistive technology announces its update. */}
      <div role="status">
        {unavailable ? (
          <div className="opaque-surface no-drag absolute bottom-2 right-2 z-10 flex max-w-[calc(100%-1rem)] items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs">
            Background unavailable.
            <BackgroundImageRetry />
          </div>
        ) : null}
      </div>
    </>
  )
}
