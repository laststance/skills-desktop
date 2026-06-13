import { Search, Loader2 } from 'lucide-react'
import React, { useCallback, useState } from 'react'

import { Input } from '@/renderer/src/components/ui/input'
import { useDebouncedCallback } from '@/renderer/src/hooks/useDebouncedCallback'
import { useAppDispatch, useAppSelector } from '@/renderer/src/redux/hooks'
import {
  searchSkills,
  setMarketplaceSearchQuery,
  clearSearchResults,
} from '@/renderer/src/redux/slices/marketplaceSlice'
import { SEARCH_DEBOUNCE_MS } from '@/shared/constants'

/**
 * Incremental search box for the marketplace. Searches as the user types: each
 * keystroke updates a local value instantly and fires a debounced remote
 * `skills find` call, and committing the query flips the panel from leaderboard
 * to results. Deliberately button-less — incremental search means there is
 * nothing to click, matching the skills-tab `SearchBox` and DESIGN.md "Polish
 * by subtraction first".
 */
export const MarketplaceSearch = React.memo(
  function MarketplaceSearch(): React.ReactElement {
    const dispatch = useAppDispatch()
    const { searchQuery, status } = useAppSelector((state) => state.marketplace)
    // Local value drives the input for instant typing feedback; the debounced
    // callback drives the actual (expensive, IPC-bound) remote search.
    const [localQuery, setLocalQuery] = useState(searchQuery)
    const isSearching = status === 'searching'

    // Fire the remote search for a settled query. Committing the query to Redux
    // (setMarketplaceSearchQuery) and dispatching the search together keeps the
    // view switch (hasSearched) and the 'searching' status atomic, so the
    // results pane never flashes "no results" while the user is mid-type.
    const runSearch = useCallback(
      (query: string): void => {
        const trimmedQuery = query.trim()
        if (trimmedQuery === '') return
        dispatch(setMarketplaceSearchQuery(trimmedQuery))
        dispatch(searchSkills(trimmedQuery))
      },
      [dispatch],
    )
    const debouncedSearch = useDebouncedCallback(runSearch, SEARCH_DEBOUNCE_MS)

    const handleChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>): void => {
        const value = e.target.value
        setLocalQuery(value)
        if (value.trim() === '') {
          // Clearing the box snaps back to the leaderboard immediately and
          // cancels the search that was about to fire for the prior keystrokes.
          debouncedSearch.cancel()
          dispatch(clearSearchResults())
        } else {
          debouncedSearch.run(value)
        }
      },
      [dispatch, debouncedSearch],
    )

    return (
      <div className="relative">
        {/* Left icon morphs to a spinner while a search is in flight — conveys
            loading without a separate control or layout shift. */}
        {isSearching ? (
          <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        )}
        <Input
          type="search"
          placeholder="Search skills (e.g., react, vercel, nextjs)..."
          value={localQuery}
          onChange={handleChange}
          className="pl-10 bg-background h-8"
          aria-label="Search marketplace skills"
        />
      </div>
    )
  },
)
