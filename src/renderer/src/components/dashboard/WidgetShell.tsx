import { GripVertical, X } from 'lucide-react'
import React from 'react'

import { cn } from '../../lib/utils'
import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import {
  removeWidget,
  selectIsEditMode,
} from '../../redux/slices/dashboardSlice'

import type { WidgetDefinition, WidgetInstance } from './types'
import { WIDGET_DRAG_HANDLE_CLASS } from './utils/gridConstants'

interface WidgetShellProps {
  instance: WidgetInstance
  definition: WidgetDefinition
}

/**
 * Common frame every widget is rendered inside.
 *
 * Responsibilities:
 *  - Title bar with icon + label (the draggable handle in edit mode).
 *  - Remove button (visible only in edit mode, 44×44 hit area per HIG).
 *  - Body slot where the widget's `Component` renders.
 *
 * Intentionally dumb — the shell doesn't know what the widget is for, only
 * how to frame it. This keeps per-widget files small and uniform.
 */
export const WidgetShell = React.memo(function WidgetShell({
  instance,
  definition,
}: WidgetShellProps): React.ReactElement {
  const dispatch = useAppDispatch()
  const isEditMode = useAppSelector(selectIsEditMode)
  const Icon = definition.icon
  const Body = definition.Component

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
          isEditMode
            ? `${WIDGET_DRAG_HANDLE_CLASS} cursor-grab active:cursor-grabbing`
            : '',
        )}
      >
        {isEditMode && (
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
        {isEditMode && (
          <button
            type="button"
            onClick={handleRemove}
            onMouseDown={(event) => event.stopPropagation()}
            aria-label={`Remove ${definition.label} widget`}
            className="ml-auto min-h-[44px] min-w-[44px] -my-[10px] -mr-3 flex items-center justify-center rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
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
})
