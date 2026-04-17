import { AlertCircle, Flame } from 'lucide-react'
import React, { useEffect } from 'react'

import type { RankingFilter } from '../../../../../shared/types'
import { useAppDispatch, useAppSelector } from '../../../redux/hooks'
import { loadLeaderboard } from '../../../redux/slices/marketplaceSlice'

import { LeaderboardSkeleton } from './LeaderboardSkeleton'
import { MarketplaceSkillRow } from './MarketplaceSkillRow'

/**
 * Upper bound on rows rendered inside the widget.
 * The body is `overflow-y-auto`, so extras scroll rather than clip — this
 * limit just keeps the initial render cheap.
 */
const TRENDING_ROW_LIMIT = 8

const TRENDING_FILTER: RankingFilter = 'trending'

/**
 * Trending widget body.
 *
 * Dispatches `loadLeaderboard('trending')` once on mount. The thunk respects
 * a 30-minute per-filter TTL, so repeated mounts (e.g., when the user flips
 * back to the Discovery page) re-use the cached payload without hitting the
 * network. If the Marketplace tab has already loaded trending data, this
 * widget shows it instantly — no duplicate fetch.
 *
 * Rows open the skills.sh URL in the system browser via `<a target="_blank">`.
 */
export const TrendingWidget = React.memo(
  function TrendingWidget(): React.ReactElement {
    const dispatch = useAppDispatch()
    const leaderboard = useAppSelector(
      (state) => state.marketplace.leaderboard[TRENDING_FILTER],
    )

    useEffect(() => {
      dispatch(loadLeaderboard(TRENDING_FILTER))
    }, [dispatch])

    // Nothing in the cache yet, or still fetching the very first payload.
    const isInitialLoad =
      !leaderboard ||
      (leaderboard.status === 'loading' && leaderboard.skills.length === 0)

    if (isInitialLoad) {
      return <LeaderboardSkeleton />
    }

    // Fatal error state only when we have no stale data to fall back on.
    // When stale data exists, we render it silently — background refresh
    // failures shouldn't interrupt the user.
    if (leaderboard.status === 'error' && leaderboard.skills.length === 0) {
      return (
        <div className="h-full w-full flex flex-col items-center justify-center gap-1 px-4 text-center">
          <AlertCircle
            className="h-5 w-5 text-muted-foreground/60"
            aria-hidden="true"
          />
          <p className="text-xs text-muted-foreground">
            Couldn't load trending skills
          </p>
        </div>
      )
    }

    const skills = leaderboard.skills.slice(0, TRENDING_ROW_LIMIT)

    if (skills.length === 0) {
      return (
        <div className="h-full w-full flex flex-col items-center justify-center gap-1 px-4 text-center">
          <Flame
            className="h-5 w-5 text-muted-foreground/60"
            aria-hidden="true"
          />
          <p className="text-xs text-muted-foreground">
            No trending skills yet
          </p>
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
  },
)
