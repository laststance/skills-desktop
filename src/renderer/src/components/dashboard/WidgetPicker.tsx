import React, { useCallback, useMemo, useRef } from 'react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/renderer/src/components/ui/dialog'
import { cn } from '@/renderer/src/lib/utils'
import { useAppDispatch, useAppSelector } from '@/renderer/src/redux/hooks'
import {
  addWidget,
  selectWelcomeDismissed,
} from '@/renderer/src/redux/slices/dashboardSlice'
import {
  resetActivePreview,
  selectActivePreviewType,
  setActivePreviewType,
} from '@/renderer/src/redux/slices/widgetPickerSlice'
import { FEATURE_FLAGS } from '@/shared/featureFlags'

import type { WidgetInstance, WidgetType } from './types'
import { newWidgetInstanceId } from './utils/ids'
import { resolveSeedPreviewType } from './utils/resolveSeedPreviewType'
import { widgetPreviewSize } from './utils/widgetPreviewSize'
import { getWidgetDefinition, listAvailableWidgets } from './widgets/registry'
import { WidgetShell } from './WidgetShell'

// One stable id reused for whatever widget is previewed. Reuse is safe because
// nothing keys off a preview instance's id — the object is never dispatched to
// Redux. NOTE `inert` (see the wrapper below) only blocks pointer/focus/a11y,
// not mount effects: Trending/What's New still fetch the leaderboard on preview.
const PREVIEW_INSTANCE_ID = newWidgetInstanceId()

interface WidgetPickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Modal for adding a new widget to the current page, with a live preview.
 *
 * Left: a compact list of every visible widget (catalog filtered by the
 * `ENABLE_DASHBOARD_EXPERIMENTAL` flag). Right: the REAL widget body rendered
 * on a neutral stage at its default-size aspect ratio, so the user sees exactly
 * what they're adding — not just an icon + blurb. Hovering or keyboard-focusing
 * a row swaps the preview; clicking a row adds the widget and closes the modal
 * (one-click-add). The reducer finds the first empty grid slot on the current
 * page, auto-creating a new page if the current one is full.
 *
 * @example
 * const [open, setOpen] = useState(false)
 * <WidgetPicker open={open} onOpenChange={setOpen} />
 */
export const WidgetPicker = React.memo(function WidgetPicker({
  open,
  onOpenChange,
}: WidgetPickerProps): React.ReactElement {
  const dispatch = useAppDispatch()
  const availableWidgets = listAvailableWidgets(
    FEATURE_FLAGS.ENABLE_DASHBOARD_EXPERIMENTAL,
  )

  // Welcome dismissal feeds the seed-fallthrough rule in `resolveSeedPreviewType`.
  const isWelcomeDismissed = useAppSelector(selectWelcomeDismissed)

  // Live hover/focus state. Lives in `widgetPickerSlice` per the renderer rule
  // that modal/dialog state is slice-owned (not local useState). `null` means
  // the preview falls through to the seed widget.
  const activePreviewType = useAppSelector(selectActivePreviewType)
  const seedPreviewType = resolveSeedPreviewType({
    availableWidgets,
    isWelcomeDismissed,
  })

  const previewType: WidgetType =
    activePreviewType ?? seedPreviewType ?? 'welcome'
  const previewDefinition = getWidgetDefinition(previewType)

  // Radix moves focus into the dialog on open. Left to its default it grabs the
  // FIRST row, whose `onFocus` would override the seed — so for a returning user
  // the stage would still open on the dismissed Welcome hint. We redirect that
  // initial focus onto the seed row so the focused row and the preview always
  // agree (and keyboard users land on the same widget the stage shows).
  const seedRowRef = useRef<HTMLButtonElement>(null)

  // One-click-add must fire at most once per open: the close animation keeps the
  // rows clickable for a frame, so a fast double-click could add the widget
  // twice. Reset on the open edge (via `onOpenAutoFocus`) and gate every
  // `handleAddWidget` call against it.
  const hasAddedRef = useRef<boolean>(false)

  // Stable (refs never change identity) so the memoized DialogContent doesn't
  // re-render on every keystroke-driven parent update. Fires once per open
  // cycle when Radix mounts focus on DialogContent, so it doubles as our
  // open-edge event for resetting the one-click-add guard.
  const handleOpenAutoFocus = useCallback((event: Event): void => {
    hasAddedRef.current = false
    if (!seedRowRef.current) return
    event.preventDefault()
    seedRowRef.current.focus()
  }, [])

  // Wrap `onOpenChange` so the close transition (Esc, overlay click, X button,
  // or our own `handleAddWidget`) drops the hover override before forwarding.
  // The parent only opens via `setIsPickerOpen(true)` and routes every close
  // through this callback, so this covers every close path.
  const handleOpenChange = useCallback(
    (nextOpen: boolean): void => {
      if (!nextOpen) dispatch(resetActivePreview())
      onOpenChange(nextOpen)
    },
    [dispatch, onOpenChange],
  )
  const previewBox = previewDefinition
    ? widgetPreviewSize(previewDefinition.defaultSize)
    : null

  // Synthetic instance so the real widget body can render. The id is the
  // constant PREVIEW_INSTANCE_ID (see above), reused because nothing keys off it.
  const previewInstance = useMemo<WidgetInstance>(
    () => ({
      id: PREVIEW_INSTANCE_ID,
      type: previewType,
      x: 0,
      y: 0,
      w: previewDefinition?.defaultSize.w ?? 1,
      h: previewDefinition?.defaultSize.h ?? 1,
    }),
    [previewType, previewDefinition],
  )

  // Not wrapped in useCallback: each row already creates a new arrow in
  // `.map()`, so memoizing this helper offers zero stability benefit and
  // the lint rule `no-deopt-use-callback` correctly flags that pattern.
  // Routes through `handleOpenChange` so the close-edge cleanup runs.
  const handleAddWidget = (widgetType: WidgetType): void => {
    if (hasAddedRef.current) return
    hasAddedRef.current = true
    dispatch(addWidget({ type: widgetType }))
    handleOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-w-3xl max-h-[85vh] overflow-y-auto"
        onOpenAutoFocus={handleOpenAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>Add Widget</DialogTitle>
          <DialogDescription>
            Hover a widget to preview it live, then click to add it to the
            current page. If the page is full, a new one will be created
            automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-4 mt-2">
          {/* Left: compact widget list. Hover/focus drives the preview;
              clicking a row adds it immediately (one-click-add). */}
          <ul className="w-56 shrink-0 flex flex-col gap-1 max-h-[60vh] overflow-y-auto pr-1">
            {availableWidgets.map((widgetDefinition) => {
              const WidgetIcon = widgetDefinition.icon
              const isActive = widgetDefinition.type === previewType
              // The seed row receives the dialog's initial focus (see
              // `handleOpenAutoFocus`) so focus and preview start in agreement.
              const isSeedRow = widgetDefinition.type === seedPreviewType
              return (
                <li key={widgetDefinition.type}>
                  <button
                    type="button"
                    ref={isSeedRow ? seedRowRef : undefined}
                    onClick={() => handleAddWidget(widgetDefinition.type)}
                    onPointerMove={() => {
                      if (activePreviewType === widgetDefinition.type) return
                      dispatch(setActivePreviewType(widgetDefinition.type))
                    }}
                    onFocus={() => {
                      if (activePreviewType === widgetDefinition.type) return
                      dispatch(setActivePreviewType(widgetDefinition.type))
                    }}
                    aria-current={isActive ? 'true' : undefined}
                    className={cn(
                      `group w-full flex items-center gap-2.5 p-2 rounded-lg border
                       text-left transition-colors focus-visible:outline-none
                       focus-visible:ring-2 focus-visible:ring-ring`,
                      isActive
                        ? 'bg-muted border-border/80'
                        : 'border-transparent hover:bg-muted hover:border-border/80',
                    )}
                  >
                    <span className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-md bg-primary/10 text-primary group-hover:bg-primary/15">
                      <WidgetIcon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span className="flex-1 min-w-0 text-sm font-medium text-foreground truncate flex items-center gap-1.5">
                      {widgetDefinition.label}
                      {widgetDefinition.experimental && (
                        <span
                          title="Experimental widget"
                          className="shrink-0 text-[9px] font-mono uppercase tracking-wide text-amber-400 bg-amber-400/10 px-1 py-0.5 rounded"
                        >
                          exp
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>

          {/* Right: live preview. The REAL widget body renders on a neutral
              `--background` stage (the widget is `--card`, so the stage must
              not be a card — no card-in-card per DESIGN.md). */}
          <div className="flex-1 min-w-0 flex flex-col gap-3">
            <div className="flex-1 min-h-[20rem] flex items-center justify-center rounded-lg border border-border bg-background p-4 overflow-hidden">
              {previewDefinition && previewBox ? (
                // `inert` removes the preview from tab order, the a11y tree, and
                // pointer events in one declarative knob — the cloned widget's
                // buttons/links can't be focused or clicked here. WidgetShell's
                // root is already `h-full w-full`, so it fills this sized stage
                // directly without an extra wrapper.
                <div
                  inert
                  data-testid="widget-picker-preview-body"
                  data-preview-type={previewType}
                  style={{
                    width: previewBox.widthPx,
                    aspectRatio: `${previewBox.widthPx} / ${previewBox.heightPx}`,
                    maxWidth: '100%',
                  }}
                >
                  <WidgetShell
                    instance={previewInstance}
                    definition={previewDefinition}
                    isPreview
                  />
                </div>
              ) : null}
            </div>

            {/* Name + blurb for the previewed widget (was per-card text). */}
            {previewDefinition && (
              <div className="px-0.5">
                <p className="text-sm font-semibold text-foreground">
                  {previewDefinition.label}
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {previewDefinition.description}
                </p>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
})
