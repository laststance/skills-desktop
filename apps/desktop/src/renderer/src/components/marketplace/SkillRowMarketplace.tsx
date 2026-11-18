import { Check, Download, Plus, Star } from 'lucide-react'
import React from 'react'

import { cn, formatInstallCount } from '@/renderer/src/lib/utils'
import { useAppDispatch, useAppSelector } from '@/renderer/src/redux/hooks'
import {
  addBookmark,
  removeBookmark,
  selectIsBookmarked,
} from '@/renderer/src/redux/slices/bookmarkSlice'
import {
  selectSkillForInstall,
  setPreviewSkill,
} from '@/renderer/src/redux/slices/marketplaceSlice'
import type { SkillSearchResult } from '@/shared/types'

interface SkillRowMarketplaceProps {
  skill: SkillSearchResult
  isInstalled?: boolean
}

/**
 * Displays a search result or leaderboard entry with preview, bookmark and install controls.
 * Narrow Marketplace panes give the name and repository their own line.
 */
export const SkillRowMarketplace = function SkillRowMarketplace({
  skill,
  isInstalled = false,
}: SkillRowMarketplaceProps): React.ReactElement {
  const dispatch = useAppDispatch()
  // Narrow selector: only `status` is consumed here, so subscribing to the full
  // marketplace slice would re-render every row whenever search results,
  // leaderboard, or previewSkill changed. Keep this selector surgical.
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
    <div className="@container min-w-0">
      <div
        className={cn(
          'grid min-h-19 grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-card bg-card p-3 hover:border-primary/50 transition-colors',
          // Keep the wide list's bookmark, count and action columns aligned across rows.
          '@min-[30rem]:grid-cols-[minmax(0,1fr)_1.75rem_5rem_8rem] @min-[30rem]:gap-4 @min-[30rem]:p-4',
        )}
      >
        <button
          type="button"
          onClick={handleRowClick}
          className="col-span-full @min-[30rem]:col-span-1 flex items-center gap-2 @min-[30rem]:gap-4 min-w-0 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded"
        >
          <div className="flex items-center justify-center w-8 h-8 shrink-0 rounded-md bg-muted font-mono text-sm font-semibold text-primary">
            {skill.rank}
          </div>
          <div className="flex-1 min-w-0 flex flex-col gap-1">
            <span className="font-semibold text-[15px] text-foreground line-clamp-2 leading-snug break-words">
              {skill.name}
            </span>
            <span className="font-mono text-xs text-muted-foreground truncate">
              {skill.repo}
            </span>
          </div>
        </button>

        <button
          type="button"
          aria-label={
            isBookmarked
              ? `Remove ${skill.name} from bookmarks`
              : `Bookmark ${skill.name}`
          }
          className="min-h-7 min-w-7 flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-md"
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

        <div className="flex items-center justify-end gap-1.5 text-muted-foreground shrink-0">
          <Download className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-mono text-[13px] font-medium">
            {formatInstallCount(skill.installCount)}
          </span>
        </div>

        <div className="flex justify-end">
          {isInstalled ? (
            // Informational badge, intentionally non-interactive. Uninstall lives in
            // the CLI; the aria-label surfaces that path for screen-reader users
            // since there is no visible affordance. `--global` matches how the app
            // installs (see InstallModal) — without it the CLI's local default fails.
            // `--success` keeps "installed" green across every theme preset; `bg-primary`
            // collapses to grayscale in neutral presets where chroma is 0.
            <div
              // react-doctor-disable-next-line react-doctor/prefer-tag-over-role -- composite installed badge (Check icon + text) with a rich aria-label. <img> needs a src and cannot contain children.
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
              type="button"
              onClick={handleInstall}
              disabled={isOperating}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md min-h-8',
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
      </div>
    </div>
  )
}
