import type { BookmarkCategory } from '@/renderer/src/redux/bookmarkCategories'

/** Shows the saved category on read-only rows in Tree, the sidebar and the dashboard.
 * @example <BookmarkCategoryLabel category={category} />
 */
export function BookmarkCategoryLabel({
  category,
}: {
  category?: BookmarkCategory
}) {
  if (!category) return null
  return (
    <span className="bookmark-category-label" title={category.name}>
      {category.name}
    </span>
  )
}
