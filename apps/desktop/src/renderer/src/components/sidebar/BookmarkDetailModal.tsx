import { Check, ExternalLink } from 'lucide-react'
import { useRef, useState } from 'react'

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
import { selectSelectedBookmarkForDetail } from '@/renderer/src/redux/selectors'
import { removeBookmark } from '@/renderer/src/redux/slices/bookmarkSlice'
import { selectSkillForInstall } from '@/renderer/src/redux/slices/marketplaceSlice'
import {
  clearSelectedBookmarkForDetail,
  type BookmarkForDetail,
} from '@/renderer/src/redux/slices/uiSlice'
import { LOCAL_SOURCE_LABEL } from '@/shared/constants'

import { BookmarkCategoryPicker } from '../bookmarks/BookmarkCategoryPicker'

/** Resolve the open sidebar detail by name so editing a category or rescanning skills updates the dialog.
 * @example <BookmarkDetailModal />
 */
export function BookmarkDetailModal() {
  const bookmark = useAppSelector(selectSelectedBookmarkForDetail)
  return bookmark ? (
    <BookmarkDetail key={bookmark.name} bookmark={bookmark} />
  ) : null
}

function BookmarkDetail({ bookmark }: { bookmark: BookmarkForDetail }) {
  const dispatch = useAppDispatch()
  const title = useRef<HTMLHeadingElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const attempt = useRef(0)
  const [failed, setFailed] = useState(false)
  const [picker, setPicker] = useState(false)
  const close = () => dispatch(clearSelectedBookmarkForDetail())
  const install = (): void => {
    if (!bookmark.repo) return
    dispatch(
      selectSkillForInstall({ name: bookmark.name, repo: bookmark.repo }),
    )
    close()
  }
  async function openSource(
    event: React.MouseEvent<HTMLAnchorElement>,
  ): Promise<void> {
    event.preventDefault()
    const current = ++attempt.current
    try {
      await window.electron.shell.openExternal(bookmark.url)
      if (current === attempt.current) setFailed(false)
    } catch (error) {
      // Only known error kinds reach the local console. Shell errors may embed private URLs in their message.
      const kind =
        error instanceof TypeError
          ? 'TypeError'
          : error instanceof Error
            ? 'Error'
            : 'unknown'
      console.warn('[bookmarks] source handoff failed', {
        operation: 'open-bookmark-source',
        stage: 'openExternal',
        kind,
      })
      if (current === attempt.current) setFailed(true)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <DialogContent
        className="max-w-sm"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          opener.current =
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null
          title.current?.focus()
        }}
        onCloseAutoFocus={(event) => {
          if (opener.current?.isConnected) {
            event.preventDefault()
            opener.current.focus()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle
            ref={title}
            tabIndex={-1}
            className="text-base font-semibold outline-none"
          >
            {bookmark.name}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Bookmark details for {bookmark.name}. Open the source, change its
            category or manage the bookmark.
          </DialogDescription>
        </DialogHeader>
        {bookmark.repo ? (
          <div>
            <a
              href={bookmark.url}
              onClick={openSource}
              className="inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {bookmark.repo}
              <ExternalLink aria-hidden="true" className="size-3" />
            </a>
            {failed && (
              <p role="alert" className="mt-1 text-xs text-destructive">
                Couldn’t open the source. If it isn’t open in your browser, try
                the link again.
              </p>
            )}
          </div>
        ) : (
          <span className="text-sm text-muted-foreground/70">
            {LOCAL_SOURCE_LABEL}
          </span>
        )}
        <BookmarkCategoryPicker
          className="justify-self-start"
          skillName={bookmark.name}
          open={picker}
          onOpenChange={(open) => setPicker(open)}
        />
        <Separator />
        <div className="flex items-center gap-3">
          {bookmark.isInstalled ? (
            <span className="flex items-center gap-1 text-sm text-emerald-500">
              <Check className="size-4" />
              Installed
            </span>
          ) : bookmark.repo ? (
            <Button onClick={install}>Install</Button>
          ) : (
            <span className="text-sm text-muted-foreground">Not installed</span>
          )}
          <Button
            variant="ghost"
            onClick={() => dispatch(removeBookmark(bookmark.name))}
          >
            Remove Bookmark
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
