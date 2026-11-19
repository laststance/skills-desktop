import { COLOR_PRESET_NAMES } from '@/shared/constants'
import type { ThemePresetName } from '@/shared/constants'

/** User-owned category. The raw color key survives removal of its swatch from the palette. */
export interface BookmarkCategory {
  id: string
  name: string
  color: string
}

export const STARTER_CATEGORIES: BookmarkCategory[] = [
  { id: 'code-review', name: 'Code Review', color: 'blue' },
  { id: 'frontend-design', name: 'Frontend Design', color: 'rose' },
  { id: 'planning', name: 'Planning', color: 'teal' },
  { id: 'security', name: 'Security', color: 'violet' },
]

/** All and Uncategorized occupy filter-only IDs, separate from the UUID of a custom category. */
export const ALL_CATEGORIES = 'all'
export const UNCATEGORIZED = 'uncategorized'

/** Resolve the display pigment for a stored key when rendering a card or opening the editor.
 * @example bookmarkSwatch('retired-color') // 'blue'
 */
export function bookmarkSwatch(key: string): ThemePresetName {
  return COLOR_PRESET_NAMES.find((entry) => entry === key) ?? 'blue'
}

/** Keep editor feedback and reducer validation identical for new and renamed categories.
 * @example categoryNameError(' Security ', STARTER_CATEGORIES) // 'A category with this name already exists.'
 */
export function categoryNameError(
  draft: string,
  categories: readonly BookmarkCategory[],
  editingId?: string,
): string | undefined {
  const name = draft.trim().toLowerCase()
  if (!name) return 'Enter a category name.'
  if (name === 'all categories' || name === UNCATEGORIZED)
    return 'This name is used by the category filter.'
  if (
    categories.some(
      (category) =>
        category.id !== editingId &&
        category.name.trim().toLowerCase() === name,
    )
  )
    return 'A category with this name already exists.'
  return undefined
}
