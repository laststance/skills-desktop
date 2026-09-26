import { GripVertical, X } from 'lucide-react'
import React from 'react'

import { cn } from '@/renderer/src/lib/utils'
import { useAppDispatch, useAppSelector } from '@/renderer/src/redux/hooks'
import {
  removeWidget,
  selectIsEditMode,
} from '@/renderer/src/redux/slices/dashboardSlice'

import type { WidgetDefinition, WidgetInstance } from './types'
import { WIDGET_DRAG_HANDLE_CLASS } from './utils/gridConstants'

interface WidgetShellProps {
  instance: WidgetInstance
  definition: WidgetDefinition
  /**
   * Render the widget's resting state for a non-interactive preview (e.g. the
   * WidgetPicker live preview): the drag handle and remove button are always
   * hidden even while the dashboard is in edit mode. Defaults to false.
   */
  isPreview?: boolean
}

/**
 * Common frame every widget is rendered inside.
 *
 * Responsibilities:
 *  - Title bar with icon + label (the draggable handle in edit mode).
 *  - Remove button (visible only in edit mode, 28×28 hit area — pointer-driven, no 44px touch inflation).
 *  - Body slot where the widget's `Component` renders.
 *  - In preview mode (`isPreview`), edit chrome is suppressed so the picker
 *    shows exactly what the widget looks like at rest on the canvas.
 *
 * Intentionally dumb — the shell doesn't know what the widget is for, only
 * how to frame it. This keeps per-widget files small and uniform.
 */
export const WidgetShell = function WidgetShell({
  instance,
  definition,
  isPreview = false,
}: WidgetShellProps): React.ReactElement {
  const dispatch = useAppDispatch()
  const isEditMode = useAppSelector(selectIsEditMode)
  const Icon = definition.icon
  const Body = definition.Component
  // Edit affordances are gated on this rather than `isEditMode` directly so a
  // preview never shows the drag handle / remove button mid-edit-session.
  const showEditChrome = isEditMode && !isPreview

  const handleRemove = (event: React.MouseEvent): void => {
    event.stopPropagation()
    dispatch(removeWidget(instance.id))
  }

  return (
    <div className="h-full w-full flex flex-col rounded-lg border border-border bg-card overflow-hidden">
      {/* Header: also serves as drag handle when in edit mode.
           The WIDGET_DRAG_HANDLE_CLASS is what react-grid-layout listens on. */}
      <div
        className={cn(
          'flex items-center gap-2 px-3 h-9 border-b border-border shrink-0 bg-card/50',
          showEditChrome
            ? `${WIDGET_DRAG_HANDLE_CLASS} cursor-grab active:cursor-grabbing`
            : '',
        )}
      >
        {showEditChrome && (
          <GripVertical
            className="h-3.5 w-3.5 text-muted-foreground shrink-0"
            aria-hidden="true"
          />
        )}
        <Icon
          className="h-3.5 w-3.5 text-muted-foreground shrink-0"
          aria-hidden="true"
        />

        <span className="text-xs font-medium truncate">{definition.label}</span>

        {/* Remove button: only in edit mode.
             `onMouseDown` stops RGL from starting a drag when the user clicks it. */}
        {showEditChrome && (
          <button
            type="button"
            onClick={handleRemove}
            onMouseDown={(event) => event.stopPropagation()}
            aria-label={`Remove ${definition.label} widget`}
            className="ml-auto min-h-7 min-w-7 -my-2.5 -mr-3 flex items-center justify-center rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Body: fills remaining height. Widget bodies should handle overflow. */}
      <div className="flex-1 min-h-0 overflow-auto">
        <Body instance={instance} />
      </div>
    </div>
  )
}
