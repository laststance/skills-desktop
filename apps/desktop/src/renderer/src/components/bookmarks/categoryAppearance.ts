import type { CSSProperties } from 'react'

import {
  bookmarkSwatch,
  type BookmarkCategory,
} from '@/renderer/src/redux/bookmarkCategories'
import { THEME_PRESETS } from '@/shared/constants'

/** Supply a validated numeric hue to the theme's category surface. Unknown palette keys display Blue.
 * @example categoryAppearance({ id: 'security', name: 'Security', color: 'violet' })
 */
export function categoryAppearance(
  category?: BookmarkCategory,
): (CSSProperties & { '--bookmark-hue': number }) | undefined {
  if (!category) return undefined
  return { '--bookmark-hue': THEME_PRESETS[bookmarkSwatch(category.color)].hue }
}
