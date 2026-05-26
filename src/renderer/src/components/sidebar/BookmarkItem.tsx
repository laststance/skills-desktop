import { Check, Download, X } from 'lucide-react'
import React from 'react'

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/renderer/src/components/ui/tooltip'
import { cn } from '@/renderer/src/lib/utils'
import { useAppDispatch, useAppSelector } from '@/renderer/src/redux/hooks'
import { removeBookmark } from '@/renderer/src/redux/slices/bookmarkSlice'
import { installSkill } from '@/renderer/src/redux/slices/marketplaceSlice'
import type { BookmarkForDetail } from '@/renderer/src/redux/slices/uiSlice'
import { setSelectedBookmarkForDetail } from '@/renderer/src/redux/slices/uiSlice'

interface BookmarkItemProps {
  bookmark: BookmarkForDetail
}

/**
 * Single bookmarked skill row in the sidebar; opens the detail modal on click.
 * Shows name + repo with an inline "Installed" check or hover-revealed Install.
 * Remove (X) sits small in the top-right corner and fades in on hover
 * (Sonner-style), keeping the resting row uncluttered so the title gets the
 * widest possible space instead of a permanent 44px button slot.
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
        'relative flex w-full items-center min-h-11 py-1.5 px-2 rounded-md transition-colors group cursor-pointer hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      {/* pr-7 reserves the top-right strip for the absolute Remove (X) below, */}
      {/* so it never overlaps the title/status and the row doesn't shift on hover. */}
      <div className="flex min-w-0 flex-1 items-center gap-2 pr-7">
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

        {bookmark.isInstalled ? (
          <Tooltip>
            <TooltipTrigger asChild>
              {/* Inline 16px status glyph — the row itself is the 44px hit */}
              {/* target, so no padded button wrapper (DESIGN.md L295-297). */}
              <span
                aria-label="Installed"
                className="shrink-0 text-emerald-500"
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
            className="shrink-0 flex h-6 w-6 items-center justify-center rounded-md text-primary opacity-0 transition hover:bg-accent hover:text-primary/80 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={handleInstall}
            disabled={isInstalling}
          >
            <Download className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Sonner-style remove: hidden at rest, fades in small at the top-right */}
      {/* corner on row hover/focus. Absolute → frees the title's full width. */}
      <button
        type="button"
        aria-label={`Remove ${bookmark.name} from bookmarks`}
        className="absolute top-1 right-1 flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition hover:bg-accent hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={handleRemove}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
})
