import { Bookmark } from 'lucide-react'
import React from 'react'

import { ALL_CATEGORIES } from '@/renderer/src/redux/bookmarkCategories'
import { useAppSelector } from '@/renderer/src/redux/hooks'
import { selectSidebarBookmarks } from '@/renderer/src/redux/selectors'

import {
  BookmarkCategoryFilter,
  EmptyCategoryFilter,
} from '../bookmarks/BookmarkCategoryFilter'

import { BookmarkDetailModal } from './BookmarkDetailModal'
import { BookmarkItem } from './BookmarkItem'

/**
 * Bookmarks section in the sidebar.
 * Shows bookmarked skills with install/remove actions.
 * Only renders when bookmarks exist.
 */
export const BookmarksSection =
  function BookmarksSection(): React.ReactElement {
    const bookmarks = useAppSelector(selectSidebarBookmarks)
    const hasCategoryFilter = useAppSelector(
      (state) => state.ui.sidebarCategoryFilter !== ALL_CATEGORIES,
    )

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

        <BookmarkCategoryFilter surface="sidebar" />
        <div className="space-y-1">
          {bookmarks.length === 0 &&
            (hasCategoryFilter ? (
              <EmptyCategoryFilter surface="sidebar" />
            ) : (
              <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                Save a skill from Installed to find it here.
              </p>
            ))}
          {bookmarks.map((bookmark) => (
            <BookmarkItem key={bookmark.name} bookmark={bookmark} />
          ))}
        </div>

        <BookmarkDetailModal />
      </div>
    )
  }
