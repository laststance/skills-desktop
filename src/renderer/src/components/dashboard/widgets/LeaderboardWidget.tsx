import { AlertCircle, type LucideIcon } from 'lucide-react'
import React, { useEffect } from 'react'

import { useAppDispatch, useAppSelector } from '@/renderer/src/redux/hooks'
import { loadLeaderboard } from '@/renderer/src/redux/slices/marketplaceSlice'
import type { RankingFilter } from '@/shared/types'

import { LeaderboardSkeleton } from './LeaderboardSkeleton'
import { MarketplaceSkillRow } from './MarketplaceSkillRow'

interface LeaderboardWidgetProps {
  /** Which `state.marketplace.leaderboard[*]` slot to read + dispatch for. */
  filter: RankingFilter
  /** Upper bound on rows rendered before the body's `overflow-y-auto` takes over. */
  rowLimit: number
  /** Icon shown in the "no skills" empty state. */
  emptyIcon: LucideIcon
  /** Body copy shown when the leaderboard returned 0 rows. */
  emptyMessage: string
  /** Body copy shown when the load failed AND there's no stale data to fall back to. */
  errorMessage: string
}

/**
 * Shared body for any "scrollable list of marketplace skills filtered by
 * a leaderboard ranking" dashboard widget (Trending, What's New, …).
 *
 * Dispatches `loadLeaderboard(filter)` once on mount. The thunk respects a
 * 30-minute per-filter TTL, so repeated mounts re-use the cached payload —
 * if the Marketplace tab has already loaded this filter, the widget shows
 * data instantly without a duplicate fetch.
 *
 * Background refresh failures are kept silent: the error UI only renders
 * when there's no stale data to fall back on.
 *
 * Rows open the skills.sh URL in the system browser via `<a target="_blank">`.
 */
export const LeaderboardWidget = React.memo(function LeaderboardWidget({
  filter,
  rowLimit,
  emptyIcon: EmptyIcon,
  emptyMessage,
  errorMessage,
}: LeaderboardWidgetProps): React.ReactElement {
  const dispatch = useAppDispatch()
  const leaderboard = useAppSelector(
    (state) => state.marketplace.leaderboard[filter],
  )

  useEffect(() => {
    dispatch(loadLeaderboard(filter))
  }, [dispatch, filter])

  const isInitialLoad =
    !leaderboard ||
    (leaderboard.status === 'loading' && leaderboard.skills.length === 0)

  if (isInitialLoad) {
    return <LeaderboardSkeleton />
  }

  if (leaderboard.status === 'error' && leaderboard.skills.length === 0) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center gap-1 px-4 text-center">
        <AlertCircle
          className="h-5 w-5 text-muted-foreground/60"
          aria-hidden="true"
        />
        <p className="text-xs text-muted-foreground">{errorMessage}</p>
      </div>
    )
  }

  const skills = leaderboard.skills.slice(0, rowLimit)

  if (skills.length === 0) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center gap-1 px-4 text-center">
        <EmptyIcon
          className="h-5 w-5 text-muted-foreground/60"
          aria-hidden="true"
        />
        <p className="text-xs text-muted-foreground">{emptyMessage}</p>
      </div>
    )
  }

  return (
    <div className="h-full w-full overflow-y-auto py-1">
      <ul className="flex flex-col gap-0.5 px-1">
        {skills.map((skill) => (
          <li key={skill.name}>
            <MarketplaceSkillRow skill={skill} />
          </li>
        ))}
      </ul>
    </div>
  )
})
