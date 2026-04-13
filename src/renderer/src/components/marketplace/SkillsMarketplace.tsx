import { Package, WifiOff } from 'lucide-react'
import React, { useEffect, useMemo, useState } from 'react'

import type { RankingFilter } from '../../../../shared/types'
import { useMarketplaceProgress } from '../../hooks/useMarketplaceProgress'
import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import { loadLeaderboard } from '../../redux/slices/marketplaceSlice'

import { InstallModal } from './InstallModal'
import { LeaderboardSkeleton } from './LeaderboardSkeleton'
import { MarketplaceSearch } from './MarketplaceSearch'
import { RankingTabs } from './RankingTabs'
import { RemoveDialog } from './RemoveDialog'
import { SkillRowMarketplace } from './SkillRowMarketplace'

/**
 * Format a timestamp into relative time for the "Updated X min ago" label.
 * @param timestamp - ms since epoch
 * @returns Human-readable relative time string
 * @example
 * formatUpdatedAgo(Date.now() - 60000) // => "1 min ago"
 * formatUpdatedAgo(Date.now() - 900000) // => "15 min ago"
 */
function formatUpdatedAgo(timestamp: number): string {
  if (timestamp === 0) return ''
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ago`
}

/**
 * Main marketplace container with ranking tabs, search, leaderboard, and results.
 * Shows leaderboard data when no search is active.
 * Auto-loads "all-time" leaderboard on mount.
 */
export const SkillsMarketplace = React.memo(
  function SkillsMarketplace(): React.ReactElement {
    // Subscribe to installation progress events
    useMarketplaceProgress()

    const dispatch = useAppDispatch()
    const [rankingFilter, setRankingFilter] =
      useState<RankingFilter>('all-time')

    const { searchResults, status, searchQuery, error, leaderboard } =
      useAppSelector((state) => state.marketplace)
    const { items: installedSkills } = useAppSelector((state) => state.skills)

    // Check if a skill is already installed
    const installedSkillNames = useMemo(
      () => new Set(installedSkills.map((s) => s.name)),
      [installedSkills],
    )

    const hasSearched = searchQuery.length > 0
    const isSearching = status === 'searching'

    // Current leaderboard data for active filter
    const currentLeaderboard = leaderboard[rankingFilter]
    const leaderboardSkills = currentLeaderboard?.skills ?? []
    const leaderboardStatus = currentLeaderboard?.status ?? 'idle'
    const leaderboardLastFetched = currentLeaderboard?.lastFetched ?? 0
    const isLeaderboardLoading =
      leaderboardStatus === 'loading' && leaderboardSkills.length === 0
    const isLeaderboardError =
      leaderboardStatus === 'error' && leaderboardSkills.length === 0

    // Auto-load leaderboard on mount and when filter changes
    useEffect(() => {
      dispatch(loadLeaderboard(rankingFilter))
    }, [dispatch, rankingFilter])

    /** Handle tab change: switch filter and load data */
    const handleFilterChange = (filter: RankingFilter): void => {
      setRankingFilter(filter)
    }

    return (
      <div className="h-full flex flex-col">
        {/* Header with Title and Search */}
        <div className="p-6 pb-4 space-y-4">
          {/* Title */}
          <div>
            <h1 className="text-[28px] font-bold text-foreground">
              Skills Marketplace
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Browse, search and install skills from skills.sh
            </p>
          </div>

          {/* Ranking Tabs */}
          <RankingTabs
            value={rankingFilter}
            onChange={handleFilterChange}
            disabled={hasSearched}
          />

          {/* Search */}
          <MarketplaceSearch />
        </div>

        {/* Error display */}
        {error && (
          <div className="mx-6 mb-4 px-4 py-2 bg-destructive/10 border border-destructive/20 rounded-md">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {/* Results area */}
        <div className="flex-1 overflow-y-auto px-6">
          <div
            className="pb-6 min-w-0"
            aria-busy={isLeaderboardLoading || isSearching}
            aria-live="polite"
          >
            {/* === Search results (takes priority over leaderboard) === */}
            {hasSearched && (
              <>
                {/* Loading state */}
                {isSearching && (
                  <div className="flex items-center justify-center py-16">
                    <div className="text-muted-foreground">Searching...</div>
                  </div>
                )}

                {/* No results */}
                {!isSearching && searchResults.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <p className="text-muted-foreground">
                      No skills found for &quot;{searchQuery}&quot;
                    </p>
                    <p className="text-sm text-muted-foreground mt-2">
                      Try a different search term
                    </p>
                  </div>
                )}

                {/* Results list */}
                {searchResults.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <p className="text-sm text-muted-foreground mb-3">
                      Found {searchResults.length} skill
                      {searchResults.length !== 1 ? 's' : ''} for &quot;
                      {searchQuery}
                      &quot;
                    </p>
                    {searchResults.map((skill) => (
                      <SkillRowMarketplace
                        key={`${skill.repo}@${skill.name}`}
                        skill={skill}
                        isInstalled={installedSkillNames.has(skill.name)}
                      />
                    ))}
                  </div>
                )}
              </>
            )}

            {/* === Leaderboard (shown when no search is active) === */}
            {!hasSearched && (
              <>
                {/* Skeleton loading */}
                {isLeaderboardLoading && <LeaderboardSkeleton />}

                {/* Network error with no cache */}
                {isLeaderboardError && (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <WifiOff className="h-12 w-12 text-muted-foreground mb-4" />
                    <p className="text-lg font-medium mb-2">
                      Leaderboard unavailable
                    </p>
                    <p className="text-sm text-muted-foreground max-w-md">
                      Check your connection and try again
                    </p>
                  </div>
                )}

                {/* Leaderboard data */}
                {leaderboardSkills.length > 0 && (
                  <div className="flex flex-col gap-2">
                    {/* Header: count + filter label (left) + updated timestamp (right) */}
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-sm text-muted-foreground">
                        {leaderboardSkills.length} skill
                        {leaderboardSkills.length !== 1
                          ? 's'
                          : ''} &middot;{' '}
                        {rankingFilter === 'all-time'
                          ? 'All Time'
                          : rankingFilter === 'trending'
                            ? 'Trending'
                            : 'Hot'}
                      </p>
                      {leaderboardLastFetched > 0 && (
                        <p className="font-mono text-xs text-muted-foreground">
                          Updated {formatUpdatedAgo(leaderboardLastFetched)}
                        </p>
                      )}
                    </div>
                    {leaderboardSkills.map((skill) => (
                      <SkillRowMarketplace
                        key={`${skill.repo}@${skill.name}`}
                        skill={skill}
                        isInstalled={installedSkillNames.has(skill.name)}
                      />
                    ))}
                  </div>
                )}

                {/* Edge case: fetch succeeded but returned 0 skills */}
                {!isLeaderboardLoading &&
                  !isLeaderboardError &&
                  leaderboardSkills.length === 0 &&
                  leaderboardLastFetched > 0 && (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                      <Package className="h-12 w-12 text-muted-foreground mb-4" />
                      <p className="text-lg font-medium mb-2">
                        No skills found
                      </p>
                      <p className="text-sm text-muted-foreground max-w-md">
                        The leaderboard is temporarily empty. Try again later.
                      </p>
                    </div>
                  )}
              </>
            )}
          </div>
        </div>

        {/* Modals */}
        <InstallModal />
        <RemoveDialog />
      </div>
    )
  },
)
