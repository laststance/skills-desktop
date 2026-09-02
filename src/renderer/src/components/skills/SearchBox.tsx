import { Search } from 'lucide-react'
import React, { useId, useState } from 'react'

import {
  SegmentedControl,
  type SegmentedControlOption,
} from '@/renderer/src/components/shared/segmented-control'
import { Input } from '@/renderer/src/components/ui/input'
import { cn } from '@/renderer/src/lib/utils'
import { useAppDispatch, useAppSelector } from '@/renderer/src/redux/hooks'
import {
  selectRepoSearchSuggestions,
  type RepoSearchSuggestion,
} from '@/renderer/src/redux/selectors'
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
 * Installed-tab search box: Name/Repo scope toggle + input whose query feeds
 * {@link selectFilteredSkills}. In Repo scope the input is an ARIA combobox
 * offering {@link selectRepoSearchSuggestions} in a listbox; picking one fills the query.
 * @returns Toolbar search control mounted by {@link MainContent}
 * @example
 * <SearchBox />
 */
export const SearchBox = function SearchBox(): React.ReactElement {
  const dispatch = useAppDispatch()
  const searchQuery = useAppSelector(selectSearchQuery)
  const searchScope = useAppSelector(selectSearchScope)
  const repoSuggestions = useAppSelector(selectRepoSearchSuggestions)
  const copy = SCOPE_COPY[searchScope]
  const listboxId = useId()
  // Listbox visibility + keyboard cursor; -1 means no option is highlighted.
  const [isListOpen, setIsListOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)

  // The selector already narrows suggestions to the typed query; Name scope
  // simply never offers any.
  const isRepoScope = searchScope === 'repo'
  const visibleSuggestions = isRepoScope ? repoSuggestions : []
  const showListbox = isListOpen && visibleSuggestions.length > 0
  // Clamp: the cursor can outlive a list that shrank after a keystroke.
  const highlightedIndex =
    activeIndex < visibleSuggestions.length ? activeIndex : -1
  const optionId = (index: number): string => `${listboxId}-option-${index}`

  const openList = (): void => setIsListOpen(true)

  const closeList = (): void => {
    setIsListOpen(false)
    setActiveIndex(-1)
  }

  const pickSuggestion = (suggestion: RepoSearchSuggestion): void => {
    dispatch(setSearchQuery(suggestion))
    closeList()
  }

  const handleScopeChange = (scope: SearchScope): void => {
    dispatch(setSearchScope(scope))
    closeList()
  }

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    dispatch(setSearchQuery(e.target.value))
    setIsListOpen(true)
    setActiveIndex(-1)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (!isRepoScope) return
    switch (e.key) {
      case 'ArrowDown':
        // Wraps to the top after the last option; also reopens a closed list.
        e.preventDefault()
        setIsListOpen(true)
        setActiveIndex(
          highlightedIndex + 1 < visibleSuggestions.length
            ? highlightedIndex + 1
            : 0,
        )
        break
      case 'ArrowUp':
        e.preventDefault()
        setIsListOpen(true)
        setActiveIndex(
          highlightedIndex > 0
            ? highlightedIndex - 1
            : visibleSuggestions.length - 1,
        )
        break
      case 'Enter': {
        const highlighted = visibleSuggestions[highlightedIndex]
        if (showListbox && highlighted !== undefined) {
          e.preventDefault()
          pickSuggestion(highlighted)
        }
        break
      }
      case 'Escape':
        // Only swallow Escape while the list is open so the native
        // type="search" clear-on-Escape still works once it is closed.
        if (showListbox) {
          e.preventDefault()
          closeList()
        }
        break
      default:
        break
    }
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
          // Repo scope follows the ARIA combobox pattern; Name scope stays a
          // plain native searchbox because it never opens a list.
          role={isRepoScope ? 'combobox' : undefined}
          aria-label={copy.ariaLabel}
          aria-autocomplete={isRepoScope ? 'list' : undefined}
          aria-expanded={isRepoScope ? showListbox : undefined}
          aria-controls={showListbox ? listboxId : undefined}
          aria-activedescendant={
            highlightedIndex >= 0 ? optionId(highlightedIndex) : undefined
          }
          autoComplete="off"
          placeholder={copy.placeholder}
          value={searchQuery}
          onChange={handleQueryChange}
          onFocus={openList}
          // Re-clicking the already-focused field (after a pick or Escape)
          // fires no focus event, so click reopens the list too.
          onClick={openList}
          onBlur={closeList}
          onKeyDown={handleKeyDown}
          className="pl-10 bg-background"
        />
        {showListbox && (
          <ul
            id={listboxId}
            role="listbox"
            aria-label="Repository suggestions"
            // preventDefault on the whole list (options, padding, scrollbar)
            // keeps focus in the input so onBlur cannot close it mid-click.
            onMouseDown={(e) => e.preventDefault()}
            className="absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-0 duration-150 motion-reduce:animate-none"
          >
            {visibleSuggestions.map((suggestion, index) => (
              <li
                key={suggestion}
                id={optionId(index)}
                role="option"
                aria-selected={index === highlightedIndex}
                className={cn(
                  'flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm',
                  index === highlightedIndex &&
                    'bg-accent text-accent-foreground',
                )}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => pickSuggestion(suggestion)}
              >
                <span className="min-w-0 truncate">{suggestion}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
