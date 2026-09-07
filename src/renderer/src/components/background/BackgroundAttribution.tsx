import type { ReactElement } from 'react'

import { BackgroundCredit } from '@/renderer/src/components/background/BackgroundCredit'
import { useBackgroundSnapshot } from '@/renderer/src/hooks/useBackgroundSnapshot'

/** Places provider credits in the existing inspector titlebar so attribution never covers scrollable content.
 * @returns Opaque linked credits, or nothing when no credited background is selected.
 * @example <BackgroundAttribution />
 */
export function BackgroundAttribution(): ReactElement | null {
  const { display } = useBackgroundSnapshot()
  if (!display?.credit) return null
  return (
    <div className="no-drag mr-auto min-w-0 overflow-hidden px-2">
      <BackgroundCredit credit={display.credit} />
    </div>
  )
}
