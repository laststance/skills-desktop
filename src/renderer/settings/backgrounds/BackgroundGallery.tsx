import { isDefinedError } from '@orpc/client'
import { useQuery } from '@tanstack/react-query'
import { Crop, Loader2, RefreshCw, Upload, X } from 'lucide-react'
import { useRef, useState, type ReactElement } from 'react'

import { DestructiveConfirmDialog } from '@/renderer/src/components/shared/DestructiveConfirmDialog'
import { Button } from '@/renderer/src/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/renderer/src/components/ui/dialog'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/renderer/src/components/ui/tabs'
import { useOnlineStatus } from '@/renderer/src/hooks/useOnlineStatus'
import { backgroundSourceKey } from '@/renderer/src/utils/backgroundSourceKey'
import type {
  BackgroundCatalogItem,
  BackgroundSnapshot,
} from '@/shared/backgrounds'
import type { Settings } from '@/shared/settings'

import { UNSPLASH_QUERY_MAX_LENGTH } from '../../../../website/src/lib/constants'

import { BackgroundCropEditor } from './BackgroundCropEditor'
import { BackgroundPhotoGrid } from './BackgroundPhotoGrid'
import type { useBackgroundGallery } from './useBackgroundGallery'
import { useUnsplashGallery } from './useUnsplashGallery'
import { areBackgroundCropsEqual } from './utils/areBackgroundCropsEqual'
import { backgroundCropQuality } from './utils/backgroundCropQuality'
import { backgroundErrorMessage } from './utils/backgroundErrorMessage'

const SOURCE_TABS = [
  { value: 'builtin', label: 'Built-in' },
  { value: 'unsplash', label: 'Unsplash' },
  { value: 'upload', label: 'Your images' },
] as const
interface GalleryProps {
  gallery: ReturnType<typeof useBackgroundGallery>
  snapshot: BackgroundSnapshot
  settings: Settings
}

/** Presents Gallery A or Crop A in one opaque dialog; only accepted Apply changes the workspace.
 * @returns Fixed header/actions and one bounded central scrolling region.
 * @example <BackgroundGallery gallery={gallery} snapshot={snapshot} settings={settings} />
 */
export function BackgroundGallery(props: GalleryProps): ReactElement {
  const { gallery, snapshot } = props
  const source = gallery.draft?.preview.source
  const sourceUnavailable =
    source?.kind === 'upload' &&
    !props.settings.background.uploads.some(
      (upload) => upload.id === source.uploadId,
    )
  const operation = snapshot.operation
  const matchesDraft = Boolean(
    operation &&
    gallery.draft &&
    backgroundSourceKey(operation.source) ===
      backgroundSourceKey(gallery.draft.preview.source) &&
    operation.aspect === gallery.draft.aspect &&
    areBackgroundCropsEqual(operation.crop, gallery.draft.crop),
  )
  const busy =
    gallery.starting || (matchesDraft && operation?.status === 'applying')
  const accepted =
    gallery.starting || (matchesDraft && operation?.status !== 'superseded')
  const closeView = (): void => {
    if (gallery.view === 'crop' && !accepted) gallery.cancelCrop()
    else gallery.close()
  }
  const failed =
    matchesDraft && operation?.status === 'failed' ? operation : null
  const status = gallery.starting
    ? 'Starting…'
    : operation?.status === 'applying'
      ? 'Applying background… You can close Settings. Applying will continue.'
      : (failed?.error.message ?? gallery.error)

  return (
    <Dialog
      open={gallery.open}
      onOpenChange={(open) => {
        if (!open) closeView()
      }}
    >
      <DialogContent
        hideCloseButton
        className={`background-gallery-dialog no-drag flex w-[calc(100vw-32px)] max-w-180 flex-col gap-0 overflow-hidden rounded-lg p-0 ${gallery.view === 'crop' ? 'h-[min(540px,calc(100vh-32px))]' : 'h-[min(520px,calc(100vh-32px))]'}`}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          gallery.opener.current?.focus()
        }}
      >
        <DialogHeader className="flex-row items-center justify-between space-y-0 gap-3 border-b px-4 py-3 text-left">
          <div className="min-w-0">
            <DialogTitle tabIndex={-1} className="text-base">
              {gallery.view === 'crop'
                ? 'Crop background'
                : 'Choose background'}
            </DialogTitle>
            <DialogDescription
              className={
                gallery.view === 'crop' ? 'mt-1 truncate text-xs' : 'sr-only'
              }
            >
              {gallery.view === 'crop'
                ? (gallery.draft?.preview.title ?? 'Loading image…')
                : 'Select a draft, crop if needed, then apply it to your workspace.'}
            </DialogDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {gallery.view === 'gallery' ? (
              <Button
                variant="outline"
                disabled={gallery.checking || gallery.starting}
                onClick={() => void gallery.importImage()}
              >
                <Upload />
                Upload image
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="icon"
              aria-label={accepted ? 'Close' : 'Cancel'}
              onClick={closeView}
            >
              <X />
            </Button>
          </div>
        </DialogHeader>
        {status || gallery.checking ? (
          <p role="status" className="shrink-0 border-b px-4 py-2 text-xs">
            {gallery.checking ? 'Checking image…' : status}
          </p>
        ) : null}
        <div
          className="min-h-0 flex-1 flex-col"
          style={{ display: gallery.view === 'gallery' ? 'flex' : 'none' }}
        >
          <BackgroundGalleryBrowser {...props} />
          <BackgroundGalleryFooter
            {...props}
            busy={busy}
            accepted={accepted}
            failed={Boolean(failed)}
            sourceUnavailable={sourceUnavailable}
          />
        </div>
        {gallery.view === 'crop' && gallery.draft ? (
          <BackgroundCropEditor
            key={gallery.session}
            draft={gallery.draft}
            busy={busy}
            accepted={accepted}
            sourceUnavailable={sourceUnavailable}
            onApply={(draft) => void gallery.apply(draft)}
            onCancel={accepted ? gallery.close : gallery.cancelCrop}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

/** Retains tab/search/scroll state while Crop is open and reuses native confirmation for owned uploads.
 * @returns Source tabs, remote search and the bounded result grid.
 * @example <BackgroundGalleryBrowser {...galleryProps} />
 */
function BackgroundGalleryBrowser({
  gallery,
  settings,
}: GalleryProps): ReactElement {
  const [tab, setTab] =
    useState<(typeof SOURCE_TABS)[number]['value']>('builtin')
  const [removing, setRemoving] = useState<{
    item: BackgroundCatalogItem
    busy: boolean
  } | null>(null)
  const scrollPositions = useRef(new Map<string, number>())
  const catalog = useQuery({
    queryKey: ['background-catalog', settings.background.uploads],
    queryFn: async () => window.electron.backgrounds.list(),
    // Local images remain available while the remote provider is offline.
    networkMode: 'always',
    enabled: gallery.open,
    retry: false,
  })
  const online = useUnsplashGallery(gallery.open && tab === 'unsplash')
  const items =
    tab === 'unsplash'
      ? online.items
      : tab === 'builtin'
        ? (catalog.data?.builtins ?? [])
        : (catalog.data?.uploads ?? [])
  const appliedKey = backgroundSourceKey(settings.background.selected?.source)
  const loading =
    tab === 'unsplash'
      ? online.isPending && Boolean(online.query)
      : catalog.isPending
  const error = tab === 'unsplash' ? online.error : catalog.error
  const retry = (): void => {
    if (tab !== 'unsplash') void catalog.refetch()
    else if (online.hasNextPage) void online.loadMore()
    else void online.refresh()
  }
  const remove = (): void => {
    if (!removing || removing.busy || removing.item.source.kind !== 'upload')
      return
    const uploadId = removing.item.source.uploadId
    setRemoving({ ...removing, busy: true })
    void gallery
      .saveMutation(async () =>
        window.electron.backgrounds.removeUpload({ uploadId }),
      )
      .then(() => {
        setRemoving(null)
        void catalog.refetch()
      })
      .catch(() =>
        setRemoving((current) =>
          current ? { ...current, busy: false } : null,
        ),
      )
  }

  return (
    <>
      <Tabs
        value={tab}
        onValueChange={(value) => {
          const next = SOURCE_TABS.find((source) => source.value === value)
          if (next) {
            if (next.value === 'unsplash') online.open()
            setTab(next.value)
          }
        }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsList className="mx-4 my-3 grid shrink-0 grid-cols-3">
          {SOURCE_TABS.map((source) => (
            <TabsTrigger key={source.value} value={source.value}>
              {source.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {tab === 'unsplash' ? (
          <div className="mb-3 flex shrink-0 items-center gap-2 px-4">
            <label className="sr-only" htmlFor="background-search">
              Search Unsplash
            </label>
            <input
              id="background-search"
              type="search"
              value={online.search}
              maxLength={UNSPLASH_QUERY_MAX_LENGTH}
              onChange={(event) =>
                online.changeSearch(event.currentTarget.value)
              }
              className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline focus-visible:outline-ring"
              placeholder="Search Unsplash"
            />
            <Button
              variant="outline"
              size="icon"
              aria-label="Refresh Unsplash"
              disabled={online.isFetching || !online.query}
              onClick={() => {
                scrollPositions.current.set(`unsplash:${online.search}`, 0)
                void online.refresh()
              }}
            >
              <RefreshCw
                className={
                  online.isFetching
                    ? 'animate-spin motion-reduce:animate-none'
                    : undefined
                }
              />
            </Button>
          </div>
        ) : null}
        <TabsContent
          value={tab}
          className="mt-0 flex min-h-0 flex-1 flex-col px-4 pb-2"
        >
          {loading ? (
            <div
              role="status"
              className="flex min-h-20 items-center justify-center gap-2 text-sm text-muted-foreground"
            >
              <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
              Loading photos…
            </div>
          ) : null}
          {items.length ? (
            <BackgroundPhotoGrid
              items={items}
              selectedKey={backgroundSourceKey(gallery.draft?.preview.source)}
              appliedKey={appliedKey}
              scope={`${tab}:${online.search}`}
              active={gallery.open && gallery.view === 'gallery'}
              scrollPositions={scrollPositions.current}
              onSelect={(item) => void gallery.loadPreview(item.source)}
              onRemove={(item) => setRemoving({ item, busy: false })}
              onEndReached={() => {
                if (tab === 'unsplash' && !online.isError)
                  void online.loadMore()
              }}
            />
          ) : !loading && !error ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {tab === 'upload'
                ? 'No uploaded images yet. Choose Upload image to add one.'
                : 'No photos found. Enter another search.'}
            </p>
          ) : null}
          <BackgroundGalleryResults
            online={online}
            remote={tab === 'unsplash'}
            error={error}
            retry={retry}
          />
        </TabsContent>
      </Tabs>
      <BackgroundUploadRemoval
        removing={removing}
        appliedKey={appliedKey}
        onClose={() => setRemoving(null)}
        onConfirm={remove}
      />
    </>
  )
}

/** Keeps loaded photos usable during network/quota errors and exposes keyboard pagination.
 * @returns Recoverable status, Retry or end-of-results indicator.
 * @example <BackgroundGalleryResults online={online} remote error={null} retry={retry} />
 */
function BackgroundGalleryResults({
  online,
  remote,
  error,
  retry,
}: {
  online: ReturnType<typeof useUnsplashGallery>
  remote: boolean
  error: Error | null
  retry: () => void
}): ReactElement {
  const connected = useOnlineStatus()
  const quota =
    remote &&
    isDefinedError(online.error) &&
    online.error.code === 'RATE_LIMITED'
      ? online.error.data.retryAfterSeconds
      : null
  return (
    <>
      {error ? (
        <div
          role="status"
          className="flex shrink-0 items-center justify-between gap-2 py-2 text-xs"
        >
          <span>
            {connected
              ? backgroundErrorMessage(error, 'Photos unavailable. Try again.')
              : 'You are offline. Loaded photos are still available.'}
            {quota !== null ? ` Try again in ${quota} seconds.` : ''}
          </span>
          <Button variant="outline" size="sm" onClick={retry}>
            Retry
          </Button>
        </div>
      ) : null}
      {remote && online.items.length ? (
        <div className="flex shrink-0 justify-center pt-2">
          {online.hasNextPage ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={online.isFetching}
              onClick={() => void online.loadMore()}
            >
              {online.isFetchingNextPage ? 'Loading more…' : 'Load more'}
            </Button>
          ) : (
            <p className="py-1 text-xs text-muted-foreground">
              You have reached the end.
            </p>
          )}
        </div>
      ) : null}
    </>
  )
}

/** Separates draft, validity and Apply actions from the scrollable gallery so compact windows keep them reachable.
 * @returns Fixed Preview/Crop/Cancel/Apply footer with explicit invalid-source feedback.
 * @example <BackgroundGalleryFooter {...props} busy={false} accepted={false} failed={false} />
 */
function BackgroundGalleryFooter({
  gallery,
  busy,
  accepted,
  failed,
  sourceUnavailable,
}: GalleryProps & {
  busy: boolean
  accepted: boolean
  failed: boolean
  sourceUnavailable: boolean
}): ReactElement {
  const quality = gallery.draft
    ? backgroundCropQuality(
        gallery.draft.preview.width,
        gallery.draft.preview.height,
        gallery.draft.crop,
      )
    : null
  const reason = sourceUnavailable
    ? 'This uploaded image was removed. Select another image.'
    : quality?.error
  return (
    <>
      <footer className="flex shrink-0 items-center justify-between gap-3 border-t px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="min-w-0 truncate text-xs"
            title={gallery.draft?.preview.title}
          >
            Preview: {gallery.draft?.preview.title ?? 'Select an image'}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={
              !gallery.draft || gallery.checking || busy || sourceUnavailable
            }
            onClick={gallery.editCrop}
          >
            <Crop />
            Crop
          </Button>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" onClick={gallery.close}>
            {accepted ? 'Close' : 'Cancel'}
          </Button>
          <Button
            disabled={
              !gallery.draft || gallery.checking || busy || Boolean(reason)
            }
            aria-describedby={reason ? 'background-draft-error' : undefined}
            onClick={() => void gallery.apply()}
          >
            {failed ? 'Retry Apply' : 'Apply background'}
          </Button>
        </div>
      </footer>
      {reason ? (
        <p
          id="background-draft-error"
          role="status"
          className="shrink-0 px-4 pb-2 text-xs text-destructive"
        >
          {reason}
        </p>
      ) : null}
    </>
  )
}

/** Names app-owned deletion scope before the shared destructive confirmation executes.
 * @returns Upload removal confirmation with current-background disclosure.
 * @example <BackgroundUploadRemoval removing={null} appliedKey="" onClose={close} onConfirm={remove} />
 */
function BackgroundUploadRemoval({
  removing,
  appliedKey,
  onClose,
  onConfirm,
}: {
  removing: { item: BackgroundCatalogItem; busy: boolean } | null
  appliedKey: string
  onClose: () => void
  onConfirm: () => void
}): ReactElement {
  return (
    <DestructiveConfirmDialog
      open={Boolean(removing)}
      loading={removing?.busy ?? false}
      title="Remove uploaded image?"
      description={
        <>
          {`Remove the app-owned copy of “${removing?.item.title ?? ''}”. Your external original is untouched.`}
          {removing && backgroundSourceKey(removing.item.source) === appliedKey
            ? ' This also clears the current background.'
            : ''}
        </>
      }
      onClose={() => {
        if (!removing?.busy) onClose()
      }}
      onConfirm={onConfirm}
    />
  )
}
