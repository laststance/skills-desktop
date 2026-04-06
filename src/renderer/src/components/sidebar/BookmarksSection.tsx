import { Bookmark } from 'lucide-react'
import React from 'react'

import { useAppSelector } from '../../redux/hooks'
import { selectBookmarksWithInstallStatus } from '../../redux/selectors'

import { BookmarkDetailModal } from './BookmarkDetailModal'
import { BookmarkItem } from './BookmarkItem'

/**
 * Bookmarks section in the sidebar.
 * Shows bookmarked skills with install/remove actions.
 * Only renders when bookmarks exist.
 */
export const BookmarksSection = React.memo(
  function BookmarksSection(): React.ReactElement {
    const bookmarks = useAppSelector(selectBookmarksWithInstallStatus)

    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 mb-3">
          <Bookmark className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Bookmarks
          </span>
          <span className="text-xs text-muted-foreground">
            ({bookmarks.length})
          </span>
        </div>

        <div className="space-y-1">
          {bookmarks.map((bookmark) => (
            <BookmarkItem key={bookmark.name} bookmark={bookmark} />
          ))}
        </div>

        <BookmarkDetailModal />
      </div>
    )
  },
)
