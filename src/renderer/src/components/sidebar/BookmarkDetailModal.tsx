import { Check, ExternalLink } from 'lucide-react'
import React, { useCallback } from 'react'

import { Button } from '@/renderer/src/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/renderer/src/components/ui/dialog'
import { Separator } from '@/renderer/src/components/ui/separator'
import { useAppDispatch, useAppSelector } from '@/renderer/src/redux/hooks'
import { removeBookmark } from '@/renderer/src/redux/slices/bookmarkSlice'
import { selectSkillForInstall } from '@/renderer/src/redux/slices/marketplaceSlice'
import {
  clearSelectedBookmarkForDetail,
  selectSelectedBookmarkForDetail,
} from '@/renderer/src/redux/slices/uiSlice'

/**
 * Modal dialog showing bookmark details with install/remove actions.
 * Controlled by uiSlice.selectedBookmarkForDetail (transient, not persisted).
 * @example
 * <BookmarkDetailModal /> // Renders when a bookmark is selected in sidebar
 */
export const BookmarkDetailModal = React.memo(
  function BookmarkDetailModal(): React.ReactElement | null {
    const dispatch = useAppDispatch()
    const bookmark = useAppSelector(selectSelectedBookmarkForDetail)

    const handleClose = useCallback((): void => {
      dispatch(clearSelectedBookmarkForDetail())
    }, [dispatch])

    // Hand off to the shared InstallModal (the exact marketplace install path):
    // close this detail dialog, then open the agent-target picker seeded with
    // this bookmark. No local install state — InstallModal owns progress/errors
    // and refreshes the skill list, so the sidebar's Installed badge updates.
    const handleInstall = useCallback((): void => {
      if (!bookmark || !bookmark.repo) return
      dispatch(
        selectSkillForInstall({ name: bookmark.name, repo: bookmark.repo }),
      )
      dispatch(clearSelectedBookmarkForDetail())
    }, [bookmark, dispatch])

    const handleRemoveBookmark = useCallback((): void => {
      if (!bookmark) return
      dispatch(removeBookmark(bookmark.name))
      handleClose()
    }, [bookmark, dispatch, handleClose])

    const handleOpenChange = useCallback(
      (open: boolean): void => {
        if (!open) handleClose()
      },
      [handleClose],
    )

    const isInstalled = bookmark?.isInstalled ?? false

    return (
      <Dialog open={bookmark !== null} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-sm">
          {bookmark && (
            <>
              <DialogHeader>
                <DialogTitle className="text-base font-semibold">
                  {bookmark.name}
                </DialogTitle>
                <DialogDescription className="sr-only">
                  Bookmark details for {bookmark.name}. Review install status,
                  open the source repository, or remove this bookmark.
                </DialogDescription>
              </DialogHeader>

              {bookmark.repo ? (
                <button
                  type="button"
                  // Excluded from tab order so Radix Dialog auto-focus skips it
                  // (the bright focus ring obscured the repo text on open).
                  tabIndex={-1}
                  onClick={() => {
                    window.electron.shell
                      .openExternal(bookmark.url)
                      .catch(() => {
                        // URL validation failed or shell.openExternal errored
                      })
                  }}
                  className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 text-left focus:outline-none"
                >
                  {bookmark.repo}
                  <ExternalLink className="h-3 w-3" />
                </button>
              ) : (
                <span className="text-sm text-muted-foreground/70">Local</span>
              )}

              <Separator />

              <div className="flex items-center gap-3">
                {isInstalled ? (
                  <span className="text-sm text-emerald-500 flex items-center gap-1">
                    <Check className="h-4 w-4" />
                    Installed
                  </span>
                ) : bookmark.repo ? (
                  <Button onClick={handleInstall}>Install</Button>
                ) : (
                  <span className="text-sm text-muted-foreground">
                    Not installed
                  </span>
                )}
                <Button variant="ghost" onClick={handleRemoveBookmark}>
                  Remove Bookmark
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    )
  },
)
