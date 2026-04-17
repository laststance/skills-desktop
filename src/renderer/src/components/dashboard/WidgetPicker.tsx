import React from 'react'

import { FEATURE_FLAGS } from '../../../../shared/featureFlags'
import { useAppDispatch } from '../../redux/hooks'
import { addWidget } from '../../redux/slices/dashboardSlice'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'

import type { WidgetType } from './types'
import { listAvailableWidgets } from './widgets/registry'

interface WidgetPickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Modal for adding a new widget to the current page.
 *
 * Reads the visible widget catalog from the registry (filtered by the
 * `ENABLE_DASHBOARD_EXPERIMENTAL` flag so unfinished widgets stay hidden in
 * production builds). Clicking a widget dispatches `addWidget` — the reducer
 * finds the first empty grid slot on the current page, and auto-creates a
 * new page if the current one is full.
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

  // Not wrapped in useCallback: each row already creates a new arrow in
  // `.map()`, so memoizing this helper offers zero stability benefit and
  // the lint rule `no-deopt-use-callback` correctly flags that pattern.
  const handleAddWidget = (widgetType: WidgetType): void => {
    dispatch(addWidget({ type: widgetType }))
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add Widget</DialogTitle>
          <DialogDescription>
            Pick a widget to add to the current page. If the page is full, a new
            one will be created automatically.
          </DialogDescription>
        </DialogHeader>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 max-h-[60vh] overflow-y-auto pr-1">
          {availableWidgets.map((widgetDefinition) => {
            const WidgetIcon = widgetDefinition.icon
            return (
              <li key={widgetDefinition.type}>
                <button
                  type="button"
                  onClick={() => handleAddWidget(widgetDefinition.type)}
                  className="
                    group w-full min-h-[72px] flex items-start gap-3 p-3 rounded-lg
                    border border-border bg-card text-left
                    hover:bg-muted hover:border-border/80
                    transition-colors focus-visible:outline-none
                    focus-visible:ring-2 focus-visible:ring-ring
                  "
                >
                  <span
                    className="
                      shrink-0 inline-flex items-center justify-center
                      w-8 h-8 rounded-md bg-primary/10 text-primary
                      group-hover:bg-primary/15
                    "
                  >
                    <WidgetIcon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                    <span className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                      {widgetDefinition.label}
                      {widgetDefinition.experimental && (
                        <span
                          title="Experimental widget"
                          className="
                            text-[9px] font-mono uppercase tracking-wide
                            text-amber-400 bg-amber-400/10
                            px-1 py-0.5 rounded
                          "
                        >
                          exp
                        </span>
                      )}
                    </span>
                    <span className="text-[11px] text-muted-foreground leading-relaxed">
                      {widgetDefinition.description}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </DialogContent>
    </Dialog>
  )
})
