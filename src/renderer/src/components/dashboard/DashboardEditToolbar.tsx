import { LayoutGrid, Pencil, PencilOff, Plus, RotateCcw } from 'lucide-react'
import React, { useCallback, useState } from 'react'

import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import {
  addPage,
  resetToDefaults,
  selectIsEditMode,
  toggleEditMode,
} from '../../redux/slices/dashboardSlice'
import { Button } from '../ui/button'

import { WidgetPicker } from './WidgetPicker'

/**
 * Edit-mode toggle bar.
 *
 * View mode: shows just the Edit toggle — keeps the default dashboard chrome
 * minimal.
 *
 * Edit mode: reveals three customization affordances side-by-side with the
 * Done button:
 *   - "+ Widget" opens WidgetPicker (the reducer auto-overflows to a new
 *      page when the current one is full).
 *   - "+ Page" appends a blank page and switches to it.
 *   - "Reset" asks for confirmation, then restores the default preset
 *      (welcomeDismissed is preserved — reset is layout-only).
 *
 * Gating the destructive affordances behind the edit toggle mirrors how
 * native macOS apps hide customization until the user opts in — clean
 * default, full control once requested.
 */
export const DashboardEditToolbar = React.memo(
  function DashboardEditToolbar(): React.ReactElement {
    const dispatch = useAppDispatch()
    const isEditMode = useAppSelector(selectIsEditMode)
    const [isPickerOpen, setIsPickerOpen] = useState(false)

    const handleOpenPicker = useCallback((): void => {
      setIsPickerOpen(true)
    }, [])

    const handleAddPage = useCallback((): void => {
      dispatch(addPage())
    }, [dispatch])

    const handleResetLayout = useCallback((): void => {
      // Destructive: user's custom arrangement is replaced by the preset.
      // Confirm before throwing away work — `window.confirm` is adequate here
      // since this is a rare, deliberate action.
      const userConfirmed = window.confirm(
        'Reset dashboard to default layout? Your current arrangement will be lost.',
      )
      if (userConfirmed) {
        dispatch(resetToDefaults())
      }
    }, [dispatch])

    return (
      <>
        <div className="flex items-center justify-end gap-1 px-3 py-1 border-b border-border shrink-0">
          {isEditMode && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleOpenPicker}
                className="min-h-[44px] gap-1.5 text-xs"
              >
                <Plus className="h-3.5 w-3.5" />
                Widget
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleAddPage}
                className="min-h-[44px] gap-1.5 text-xs"
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                Page
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleResetLayout}
                className="min-h-[44px] gap-1.5 text-xs text-muted-foreground"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset
              </Button>
            </>
          )}
          <Button
            variant={isEditMode ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => dispatch(toggleEditMode())}
            aria-pressed={isEditMode}
            className="min-h-[44px] gap-1.5 text-xs"
          >
            {isEditMode ? (
              <>
                <PencilOff className="h-3.5 w-3.5" />
                Done
              </>
            ) : (
              <>
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </>
            )}
          </Button>
        </div>
        <WidgetPicker open={isPickerOpen} onOpenChange={setIsPickerOpen} />
      </>
    )
  },
)
