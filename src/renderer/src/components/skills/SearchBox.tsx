import { Search } from 'lucide-react'
import React from 'react'

import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import {
  selectSearchQuery,
  selectSearchScope,
  setSearchQuery,
  setSearchScope,
  type SearchScope,
} from '../../redux/slices/uiSlice'
import { Input } from '../ui/input'
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group'

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

  return (
    <div className="flex items-center gap-2">
      <ToggleGroup
        type="single"
        variant="outline"
        size="default"
        value={searchScope}
        // Radix returns "" when the user clicks the already-active item.
        // Treat that as a no-op so scope is never undefined at runtime.
        onValueChange={(value) => {
          if (value === 'name' || value === 'repo') {
            dispatch(setSearchScope(value))
          }
        }}
        aria-label="Search field"
        className="shrink-0"
      >
        <ToggleGroupItem value="name" aria-label="Search by skill name">
          Name
        </ToggleGroupItem>
        <ToggleGroupItem value="repo" aria-label="Search by repository">
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
          onChange={(e) => dispatch(setSearchQuery(e.target.value))}
          className="pl-10 bg-background"
        />
      </div>
    </div>
  )
})
