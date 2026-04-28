import { Check, Download, X } from 'lucide-react'
import React from 'react'

import { cn } from '../../lib/utils'
import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import { removeBookmark } from '../../redux/slices/bookmarkSlice'
import { installSkill } from '../../redux/slices/marketplaceSlice'
import type { BookmarkForDetail } from '../../redux/slices/uiSlice'
import { setSelectedBookmarkForDetail } from '../../redux/slices/uiSlice'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

interface BookmarkItemProps {
  bookmark: BookmarkForDetail
}

/**
 * Single bookmarked skill in the sidebar.
 * Shows skill name + repo. "Install" button or "Installed" badge.
 * X button removes from bookmarks.
 */
export const BookmarkItem = React.memo(function BookmarkItem({
  bookmark,
}: BookmarkItemProps): React.ReactElement {
  const dispatch = useAppDispatch()
  const isInstalling = useAppSelector(
    (state) => state.marketplace.status === 'installing',
  )

  const handleInstall = (e: React.MouseEvent): void => {
    e.stopPropagation()
    if (!bookmark.repo) return
    dispatch(
      installSkill({
        repo: bookmark.repo,
        global: true,
        agents: [],
        skills: [bookmark.name],
      }),
    )
  }

  const handleRemove = (e: React.MouseEvent): void => {
    e.stopPropagation()
    dispatch(removeBookmark(bookmark.name))
  }

  const handleClick = (): void => {
    dispatch(setSelectedBookmarkForDetail(bookmark))
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleClick()
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`View details for ${bookmark.name}`}
      className={cn(
        'flex w-full items-center justify-between min-h-11 py-1.5 px-2 rounded-md transition-colors group cursor-pointer hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-sm truncate">{bookmark.name}</span>
            <span className="text-xs text-muted-foreground truncate">
              {bookmark.repo}
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="right">
          <span>{bookmark.url}</span>
        </TooltipContent>
      </Tooltip>

      <div className="flex items-center gap-1 ml-2 shrink-0">
        {bookmark.isInstalled ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                aria-label="Installed"
                className="text-emerald-500 flex items-center justify-center min-h-11 min-w-11"
              >
                <Check className="h-4 w-4" />
              </span>
            </TooltipTrigger>
            <TooltipContent side="left">Installed</TooltipContent>
          </Tooltip>
        ) : (
          <button
            type="button"
            aria-label={`Install ${bookmark.name}`}
            className="min-h-11 min-w-11 flex items-center justify-center text-primary hover:text-primary/80 transition-colors opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            onClick={handleInstall}
            disabled={isInstalling}
          >
            <Download className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          aria-label={`Remove ${bookmark.name} from bookmarks`}
          className="min-h-11 min-w-11 flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          onClick={handleRemove}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
})
