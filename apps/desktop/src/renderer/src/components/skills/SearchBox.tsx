import { Search } from 'lucide-react'
import React, { useId, useState } from 'react'

import { Input } from '@/renderer/src/components/ui/input'
import { cn } from '@/renderer/src/lib/utils'
import { useAppDispatch, useAppSelector } from '@/renderer/src/redux/hooks'
import {
  selectRepoSearchSuggestions,
  type RepoSearchSuggestion,
} from '@/renderer/src/redux/selectors'
import {
  selectSearchQuery,
  setSearchQuery,
} from '@/renderer/src/redux/slices/uiSlice'
import { toSearchQuery } from '@/shared/types'

/**
 * Search Installed skills by name, repository, or description via {@link selectFilteredSkills}.
 * {@link MainContent} mounts this combobox with optional repository completions.
 * @returns Toolbar search control mounted by {@link MainContent}
 * @example
 * <SearchBox />
 */
export const SearchBox = function SearchBox(): React.ReactElement {
  const dispatch = useAppDispatch()
  const searchQuery = useAppSelector(selectSearchQuery)
  const repoSuggestions = useAppSelector(selectRepoSearchSuggestions)
  const listboxId = useId()
  // Listbox visibility + keyboard cursor; -1 means no option is highlighted.
  const [isListOpen, setIsListOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)

  const showListbox = isListOpen && repoSuggestions.length > 0
  // Clamp: the cursor can outlive a list that shrank after a keystroke.
  const highlightedIndex =
    activeIndex < repoSuggestions.length ? activeIndex : -1
  const optionId = (index: number): string => `${listboxId}-option-${index}`

  const openList = (): void => setIsListOpen(searchQuery.trim().length > 0)

  const closeList = (): void => {
    setIsListOpen(false)
    setActiveIndex(-1)
  }

  const pickSuggestion = (suggestion: RepoSearchSuggestion): void => {
    dispatch(setSearchQuery(toSearchQuery(suggestion)))
    closeList()
  }

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    dispatch(setSearchQuery(toSearchQuery(e.target.value)))
    setIsListOpen(e.target.value.trim().length > 0)
    setActiveIndex(-1)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (repoSuggestions.length === 0) return
    switch (e.key) {
      case 'ArrowDown':
        // Wraps to the top after the last option; also reopens a closed list.
        e.preventDefault()
        setIsListOpen(true)
        setActiveIndex(
          highlightedIndex + 1 < repoSuggestions.length
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
            : repoSuggestions.length - 1,
        )
        break
      case 'Enter': {
        const highlighted = repoSuggestions[highlightedIndex]
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
    <div className="relative flex-1 min-w-0">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <Input
        type="search"
        role="combobox"
        aria-label="Search skills by name, repository, or description"
        aria-autocomplete="list"
        aria-expanded={showListbox}
        aria-controls={showListbox ? listboxId : undefined}
        aria-activedescendant={
          highlightedIndex >= 0 ? optionId(highlightedIndex) : undefined
        }
        autoComplete="off"
        placeholder="Search by name, repository, or description..."
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
          {repoSuggestions.map((suggestion, index) => (
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
  )
}
