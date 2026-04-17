import { AlertCircle, Sparkles } from 'lucide-react'
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
const WHATS_NEW_ROW_LIMIT = 8

// skills.sh's "hot" feed is the closest proxy to "recently added or trending
// up" — the product intent for this widget. Reusing the same cache as the
// Marketplace tab's Hot filter means zero duplicate network calls.
const WHATS_NEW_FILTER: RankingFilter = 'hot'

/**
 * What's New widget body.
 *
 * Shows skills from skills.sh's `hot` feed — recently added or rapidly
 * climbing skills. Mirrors `TrendingWidget`'s cache-aware load pattern:
 * dispatches once on mount, re-uses the per-filter cache on subsequent
 * mounts within the 30-minute TTL.
 *
 * Rows open the skills.sh URL in the system browser via `<a target="_blank">`.
 */
export const WhatsNewWidget = React.memo(
  function WhatsNewWidget(): React.ReactElement {
    const dispatch = useAppDispatch()
    const leaderboard = useAppSelector(
      (state) => state.marketplace.leaderboard[WHATS_NEW_FILTER],
    )

    useEffect(() => {
      dispatch(loadLeaderboard(WHATS_NEW_FILTER))
    }, [dispatch])

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
          <p className="text-xs text-muted-foreground">
            Couldn't load new skills
          </p>
        </div>
      )
    }

    const skills = leaderboard.skills.slice(0, WHATS_NEW_ROW_LIMIT)

    if (skills.length === 0) {
      return (
        <div className="h-full w-full flex flex-col items-center justify-center gap-1 px-4 text-center">
          <Sparkles
            className="h-5 w-5 text-muted-foreground/60"
            aria-hidden="true"
          />
          <p className="text-xs text-muted-foreground">Nothing new yet</p>
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
