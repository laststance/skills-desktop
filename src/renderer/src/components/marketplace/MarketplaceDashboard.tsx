import { Download, Star, TrendingUp } from 'lucide-react'
import React from 'react'

import type { SkillSearchResult } from '../../../../shared/types'
import { formatInstallCount } from '../../lib/utils'
import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import { setPreviewSkill } from '../../redux/slices/marketplaceSlice'

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
    const trendingSkills = trendingData?.skills?.slice(0, 5) ?? []

    const handleSkillClick = (skill: SkillSearchResult): void => {
      dispatch(setPreviewSkill(skill))
    }

    return (
      <div className="flex-1 flex flex-col p-6 gap-6 overflow-auto">
        <h2 className="text-xl font-bold text-foreground">Marketplace</h2>

        {/* Stats cards */}
        <div className="flex gap-4">
          <div className="flex-1 rounded-lg bg-muted border border-border p-4 flex flex-col gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              Installed Skills
            </span>
            <span className="text-3xl font-bold text-primary">
              {installedCount}
            </span>
          </div>
          <div className="flex-1 rounded-lg bg-muted border border-border p-4 flex flex-col gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              Bookmarked
            </span>
            <span className="text-3xl font-bold text-amber-500">
              {bookmarkedCount}
            </span>
          </div>
        </div>

        {/* Trending section */}
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          <h3 className="text-base font-semibold text-foreground">Trending</h3>
          <span className="text-[11px] font-semibold text-primary bg-primary/15 px-2 py-0.5 rounded-full">
            Top 5
          </span>
        </div>

        {trendingSkills.length > 0 ? (
          <div className="flex flex-col gap-2">
            {trendingSkills.map((skill) => (
              <button
                key={skill.name}
                type="button"
                onClick={() => handleSkillClick(skill)}
                className="flex items-center gap-3 p-3 rounded-lg bg-background border border-border hover:border-primary/50 transition-colors text-left min-h-[44px]"
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
        ) : (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            Loading trending skills...
          </div>
        )}

        {/* Browse prompt */}
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
