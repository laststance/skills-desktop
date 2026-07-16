import { Sparkles } from 'lucide-react'
import React from 'react'

import { LeaderboardWidget } from './LeaderboardWidget'

/**
 * What's New widget — thin wrapper around `LeaderboardWidget` parameterised
 * for skills.sh's `hot` feed (the closest proxy to "recently added or
 * climbing"). See `LeaderboardWidget` for the shared cache / loading /
 * error behaviour.
 */
export const WhatsNewWidget = function WhatsNewWidget(): React.ReactElement {
  return (
    <LeaderboardWidget
      filter="hot"
      rowLimit={8}
      emptyIcon={Sparkles}
      emptyMessage="Nothing new yet"
      errorMessage="Couldn't load new skills"
    />
  )
}
