import type { ReactElement } from 'react'

import { BackgroundCredit } from '@/renderer/src/components/background/BackgroundCredit'
import { useBackgroundSnapshot } from '@/renderer/src/hooks/useBackgroundSnapshot'
import { useAppSelector } from '@/renderer/src/redux/hooks'
import { getVisibleBackgroundCredit } from '@/renderer/src/utils/getVisibleBackgroundCredit'

/** Pins provider credits in the {@link DetailPanel} footer — the window's bottom-right corner — clear of tabs and scroll content.
 * @returns An in-flow footer with an opaque linked credit, or nothing when no credited image is on screen.
 * @example <BackgroundAttribution />
 */
export function BackgroundAttribution(): ReactElement | null {
  const { display } = useBackgroundSnapshot()
  const failedUrl = useAppSelector((state) => state.ui.failedBackgroundUrl)
  const credit = getVisibleBackgroundCredit(display, failedUrl)
  // No credited image on screen; while one fails, BackgroundCanvas's Retry notice owns this corner.
  if (!credit) return null
  return (
    <div className="flex h-8 shrink-0 items-center justify-end border-t border-border px-2">
      <div className="opaque-surface flex min-w-0 rounded-md bg-background px-2">
        <BackgroundCredit credit={credit} />
      </div>
    </div>
  )
}
