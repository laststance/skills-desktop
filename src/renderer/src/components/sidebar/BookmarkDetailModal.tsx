import { Check, ExternalLink, Loader2 } from 'lucide-react'
import React, { useRef, useState } from 'react'

import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import { removeBookmark } from '../../redux/slices/bookmarkSlice'
import { installSkill } from '../../redux/slices/marketplaceSlice'
import { fetchSkills } from '../../redux/slices/skillsSlice'
import {
  clearSelectedBookmarkForDetail,
  selectSelectedBookmarkForDetail,
} from '../../redux/slices/uiSlice'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog'
import { Separator } from '../ui/separator'

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
    const [isInstalling, setIsInstalling] = useState(false)
    const [installSuccess, setInstallSuccess] = useState(false)
    const [installError, setInstallError] = useState<string | null>(null)
    // Generation counter: invalidates in-flight installs when modal closes/reopens
    const installGenRef = useRef(0)

    const handleClose = (): void => {
      installGenRef.current++
      dispatch(clearSelectedBookmarkForDetail())
      setIsInstalling(false)
      setInstallSuccess(false)
      setInstallError(null)
    }

    const handleInstall = async (): Promise<void> => {
      if (!bookmark) return
      const gen = ++installGenRef.current
      setIsInstalling(true)
      setInstallError(null)
      try {
        const success = await dispatch(
          installSkill({
            repo: bookmark.repo,
            global: true,
            agents: [],
            skills: [bookmark.name],
          }),
        ).unwrap()
        if (gen !== installGenRef.current) return
        if (success) {
          setInstallSuccess(true)
          dispatch(fetchSkills())
        } else {
          setInstallError('Installation did not complete successfully')
        }
      } catch (err) {
        if (gen !== installGenRef.current) return
        const message = (err as { message?: string })?.message ?? String(err)
        setInstallError(message)
      } finally {
        if (gen === installGenRef.current) {
          setIsInstalling(false)
        }
      }
    }

    const handleRemoveBookmark = (): void => {
      if (!bookmark) return
      dispatch(removeBookmark(bookmark.name))
      handleClose()
    }

    const isInstalled = bookmark?.isInstalled || installSuccess

    return (
      <Dialog
        open={bookmark !== null}
        onOpenChange={(open) => {
          if (!open) handleClose()
        }}
      >
        <DialogContent className="max-w-sm">
          {bookmark && (
            <>
              <DialogHeader>
                <DialogTitle className="text-base font-semibold">
                  {bookmark.name}
                </DialogTitle>
              </DialogHeader>

              <button
                type="button"
                onClick={() => {
                  window.electron.shell.openExternal(bookmark.url).catch(() => {
                    // URL validation failed or shell.openExternal errored
                  })
                }}
                className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 text-left"
              >
                {bookmark.repo}
                <ExternalLink className="h-3 w-3" />
              </button>

              <Separator />

              <div className="flex items-center gap-3">
                {isInstalled ? (
                  <span className="text-sm text-emerald-500 flex items-center gap-1">
                    <Check className="h-4 w-4" />
                    Installed
                  </span>
                ) : (
                  <Button
                    onClick={handleInstall}
                    disabled={isInstalling}
                    className="h-11"
                  >
                    {isInstalling && (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    )}
                    {isInstalling ? 'Installing...' : 'Install'}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  onClick={handleRemoveBookmark}
                  className="h-11"
                >
                  Remove Bookmark
                </Button>
              </div>

              {installError && (
                <p className="text-sm text-amber-500">
                  Install failed: {installError}
                </p>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    )
  },
)
