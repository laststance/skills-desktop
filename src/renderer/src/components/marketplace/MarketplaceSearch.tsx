import { Search, Loader2 } from 'lucide-react'
import React, { useCallback, useState } from 'react'

import { Button } from '@/renderer/src/components/ui/button'
import { Input } from '@/renderer/src/components/ui/input'
import { useAppDispatch, useAppSelector } from '@/renderer/src/redux/hooks'
import {
  searchSkills,
  setMarketplaceSearchQuery,
  clearSearchResults,
} from '@/renderer/src/redux/slices/marketplaceSlice'

/**
 * Search box for finding skills in the marketplace
 */
export const MarketplaceSearch = React.memo(
  function MarketplaceSearch(): React.ReactElement {
    const dispatch = useAppDispatch()
    const { searchQuery, status } = useAppSelector((state) => state.marketplace)
    const [localQuery, setLocalQuery] = useState(searchQuery)
    const isSearching = status === 'searching'

    const handleSearch = useCallback((): void => {
      if (localQuery.trim()) {
        dispatch(setMarketplaceSearchQuery(localQuery.trim()))
        dispatch(searchSkills(localQuery.trim()))
      }
    }, [dispatch, localQuery])

    /** Clear search input and return to leaderboard */
    const handleChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>): void => {
        const value = e.target.value
        setLocalQuery(value)
        // When input is cleared (native X button or manual), reset search state
        if (value === '') {
          dispatch(clearSearchResults())
        }
      },
      [dispatch],
    )

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent): void => {
        if (e.key === 'Enter') {
          handleSearch()
        }
      },
      [handleSearch],
    )

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
            className="pl-10 bg-background h-8"
            disabled={isSearching}
          />
        </div>
        <Button
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
