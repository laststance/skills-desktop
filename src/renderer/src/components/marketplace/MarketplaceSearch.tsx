import { Search, Loader2 } from 'lucide-react'
import React, { useState } from 'react'

import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import {
  searchSkills,
  setSearchQuery,
  clearSearchResults,
} from '../../redux/slices/marketplaceSlice'
import { Button } from '../ui/button'
import { Input } from '../ui/input'

/**
 * Search box for finding skills in the marketplace
 */
export const MarketplaceSearch = React.memo(
  function MarketplaceSearch(): React.ReactElement {
    const dispatch = useAppDispatch()
    const { searchQuery, status } = useAppSelector((state) => state.marketplace)
    const [localQuery, setLocalQuery] = useState(searchQuery)
    const isSearching = status === 'searching'

    const handleSearch = (): void => {
      if (localQuery.trim()) {
        dispatch(setSearchQuery(localQuery.trim()))
        dispatch(searchSkills(localQuery.trim()))
      }
    }

    /** Clear search input and return to leaderboard */
    function handleChange(e: React.ChangeEvent<HTMLInputElement>): void {
      const value = e.target.value
      setLocalQuery(value)
      // When input is cleared (native X button or manual), reset search state
      if (value === '') {
        dispatch(clearSearchResults())
      }
    }

    const handleKeyDown = (e: React.KeyboardEvent): void => {
      if (e.key === 'Enter') {
        handleSearch()
      }
    }

    return (
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search skills (e.g., react, vercel, nextjs)..."
            value={localQuery}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            className="pl-10 bg-background h-11"
            disabled={isSearching}
          />
        </div>
        <Button
          className="h-11"
          onClick={handleSearch}
          disabled={isSearching || !localQuery.trim()}
        >
          {isSearching ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Searching...
            </>
          ) : (
            'Search'
          )}
        </Button>
      </div>
    )
  },
)
