import { SECTION_OPACITY_MAX_PERCENT } from '@/shared/constants'
import type { Settings } from '@/shared/settings'

/**
 * Applies independent section opacity when App renders Section mode, leaving Entire opacity to Electron.
 * @param opacityMode - Current scope selected in Appearance.
 * @param opacityPercent - Validated saved percentage for one section.
 * @returns CSS opacity from 0.45 to 1; always 1 in Entire mode.
 * @example getWindowSectionOpacity('section', 65) // 0.65
 */
export function getWindowSectionOpacity(
  opacityMode: Settings['windowOpacityMode'],
  opacityPercent: number,
): number {
  return opacityMode === 'section'
    ? opacityPercent / SECTION_OPACITY_MAX_PERCENT
    : 1
}
