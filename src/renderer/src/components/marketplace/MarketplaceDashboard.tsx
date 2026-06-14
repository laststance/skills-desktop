import { Download, Star, TrendingUp, WifiOff } from 'lucide-react'
import React from 'react'
import { match } from 'ts-pattern'

import { useCycleEffect } from '@/renderer/src/hooks/useCycleEffect'
import { formatInstallCount } from '@/renderer/src/lib/utils'
import { useAppDispatch, useAppSelector } from '@/renderer/src/redux/hooks'
import {
  loadLeaderboard,
  setPreviewSkill,
} from '@/renderer/src/redux/slices/marketplaceSlice'
import type { SkillSearchResult } from '@/shared/types'

import { resolveTrendingView } from './marketplaceDashboardHelpers'

const TRENDING_PREVIEW_LIMIT = 5

/**
 * Dashboard shown in the right pane when Marketplace tab is active
 * and no skill is selected for preview.
 * Data sources: installed skills count, bookmarks count, trending leaderboard cache.
 */
export const MarketplaceDashboard = React.memo(
  function MarketplaceDashboard(): React.ReactElement {
    const dispatch = useAppDispatch()
    const installedCount = useAppSelector((state) => state.skills.items.length)
    const bookmarkedCount = useAppSelector(
      (state) => state.bookmarks.items.length,
    )
    const trendingData = useAppSelector(
      (state) => state.marketplace.leaderboard.trending,
    )
    const trendingSkills = React.useMemo(
      () => trendingData?.skills?.slice(0, TRENDING_PREVIEW_LIMIT) ?? [],
      [trendingData],
    )
    const trendingView = resolveTrendingView(
      trendingSkills.length,
      trendingData?.status,
    )

    // Own the Trending fetch on mount: the only other dispatch site
    // (SkillsMarketplace) requests the user-selected ranking filter, which
    // defaults to 'all-time', so without this the Trending panel's skeleton
    // would never resolve. The thunk's in-flight + cache-TTL guards dedupe the
    // double-mount and skip refetching data that is still fresh.
    useCycleEffect(() => {
      dispatch(loadLeaderboard('trending'))
    }, [dispatch])

    const handleSkillClick = (skill: SkillSearchResult): void => {
      dispatch(setPreviewSkill(skill))
    }

    return (
      <div className="flex-1 flex flex-col p-6 gap-6 overflow-auto">
        <h2 className="text-xl font-bold text-foreground">Marketplace</h2>

        <div className="flex gap-4">
          <div className="flex-1 rounded-lg bg-muted border border-border p-4 flex flex-col gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              Installed Skills
            </span>
            <span className="text-2xl font-semibold tabular-nums text-primary">
              {installedCount}
            </span>
          </div>
          <div className="flex-1 rounded-lg bg-muted border border-border p-4 flex flex-col gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              Bookmarked
            </span>
            <span className="text-2xl font-semibold tabular-nums text-amber-500">
              {bookmarkedCount}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          <h3 className="text-base font-semibold text-foreground">Trending</h3>
          <span className="text-[11px] font-semibold text-primary bg-primary/15 px-2 py-0.5 rounded-full">
            Top {TRENDING_PREVIEW_LIMIT}
          </span>
        </div>

        {match(trendingView)
          .with('populated', () => (
            <div className="flex flex-col gap-2">
              {trendingSkills.map((skill) => (
                <button
                  key={skill.name}
                  type="button"
                  onClick={() => handleSkillClick(skill)}
                  className="flex items-center gap-3 p-3 rounded-lg bg-background border border-border hover:border-primary/50 transition-colors text-left"
                >
                  <div className="flex items-center justify-center w-7 h-7 shrink-0 rounded-md bg-muted font-mono text-[13px] font-semibold text-primary">
                    {skill.rank}
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                    <span className="text-sm font-semibold text-foreground truncate">
                      {skill.name}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground truncate">
                      {skill.repo}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-muted-foreground shrink-0">
                    <Download className="h-3 w-3" />
                    <span className="font-mono text-xs font-medium">
                      {formatInstallCount(skill.installCount)}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          ))
          .with('loading', () => <TrendingSkeleton />)
          .with('error', () => <TrendingError />)
          .with('empty', () => (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              No trending skills available
            </div>
          ))
          .exhaustive()}

        <div className="flex items-center justify-center py-4">
          <p className="text-[13px] text-muted-foreground flex items-center gap-1.5">
            <Star className="h-3.5 w-3.5" />
            Click a skill to view its details
          </p>
        </div>
      </div>
    )
  },
)

/**
 * Fixed five-row placeholder shown while the first Trending fetch is in flight.
 * Mirrors the populated row layout (rank chip, two text lines, a trailing
 * count) so the panel does not reflow when real data lands — a single "Loading…"
 * text line would collapse to one row and make the list jump. Row count is
 * fixed to `TRENDING_PREVIEW_LIMIT` to match the eventual populated height.
 */
const TrendingSkeleton = React.memo(
  function TrendingSkeleton(): React.ReactElement {
    return (
      // role="status" + aria-label keeps the loading state announced to screen
      // readers now that the visible "Loading…" text has become silent pulse bars.
      <div
        className="flex flex-col gap-2"
        role="status"
        aria-label="Loading trending skills"
      >
        {Array.from({ length: TRENDING_PREVIEW_LIMIT }, (_, index) => (
          <div
            key={`trending-skeleton-${index}`}
            aria-hidden
            className="flex items-center gap-3 p-3 rounded-lg bg-background border border-border"
          >
            <div className="w-7 h-7 rounded-md bg-muted animate-pulse shrink-0" />
            <div className="flex-1 min-w-0 flex flex-col gap-0.5">
              <div className="h-4 w-[40%] rounded bg-muted animate-pulse" />
              <div className="h-3 w-[30%] rounded bg-muted animate-pulse" />
            </div>
            <div className="h-3 w-10 rounded bg-muted animate-pulse shrink-0" />
          </div>
        ))}
      </div>
    )
  },
)

/**
 * Offline notice shown when the Trending fetch failed and no cached data exists
 * to fall back on. A network failure is a rare, actionable state, so it earns a
 * fuller icon+heading+hint treatment — vs. the single quiet line used for a
 * genuinely empty leaderboard — per DESIGN.md's empty-state severity scale.
 */
const TrendingError = React.memo(function TrendingError(): React.ReactElement {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center gap-1">
      <WifiOff className="h-6 w-6 text-muted-foreground mb-1" />
      <p className="text-sm font-medium text-foreground">
        Trending unavailable
      </p>
      <p className="text-xs text-muted-foreground">Check your connection</p>
    </div>
  )
})
