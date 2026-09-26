import { Flame } from 'lucide-react'
import React from 'react'

import { LeaderboardWidget } from './LeaderboardWidget'

/**
 * Trending widget — thin wrapper around `LeaderboardWidget` parameterised
 * for skills.sh's `trending` feed. See `LeaderboardWidget` for the shared
 * cache / loading / error behaviour.
 */
export const TrendingWidget = function TrendingWidget(): React.ReactElement {
  return (
    <LeaderboardWidget
      filter="trending"
      rowLimit={8}
      emptyIcon={Flame}
      emptyMessage="No trending skills yet"
      errorMessage="Couldn't load trending skills"
    />
  )
}
