import { Search } from 'lucide-react'
import React from 'react'

import {
  SegmentedControl,
  type SegmentedControlOption,
} from '@/renderer/src/components/shared/segmented-control'
import { Input } from '@/renderer/src/components/ui/input'
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

/** Name/Repo scope segments for the search box's connected toggle. */
const SEARCH_SCOPE_OPTIONS: ReadonlyArray<SegmentedControlOption<SearchScope>> =
  [
    { value: 'name', label: 'Name', ariaLabel: 'Search by skill name' },
    { value: 'repo', label: 'Repo', ariaLabel: 'Search by repository' },
  ]

/**
 * Search box for filtering skills. Combines a Name/Repo scope toggle with a
 * text input. The scope decides which `Skill` field the query matches against
 * — see `selectFilteredSkills` for the actual filter logic.
 */
export const SearchBox = function SearchBox(): React.ReactElement {
  const dispatch = useAppDispatch()
  const searchQuery = useAppSelector(selectSearchQuery)
  const searchScope = useAppSelector(selectSearchScope)
  const copy = SCOPE_COPY[searchScope]

  const handleScopeChange = (scope: SearchScope): void => {
    dispatch(setSearchScope(scope))
  }

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    dispatch(setSearchQuery(e.target.value))
  }

  return (
    <div className="flex items-center gap-2">
      <SegmentedControl
        aria-label="Search field"
        value={searchScope}
        onValueChange={handleScopeChange}
        options={SEARCH_SCOPE_OPTIONS}
        className="shrink-0"
        itemClassName="h-9 min-w-0"
      />

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
}
