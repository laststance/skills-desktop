import { Check, Download, Plus, Star, Trash2 } from 'lucide-react'
import React from 'react'

import type { SkillSearchResult } from '../../../../shared/types'
import { cn } from '../../lib/utils'
import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import {
  addBookmark,
  removeBookmark,
  selectIsBookmarked,
} from '../../redux/slices/bookmarkSlice'
import {
  selectSkillForInstall,
  setSkillToRemove,
} from '../../redux/slices/marketplaceSlice'

interface SkillRowMarketplaceProps {
  skill: SkillSearchResult
  isInstalled?: boolean
}

/**
 * Format install count for display (e.g., 72900 -> "72.9K")
 * @param count - Raw install count number
 * @returns Formatted string with K/M suffix
 */
function formatInstallCount(count: number | undefined): string {
  if (!count) return '—'
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}K`
  }
  return count.toString()
}

/**
 * Single skill row in marketplace search results
 * Design: 72px height, rank badge, install count, install/remove buttons
 */
export const SkillRowMarketplace = React.memo(function SkillRowMarketplace({
  skill,
  isInstalled = false,
}: SkillRowMarketplaceProps): React.ReactElement {
  const dispatch = useAppDispatch()
  const { status } = useAppSelector((state) => state.marketplace)
  const isOperating = status === 'installing' || status === 'removing'
  const isBookmarked = useAppSelector((state) =>
    selectIsBookmarked(state, skill.name),
  )

  const handleInstall = (): void => {
    dispatch(selectSkillForInstall(skill))
  }

  const handleRemove = (): void => {
    dispatch(setSkillToRemove(skill.name))
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
      {/* Rank Badge */}
      <div className="flex items-center justify-center w-8 h-8 shrink-0 rounded-md bg-muted font-mono text-sm font-semibold text-primary">
        {skill.rank}
      </div>

      {/* Skill Info */}
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <span className="font-semibold text-[15px] text-foreground truncate">
          {skill.name}
        </span>
        <span className="font-mono text-xs text-muted-foreground truncate">
          {skill.repo}
        </span>
      </div>

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

      {/* Action Buttons */}
      {isInstalled ? (
        <div className="flex items-center gap-3">
          {/* Installed Badge */}
          <div className="flex items-center gap-1 px-2 py-1 rounded bg-primary/10">
            <Check className="h-3 w-3 text-primary" />
            <span className="text-[11px] font-medium text-primary">
              Installed
            </span>
          </div>

          {/* Remove Button */}
          <button
            onClick={handleRemove}
            disabled={isOperating}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2 rounded-md min-h-[44px]',
              'bg-muted border border-destructive',
              'text-destructive text-[13px] font-semibold',
              'hover:bg-muted/80 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Remove
          </button>
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
