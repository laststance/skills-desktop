import { ChevronDown, Tags } from 'lucide-react'

import { Button } from '@/renderer/src/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/renderer/src/components/ui/dropdown-menu'
import {
  ALL_CATEGORIES,
  UNCATEGORIZED,
} from '@/renderer/src/redux/bookmarkCategories'
import { useAppDispatch, useAppSelector } from '@/renderer/src/redux/hooks'
import { selectBookmarkCategories } from '@/renderer/src/redux/slices/bookmarkSlice'
import { setBookmarkCategoryFilter } from '@/renderer/src/redux/slices/uiSlice'

/** Filter one collection while preserving the other surface's selection and current search.
 * @example <BookmarkCategoryFilter surface="installed" />
 */
export function BookmarkCategoryFilter({
  surface,
}: {
  surface: 'installed' | 'sidebar'
}) {
  const dispatch = useAppDispatch()
  const categories = useAppSelector(selectBookmarkCategories)
  const id = useAppSelector((state) =>
    surface === 'installed'
      ? state.ui.installedCategoryFilter
      : state.ui.sidebarCategoryFilter,
  )
  const options = [
    { id: ALL_CATEGORIES, name: 'All categories' },
    { id: UNCATEGORIZED, name: 'Uncategorized' },
    ...categories,
  ]
  const name =
    options.find((option) => option.id === id)?.name ?? 'All categories'
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          id={surface + '-bookmark-category-filter'}
          aria-label={`${surface === 'installed' ? 'Installed' : 'Bookmarks'} category filter: ${name}`}
          title={name}
          className="min-w-0 max-w-full"
        >
          <Tags aria-hidden="true" />
          <span className="truncate">{name}</span>
          <ChevronDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-72 max-w-64 overflow-y-auto"
      >
        <DropdownMenuRadioGroup
          value={id}
          onValueChange={(value) =>
            dispatch(setBookmarkCategoryFilter({ surface, id: value }))
          }
        >
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.id} value={option.id}>
              <span className="truncate">{option.name}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Offer recovery in an empty categorized list without clearing its search or other filters.
 * @example <EmptyCategoryFilter surface="sidebar" />
 */
export function EmptyCategoryFilter({
  surface,
}: {
  surface: 'installed' | 'sidebar'
}) {
  const dispatch = useAppDispatch()
  return (
    <div className="flex flex-col items-center gap-2 px-2 py-4 text-center text-xs text-muted-foreground">
      <p>No matches for this category.</p>
      <Button
        variant="ghost"
        size="sm"
        onClick={() =>
          dispatch(setBookmarkCategoryFilter({ surface, id: ALL_CATEGORIES }))
        }
      >
        Clear category filter
      </Button>
    </div>
  )
}
