import { Check, Download, X } from 'lucide-react'
import React from 'react'

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/renderer/src/components/ui/tooltip'
import { cn } from '@/renderer/src/lib/utils'
import { useAppDispatch } from '@/renderer/src/redux/hooks'
import { removeBookmark } from '@/renderer/src/redux/slices/bookmarkSlice'
import { selectSkillForInstall } from '@/renderer/src/redux/slices/marketplaceSlice'
import type { BookmarkForDetail } from '@/renderer/src/redux/slices/uiSlice'
import { setSelectedBookmarkForDetail } from '@/renderer/src/redux/slices/uiSlice'

interface BookmarkItemProps {
  bookmark: BookmarkForDetail
}

/**
 * Single bookmarked skill row in the sidebar; opens the detail modal on click.
 * Shows name + repo with an inline "Installed" check or hover-revealed Install.
 * Remove (X) fades in small at the top-right on hover (Sonner-style), sharing
 * the app's canonical remove vocabulary with BookmarksWidget — destructive-tint
 * hover, not a gray box — so the title keeps full width with no permanent slot.
 */
export const BookmarkItem = React.memo(function BookmarkItem({
  bookmark,
}: BookmarkItemProps): React.ReactElement {
  const dispatch = useAppDispatch()

  // Open the shared InstallModal (the exact marketplace install path) seeded
  // with this bookmark, instead of firing a hardcoded universal-only install.
  // stopPropagation keeps the row's own click (open detail modal) from firing.
  const handleInstall = (e: React.MouseEvent): void => {
    e.stopPropagation()
    if (!bookmark.repo) return
    dispatch(
      selectSkillForInstall({ name: bookmark.name, repo: bookmark.repo }),
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
        'relative flex w-full items-center py-1.5 px-2 rounded-md transition-colors group cursor-pointer hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
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
              {/* Non-interactive status glyph — matches SkillItem's linked */}
              {/* check vocabulary (text-success/70), calmer than the X beside it. */}
              <span
                role="img"
                aria-label="Installed"
                className="shrink-0 text-success/70"
              >
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
            </TooltipTrigger>
            <TooltipContent side="left">Installed</TooltipContent>
          </Tooltip>
        ) : (
          <button
            type="button"
            aria-label={`Install ${bookmark.name}`}
            className="shrink-0 flex size-6 items-center justify-center rounded-md text-primary opacity-0 transition-[opacity,background-color,color] hover:bg-primary/10 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={handleInstall}
          >
            <Download className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Sonner-style remove: hidden at rest, fades in small at the top-right */}
      {/* corner on hover/focus (absolute → frees the title's full width). Shares */}
      {/* BookmarksWidget's destructive-tint hover vocabulary; 24px meets WCAG 2.5.8 AA. */}
      <button
        type="button"
        aria-label={`Remove ${bookmark.name} from bookmarks`}
        className="absolute top-1 right-1 flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-[opacity,background-color,color] hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={handleRemove}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
})
