import { Search } from 'lucide-react'
import React, { useCallback } from 'react'

import { Input } from '@/renderer/src/components/ui/input'
import {
  ToggleGroup,
  ToggleGroupItem,
} from '@/renderer/src/components/ui/toggle-group'
import { useAppDispatch, useAppSelector } from '@/renderer/src/redux/hooks'
import {
  selectSearchQuery,
  selectSearchScope,
  setSearchQuery,
  setSearchScope,
  type SearchScope,
} from '@/renderer/src/redux/slices/uiSlice'

/**
 * Map the active scope to the input's user-facing copy. Centralized so the
 * `aria-label` and `placeholder` always agree — previously the aria-label
 * claimed "name or description" while the filter only matched the name.
 */
const SCOPE_COPY: Record<
  SearchScope,
  { ariaLabel: string; placeholder: string }
> = {
  name: {
    ariaLabel: 'Search skills by name',
    placeholder: 'Search skills...',
  },
  repo: {
    ariaLabel: 'Search skills by repository',
    placeholder: 'Search by repository...',
  },
}

/**
 * Search box for filtering skills. Combines a Name/Repo scope toggle with a
 * text input. The scope decides which `Skill` field the query matches against
 * — see `selectFilteredSkills` for the actual filter logic.
 */
export const SearchBox = React.memo(function SearchBox(): React.ReactElement {
  const dispatch = useAppDispatch()
  const searchQuery = useAppSelector(selectSearchQuery)
  const searchScope = useAppSelector(selectSearchScope)
  const copy = SCOPE_COPY[searchScope]

  const handleScopeChange = useCallback(
    (value: string): void => {
      // Radix returns "" when the user clicks the already-active item.
      // Treat that as a no-op so scope is never undefined at runtime.
      if (value === 'name' || value === 'repo') {
        dispatch(setSearchScope(value))
      }
    },
    [dispatch],
  )

  const handleQueryChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>): void => {
      dispatch(setSearchQuery(e.target.value))
    },
    [dispatch],
  )

  return (
    <div className="flex items-center gap-2">
      <ToggleGroup
        type="single"
        variant="outline"
        size="default"
        value={searchScope}
        onValueChange={handleScopeChange}
        aria-label="Search field"
        className="shrink-0 gap-0"
      >
        <ToggleGroupItem
          value="name"
          aria-label="Search by skill name"
          className="h-9 min-w-0 rounded-r-none focus:z-10 focus-visible:z-10"
        >
          Name
        </ToggleGroupItem>
        <ToggleGroupItem
          value="repo"
          aria-label="Search by repository"
          className="h-9 min-w-0 rounded-l-none border-l-0 focus:z-10 focus-visible:z-10"
        >
          Repo
        </ToggleGroupItem>
      </ToggleGroup>
      <div className="relative flex-1 min-w-0">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          type="search"
          aria-label={copy.ariaLabel}
          placeholder={copy.placeholder}
          value={searchQuery}
          onChange={handleQueryChange}
          className="pl-10 bg-background"
        />
      </div>
    </div>
  )
})
