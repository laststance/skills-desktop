import type { CSSProperties } from 'react'

import { WINDOW_OPACITY_MAX_PERCENT } from '@/shared/constants'
import type { Settings } from '@/shared/settings'

/**
 * Sets the inherited background alpha when App renders a pane, keeping every descendant's opacity independent.
 * @returns A CSS custom property, never the element opacity that would fade text.
 * @example getWindowSurfaceStyle('section', 85, 95) // { '--window-surface-opacity': 0.85 }
 */
export function getWindowSurfaceStyle(
  opacityMode: Settings['windowOpacityMode'],
  sectionPercent: number,
  entirePercent: number,
): CSSProperties & { '--window-surface-opacity': number } {
  return {
    '--window-surface-opacity':
      (opacityMode === 'section' ? sectionPercent : entirePercent) /
      WINDOW_OPACITY_MAX_PERCENT,
  }
}
