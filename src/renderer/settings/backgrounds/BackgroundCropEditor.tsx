import { Minus, Plus, RotateCcw } from 'lucide-react'
import { useState, type ReactElement } from 'react'
import Cropper from 'react-easy-crop'

import { SegmentedControl } from '@/renderer/src/components/shared/segmented-control'
import { Button } from '@/renderer/src/components/ui/button'
import {
  DEFAULT_BACKGROUND_CROP,
  type BackgroundCrop,
  type BackgroundCropAspect,
} from '@/shared/backgrounds'
import { BACKGROUND_MIN_SHORT_EDGE_PX } from '@/shared/constants'

import {
  CROP_KEYBOARD_STEP_PX,
  CROP_DEFAULT_MAX_ZOOM,
  CROP_FIXED_ASPECTS,
  CROP_MIN_ZOOM,
  CROP_ZOOM_STEP,
} from './constants'
import type { BackgroundDraft } from './useBackgroundGallery'
import { backgroundCropQuality } from './utils/backgroundCropQuality'

/** Edits a fixed frame with the installed cropper; real source pixels determine whether Apply is available.
 * @returns Crop A's image, ratio/zoom/quality controls and fixed action footer.
 * @example <BackgroundCropEditor draft={draft} busy={false} onApply={apply} onCancel={cancel} />
 */
export function BackgroundCropEditor({
  draft,
  busy,
  accepted,
  sourceUnavailable,
  onApply,
  onCancel,
}: {
  draft: BackgroundDraft
  busy: boolean
  accepted: boolean
  sourceUnavailable: boolean
  onApply: (draft: BackgroundDraft) => void
  onCancel: () => void
}): ReactElement {
  const [editor, setEditor] = useState({
    position: { x: 0, y: 0 },
    zoom: CROP_MIN_ZOOM,
    area: draft.crop,
    aspect: draft.aspect,
    reset: 0,
    error: false,
  })
  const maxZoom = Math.max(
    CROP_DEFAULT_MAX_ZOOM,
    Math.max(draft.preview.width, draft.preview.height) /
      BACKGROUND_MIN_SHORT_EDGE_PX,
  )
  const quality = backgroundCropQuality(
    draft.preview.width,
    draft.preview.height,
    editor.area,
  )
  const aspect =
    editor.aspect === 'original'
      ? draft.preview.width / draft.preview.height
      : CROP_FIXED_ASPECTS[editor.aspect]
  const initialCrop = editor.reset === 0 ? draft.crop : DEFAULT_BACKGROUND_CROP
  const error = sourceUnavailable
    ? 'This uploaded image was removed. Select another image.'
    : editor.error
      ? 'Image preview unavailable. Cancel and choose another image, or retry.'
      : quality.error
  const changeZoom = (zoom: number): void =>
    setEditor((current) => ({
      ...current,
      zoom: Math.min(maxZoom, Math.max(CROP_MIN_ZOOM, zoom)),
    }))
  const changeArea = (area: BackgroundCrop): void =>
    setEditor((current) => ({ ...current, area }))
  const changeAspect = (next: BackgroundCropAspect): void =>
    setEditor((current) => ({ ...current, aspect: next }))

  return (
    <>
      <div className="background-crop-body min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        <div className="relative h-[clamp(120px,40vh,280px)] min-h-30 overflow-hidden rounded-md bg-black">
          <Cropper
            key={editor.reset}
            image={draft.preview.image.url}
            crop={editor.position}
            zoom={editor.zoom}
            aspect={aspect}
            minZoom={CROP_MIN_ZOOM}
            maxZoom={maxZoom}
            keyboardStep={CROP_KEYBOARD_STEP_PX}
            objectFit="contain"
            initialCroppedAreaPercentages={initialCrop}
            onCropChange={(position) =>
              setEditor((current) => ({ ...current, position }))
            }
            onZoomChange={changeZoom}
            onCropAreaChange={changeArea}
            zoomWithScroll={false}
            cropperProps={{
              'aria-label': 'Move image within crop frame',
              'aria-describedby': 'background-crop-instructions',
              role: 'group',
            }}
            mediaProps={{
              alt: draft.preview.title,
              onError: () =>
                setEditor((current) => ({ ...current, error: true })),
            }}
          />
        </div>
        <p
          id="background-crop-instructions"
          className="mt-2 text-xs text-muted-foreground"
        >
          Drag the image or focus it and use arrow keys to move.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-4">
          <div>
            <div className="mb-2 text-xs font-medium">Aspect ratio</div>
            <SegmentedControl
              aria-label="Crop aspect ratio"
              size="sm"
              value={editor.aspect}
              onValueChange={changeAspect}
              options={[
                { value: 'original', label: 'Original' },
                { value: '16:9', label: '16:9' },
                { value: '16:10', label: '16:10' },
              ]}
            />
          </div>
          <div className="min-w-40 flex-1">
            <label
              className="mb-1 block text-xs font-medium"
              htmlFor="background-crop-zoom"
            >
              Zoom{' '}
              <span className="tabular-nums text-muted-foreground">
                {editor.zoom.toFixed(2)}×
              </span>
            </label>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                aria-label="Zoom out"
                disabled={editor.zoom <= CROP_MIN_ZOOM}
                onClick={() => changeZoom(editor.zoom - CROP_ZOOM_STEP)}
              >
                <Minus />
              </Button>
              <input
                id="background-crop-zoom"
                aria-valuetext={`${editor.zoom.toFixed(2)} times`}
                type="range"
                min={CROP_MIN_ZOOM}
                max={maxZoom}
                step={CROP_ZOOM_STEP}
                value={editor.zoom}
                onChange={(event) =>
                  changeZoom(Number(event.currentTarget.value))
                }
                className="h-6 min-w-0 flex-1 accent-primary focus-visible:outline focus-visible:outline-ring"
              />
              <Button
                variant="outline"
                size="icon"
                aria-label="Zoom in"
                disabled={editor.zoom >= maxZoom}
                onClick={() => changeZoom(editor.zoom + CROP_ZOOM_STEP)}
              >
                <Plus />
              </Button>
            </div>
          </div>
        </div>
        <p className="mt-3 text-xs tabular-nums">
          Selected area: {quality.width} × {quality.height} px
        </p>
        <div id="background-crop-error" role="status">
          {error ? (
            <p className="mt-2 text-xs text-destructive">{error}</p>
          ) : null}
        </div>
        <Button
          className="mt-3"
          variant="outline"
          size="sm"
          onClick={() =>
            setEditor((current) => ({
              position: { x: 0, y: 0 },
              zoom: CROP_MIN_ZOOM,
              area: DEFAULT_BACKGROUND_CROP,
              aspect: 'original',
              reset: current.reset + 1,
              error: false,
            }))
          }
        >
          <RotateCcw />
          Reset crop
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">
          Your original image is kept.
        </p>
      </div>
      <footer className="flex shrink-0 items-center justify-end gap-2 border-t px-4 py-3">
        <Button variant="outline" onClick={onCancel}>
          {accepted ? 'Close' : 'Cancel'}
        </Button>
        <Button
          disabled={busy || Boolean(error)}
          aria-describedby={error ? 'background-crop-error' : undefined}
          onClick={() =>
            onApply({ ...draft, crop: editor.area, aspect: editor.aspect })
          }
        >
          Apply background
        </Button>
      </footer>
    </>
  )
}
