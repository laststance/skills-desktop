import React from 'react'

/**
 * Skeleton loading state for the leaderboard.
 * 6 pulsing rows matching the 76px height of SkillRowMarketplace.
 */
export const LeaderboardSkeleton = React.memo(
  function LeaderboardSkeleton(): React.ReactElement {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 6 }, (_, i) => (
          <div
            key={i}
            className="rounded-lg bg-card p-4 flex items-center gap-4 h-[76px]"
          >
            {/* Rank square */}
            <div className="h-8 w-8 rounded bg-muted animate-pulse shrink-0" />
            {/* Name + repo */}
            <div className="flex-1 space-y-2">
              <div
                className="h-4 bg-muted animate-pulse rounded"
                style={{ width: '40%' }}
              />
              <div
                className="h-3 bg-muted animate-pulse rounded"
                style={{ width: '30%' }}
              />
            </div>
            {/* Install count */}
            <div className="h-4 w-12 bg-muted animate-pulse rounded shrink-0" />
            {/* Button placeholder */}
            <div className="h-8 w-20 bg-muted animate-pulse rounded shrink-0" />
          </div>
        ))}
      </div>
    )
  },
)
