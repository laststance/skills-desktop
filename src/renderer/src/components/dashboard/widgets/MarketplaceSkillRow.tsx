import { Download } from 'lucide-react'
import React from 'react'

import type { SkillSearchResult } from '../../../../../shared/types'
import { formatInstallCount } from '../../../lib/utils'

interface MarketplaceSkillRowProps {
  skill: SkillSearchResult
}

/**
 * Compact marketplace row used inside the Trending and What's New dashboard
 * widgets. Shorter than the main marketplace tab row so more skills fit in
 * the widget body without scrolling.
 *
 * The entire row is a single `<a target="_blank">` so a click anywhere opens
 * the skills.sh URL in the system browser — the main process's
 * `setWindowOpenHandler` routes new-window requests through
 * `shell.openExternal`, so no IPC call is needed.
 */
export const MarketplaceSkillRow = React.memo(function MarketplaceSkillRow({
  skill,
}: MarketplaceSkillRowProps): React.ReactElement {
  return (
    <a
      href={skill.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open ${skill.name} from ${skill.repo} in browser`}
      className="
        group flex items-center gap-2 px-2 py-1.5 rounded-md
        hover:bg-muted transition-colors focus-visible:outline-none
        focus-visible:ring-2 focus-visible:ring-ring
      "
    >
      <span
        className="
          shrink-0 inline-flex items-center justify-center
          w-5 h-5 rounded bg-muted font-mono text-[10px]
          font-semibold text-primary group-hover:bg-background
          tabular-nums
        "
        aria-hidden="true"
      >
        {skill.rank}
      </span>
      <span className="flex-1 min-w-0 flex flex-col">
        <span className="truncate text-xs font-medium text-foreground">
          {skill.name}
        </span>
        <span className="truncate font-mono text-[10px] text-muted-foreground">
          {skill.repo}
        </span>
      </span>
      <span className="shrink-0 inline-flex items-center gap-0.5 text-[11px] tabular-nums text-muted-foreground">
        <Download className="h-3 w-3" aria-hidden="true" />
        {formatInstallCount(skill.installCount)}
      </span>
    </a>
  )
})
