import { QueryClientProvider } from '@tanstack/react-query'
import { Crop, Image, Trash2 } from 'lucide-react'
import { useState, type ReactElement } from 'react'

import { BackgroundCredit } from '@/renderer/src/components/background/BackgroundCredit'
import { BackgroundImage } from '@/renderer/src/components/background/BackgroundImage'
import { BackgroundImageRetry } from '@/renderer/src/components/background/BackgroundImageRetry'
import { SegmentedControl } from '@/renderer/src/components/shared/segmented-control'
import { Button } from '@/renderer/src/components/ui/button'
import { useBackgroundSnapshot } from '@/renderer/src/hooks/useBackgroundSnapshot'
import { useAppSelector } from '@/renderer/src/redux/hooks'
import type { BackgroundLayout } from '@/shared/backgrounds'
import { WINDOW_OPACITY_MAX_PERCENT } from '@/shared/constants'

import { SectionRow } from '../sections/SectionFrame'

import { BackgroundGallery } from './BackgroundGallery'
import { backgroundQueryClient } from './query'
import { useBackgroundGallery } from './useBackgroundGallery'

const LAYOUT_OPTIONS: { value: BackgroundLayout; label: string }[] = [
  { value: 'fill', label: 'Fill' },
  { value: 'fit', label: 'Fit' },
  { value: 'tile', label: 'Tile' },
]

/** Adds the reviewed background controls to Appearance with one session-long remote query cache.
 * @returns Current background, library entry point and gallery dialog.
 * @example <BackgroundSettings />
 */
export function BackgroundSettings(): ReactElement {
  return (
    <QueryClientProvider client={backgroundQueryClient}>
      <BackgroundSettingsContent />
    </QueryClientProvider>
  )
}

/** Reads canonical background/opacity values; local operations merge only through Main's settings queue.
 * @returns Appearance controls and the independently opaque gallery.
 * @example <BackgroundSettingsContent />
 */
function BackgroundSettingsContent(): ReactElement {
  const settings = useAppSelector((state) => state.settings)
  const snapshot = useBackgroundSnapshot()
  const gallery = useBackgroundGallery(snapshot)
  const [previewState, setPreviewState] = useState({
    failedUrl: '',
    saving: false,
  })
  const display = snapshot.display
  const hidden =
    settings.windowOpacityMode === 'entire'
      ? settings.windowBackgroundOpacityPercent === WINDOW_OPACITY_MAX_PERCENT
      : [
          settings.leftSectionOpacityPercent,
          settings.centerSectionOpacityPercent,
          settings.rightSectionOpacityPercent,
        ].every((value) => value === WINDOW_OPACITY_MAX_PERCENT)
  const unavailable = display
    ? previewState.failedUrl === display.image.url
    : settings.background.selected && snapshot.revision >= 0
  const changeLayout = (layout: BackgroundLayout): void => {
    void gallery
      .saveMutation(async () => window.electron.backgrounds.setLayout(layout))
      .catch(() => undefined)
  }

  return (
    <SectionRow
      label="Background"
      description="Choose an image behind the main window's panes."
    >
      <div className="flex items-center gap-3">
        <div className="flex h-20 w-32 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted">
          {display ? (
            <BackgroundImage
              display={display}
              layout={settings.background.layout}
              retryRevision={snapshot.displayRetryRevision}
              onError={() =>
                setPreviewState((current) => ({
                  ...current,
                  failedUrl: display.image.url,
                }))
              }
              onLoad={() =>
                setPreviewState((current) => ({ ...current, failedUrl: '' }))
              }
            />
          ) : (
            <Image aria-hidden className="h-5 w-5 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm" title={display?.title}>
            {display?.title ??
              (settings.background.selected
                ? 'Background unavailable'
                : 'No background image')}
          </p>
          <BackgroundCredit credit={display?.credit ?? null} />
          <div className="mt-2 flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={!settings.background.selected}
              onClick={() => gallery.openGallery('crop')}
            >
              <Crop />
              Crop
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={
                previewState.saving ||
                (!settings.background.selected &&
                  snapshot.operation?.status !== 'applying')
              }
              onClick={() => {
                setPreviewState((current) => ({ ...current, saving: true }))
                void gallery
                  .saveMutation(async () => window.electron.backgrounds.clear())
                  .catch(() => undefined)
                  .finally(() =>
                    setPreviewState((current) => ({
                      ...current,
                      saving: false,
                    })),
                  )
              }}
            >
              <Trash2 />
              Clear
            </Button>
          </div>
        </div>
      </div>
      <Button
        className="mt-3"
        variant="outline"
        onClick={() => gallery.openGallery()}
      >
        Choose background
      </Button>
      {unavailable ? (
        <p role="status" className="mt-2 text-xs">
          Background unavailable. <BackgroundImageRetry />
        </p>
      ) : null}
      {settings.background.selected && hidden ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Hidden at 100% opacity.{' '}
          <Button
            variant="link"
            size="xs"
            onClick={() =>
              document
                .querySelector<HTMLInputElement>(
                  settings.windowOpacityMode === 'entire'
                    ? 'input[aria-label="Background opacity"]'
                    : 'input[aria-label="Left opacity"]',
                )
                ?.focus()
            }
          >
            Adjust opacity
          </Button>
        </p>
      ) : null}
      <div className="mt-4">
        <div className="mb-2 text-xs font-medium">Image layout</div>
        <SegmentedControl
          aria-label="Background image layout"
          size="sm"
          value={settings.background.layout}
          onValueChange={changeLayout}
          options={LAYOUT_OPTIONS}
        />
      </div>
      <BackgroundGallery
        gallery={gallery}
        snapshot={snapshot}
        settings={settings}
      />
    </SectionRow>
  )
}
