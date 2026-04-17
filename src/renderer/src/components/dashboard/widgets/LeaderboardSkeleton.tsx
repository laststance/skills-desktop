import React from 'react'

/**
 * Loading skeleton for leaderboard widgets (Trending, What's New).
 *
 * Three placeholder rows that roughly match the `MarketplaceSkillRow` silhouette:
 * a small rank square, two stacked text bars, and a right-aligned count bar.
 * Keeps layout stable while the first fetch is in flight so the widget
 * doesn't pop in and jostle neighboring widgets.
 */
export const LeaderboardSkeleton = React.memo(
  function LeaderboardSkeleton(): React.ReactElement {
    return (
      <div className="h-full w-full py-1 px-1" aria-hidden="true">
        <div className="flex flex-col gap-0.5">
          {Array.from({ length: 3 }).map((_item, index) => (
            <div
              key={index}
              className="flex items-center gap-2 px-2 py-1.5 rounded-md"
            >
              <div className="w-5 h-5 rounded bg-muted animate-pulse" />
              <div className="flex-1 min-w-0 flex flex-col gap-1">
                <div className="h-2.5 w-24 rounded bg-muted animate-pulse" />
                <div className="h-2 w-16 rounded bg-muted/60 animate-pulse" />
              </div>
              <div className="w-8 h-2.5 rounded bg-muted animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    )
  },
)
