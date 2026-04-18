import { Check, Download, Plus, Star } from 'lucide-react'
import React from 'react'

import type { SkillSearchResult } from '../../../../shared/types'
import { cn, formatInstallCount } from '../../lib/utils'
import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import {
  addBookmark,
  removeBookmark,
  selectIsBookmarked,
} from '../../redux/slices/bookmarkSlice'
import {
  selectSkillForInstall,
  setPreviewSkill,
} from '../../redux/slices/marketplaceSlice'

interface SkillRowMarketplaceProps {
  skill: SkillSearchResult
  isInstalled?: boolean
}

/**
 * Single skill row in marketplace search results
 * Design: 72px height, rank badge, install count, install button (or installed badge)
 */
export const SkillRowMarketplace = React.memo(function SkillRowMarketplace({
  skill,
  isInstalled = false,
}: SkillRowMarketplaceProps): React.ReactElement {
  const dispatch = useAppDispatch()
  // Narrow selector: only `status` is consumed here, so subscribing to the full
  // marketplace slice would re-render every memoized row whenever search results,
  // leaderboard, or previewSkill changed. Keep this surgical to preserve `React.memo`.
  const status = useAppSelector((state) => state.marketplace.status)
  const isOperating = status === 'installing'
  const isBookmarked = useAppSelector((state) =>
    selectIsBookmarked(state, skill.name),
  )

  const handleRowClick = (): void => {
    dispatch(setPreviewSkill(skill))
  }

  const handleInstall = (): void => {
    dispatch(selectSkillForInstall(skill))
  }

  const handleToggleBookmark = (): void => {
    if (isBookmarked) {
      dispatch(removeBookmark(skill.name))
    } else {
      dispatch(
        addBookmark({ name: skill.name, repo: skill.repo, url: skill.url }),
      )
    }
  }

  return (
    <div className="flex items-center gap-4 p-4 rounded-lg bg-card h-[76px] min-w-0 border border-card hover:border-primary/50 transition-colors">
      {/* Rank Badge + Skill Info — clickable preview area */}
      <button
        type="button"
        onClick={handleRowClick}
        className="flex items-center gap-4 flex-1 min-w-0 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded"
      >
        <div className="flex items-center justify-center w-8 h-8 shrink-0 rounded-md bg-muted font-mono text-sm font-semibold text-primary">
          {skill.rank}
        </div>
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <span className="font-semibold text-[15px] text-foreground truncate">
            {skill.name}
          </span>
          <span className="font-mono text-xs text-muted-foreground truncate">
            {skill.repo}
          </span>
        </div>
      </button>

      {/* Bookmark Toggle */}
      <button
        type="button"
        aria-label={
          isBookmarked
            ? `Remove ${skill.name} from bookmarks`
            : `Bookmark ${skill.name}`
        }
        className="min-h-[44px] min-w-[44px] flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-md"
        onClick={handleToggleBookmark}
      >
        <Star
          className={cn(
            'h-4 w-4 transition-colors',
            isBookmarked
              ? 'fill-amber-500 text-amber-500'
              : 'text-muted-foreground hover:text-amber-500',
          )}
        />
      </button>

      {/* Install Count */}
      <div className="flex items-center gap-1.5 text-muted-foreground shrink-0">
        <Download className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="font-mono text-[13px] font-medium">
          {formatInstallCount(skill.installCount)}
        </span>
      </div>

      {/* Action Button (or Installed badge) */}
      {isInstalled ? (
        // Informational badge, intentionally non-interactive. Uninstall lives in
        // the CLI; the aria-label surfaces that path for screen-reader users
        // since there is no visible affordance. `--global` matches how the app
        // installs (see InstallModal) — without it the CLI's local default fails.
        // `--success` keeps "installed" green across every theme preset; `bg-primary`
        // collapses to grayscale in neutral presets where chroma is 0.
        <div
          role="img"
          aria-label={`${skill.name} is installed. To uninstall, run: npx skills remove ${skill.name} --global`}
          title={`Installed. To uninstall: npx skills remove ${skill.name} --global`}
          className="flex items-center gap-1 px-2 py-1 rounded bg-success/10"
        >
          <Check className="h-3 w-3 text-success" aria-hidden="true" />
          <span className="text-[11px] font-medium text-success">
            Installed
          </span>
        </div>
      ) : (
        /* Install Button */
        <button
          onClick={handleInstall}
          disabled={isOperating}
          className={cn(
            'flex items-center gap-1.5 px-4 py-2 rounded-md min-h-[44px]',
            'bg-primary text-primary-foreground text-[13px] font-semibold',
            'hover:bg-primary/90 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        >
          <Plus className="h-3.5 w-3.5" />
          Install
        </button>
      )}
    </div>
  )
})
