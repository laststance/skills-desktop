import { Bookmark, ExternalLink, X } from 'lucide-react'
import React from 'react'

import type { BookmarkedSkill, SkillName } from '../../../../../shared/types'
import { useAppDispatch, useAppSelector } from '../../../redux/hooks'
import {
  removeBookmark,
  selectBookmarkItems,
} from '../../../redux/slices/bookmarkSlice'

// ----------------------------------------------------------------------------
// BookmarkRow — single saved skill entry with open + remove affordances.
// Extracted so the scroll list can stay trivially readable.
// ----------------------------------------------------------------------------

interface BookmarkRowProps {
  bookmark: BookmarkedSkill
  onRemove: (name: SkillName) => void
}

const BookmarkRow = React.memo(function BookmarkRow({
  bookmark,
  onRemove,
}: BookmarkRowProps): React.ReactElement {
  return (
    <li className="group flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted">
      <Bookmark className="h-3 w-3 shrink-0 text-primary" aria-hidden="true" />
      <a
        href={bookmark.url}
        target="_blank"
        rel="noopener noreferrer"
        className="
          flex-1 min-w-0 inline-flex items-center gap-1 text-xs
          text-foreground hover:text-primary focus-visible:outline-none
          focus-visible:ring-2 focus-visible:ring-ring rounded
        "
      >
        <span className="truncate font-medium">{bookmark.name}</span>
        {bookmark.repo && (
          <span className="truncate text-muted-foreground">
            {bookmark.repo}
          </span>
        )}
        <ExternalLink
          className="h-2.5 w-2.5 shrink-0 opacity-0 group-hover:opacity-60 transition-opacity"
          aria-hidden="true"
        />
      </a>
      <button
        type="button"
        onClick={() => onRemove(bookmark.name)}
        aria-label={`Remove bookmark ${bookmark.name}`}
        // 44×44 hit area per HIG — the visible X stays small so it doesn't
        // dominate the row; opacity-0 until hover mirrors the SkillItem pattern.
        className="
          min-h-[44px] min-w-[44px] flex items-center justify-center
          rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10
          opacity-0 group-hover:opacity-100 focus-visible:opacity-100
          transition-opacity
        "
      >
        <X className="h-3 w-3" aria-hidden="true" />
      </button>
    </li>
  )
})

/**
 * Bookmarks widget body.
 *
 * Lists the user's saved marketplace skills. Each row opens the source URL
 * in the system browser (the main process's setWindowOpenHandler routes
 * `<a target="_blank">` through `shell.openExternal`, so no IPC needed).
 * Remove button pulls the entry out of the persisted bookmarks slice.
 *
 * Rendering the empty state inline rather than hiding the whole widget
 * keeps the dashboard layout stable — the user's grid position is preserved
 * even before they've saved anything.
 */
export const BookmarksWidget = React.memo(
  function BookmarksWidget(): React.ReactElement {
    const dispatch = useAppDispatch()
    const bookmarks = useAppSelector(selectBookmarkItems)

    const handleRemove = (name: SkillName): void => {
      dispatch(removeBookmark(name))
    }

    if (bookmarks.length === 0) {
      return (
        <div className="h-full w-full flex flex-col items-center justify-center gap-1 px-4 text-center">
          <Bookmark
            className="h-5 w-5 text-muted-foreground/60"
            aria-hidden="true"
          />
          <p className="text-xs text-muted-foreground">
            Saved marketplace skills land here.
          </p>
        </div>
      )
    }

    return (
      <div className="h-full w-full overflow-y-auto py-1">
        <ul className="flex flex-col gap-0.5 px-1">
          {bookmarks.map((bookmark) => (
            <BookmarkRow
              key={bookmark.name}
              bookmark={bookmark}
              onRemove={handleRemove}
            />
          ))}
        </ul>
      </div>
    )
  },
)
