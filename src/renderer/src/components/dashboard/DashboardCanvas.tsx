import React, { useCallback, useEffect, useMemo } from 'react'
import ReactGridLayout, {
  useContainerWidth,
  type Layout,
} from 'react-grid-layout'

import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import {
  seedDefaultsIfEmpty,
  selectCurrentPage,
  selectIsEditMode,
  selectIsInitialized,
  updateLayout,
} from '../../redux/slices/dashboardSlice'

import { DashboardEditToolbar } from './DashboardEditToolbar'
import { DashboardPageTabs } from './DashboardPageTabs'
import type { WidgetInstance } from './types'
import { useDashboardKeyboardShortcuts } from './useDashboardKeyboardShortcuts'
import {
  GRID_COLS,
  GRID_CONTAINER_PADDING_PX,
  GRID_MARGIN_PX,
  GRID_ROW_HEIGHT_PX,
  WIDGET_DRAG_HANDLE_CLASS,
} from './utils/gridConstants'
import { getWidgetDefinition } from './widgets/registry'
import { WidgetShell } from './WidgetShell'

// Styles — required for react-grid-layout to position items correctly.
// RGL v2 bundles react-resizable CSS, so a single import covers both the
// grid positioning and the resize handle glyph.
import 'react-grid-layout/css/styles.css'

/**
 * Dashboard root — the right-pane content shown when no skill is selected.
 *
 * Layout: [PageTabs] [EditToolbar] / [ReactGridLayout with WidgetShells].
 *
 * Seeds default pages on first mount (idempotent), then reads everything
 * from Redux so react-grid-layout stays pure-view.
 */
export const DashboardCanvas = React.memo(
  function DashboardCanvas(): React.ReactElement {
    const dispatch = useAppDispatch()
    const currentPage = useAppSelector(selectCurrentPage)
    const isInitialized = useAppSelector(selectIsInitialized)
    const isEditMode = useAppSelector(selectIsEditMode)

    // Seed the default 4 pages on first render. The reducer guards against
    // re-seeding (`initialized` flag), so calling this repeatedly is free.
    useEffect(() => {
      if (!isInitialized) dispatch(seedDefaultsIfEmpty())
    }, [dispatch, isInitialized])

    // ⌘E toggle + ⌘1-9 page switch. Registered as long as the canvas is
    // mounted so the shortcuts work even when the user's focus is elsewhere
    // on the right pane.
    useDashboardKeyboardShortcuts()

    return (
      <div className="flex-1 min-h-0 flex flex-col">
        <DashboardPageTabs />
        <DashboardEditToolbar />
        <div className="flex-1 min-h-0 overflow-auto">
          {currentPage ? (
            <DashboardGrid
              pageId={currentPage.id}
              widgets={currentPage.widgets}
              isEditMode={isEditMode}
            />
          ) : null}
        </div>
      </div>
    )
  },
)

// ----------------------------------------------------------------------------
// Grid — inner component so the useContainerWidth hook can observe the scroll
// area ref directly and re-render on resize without shaking the parent.
// ----------------------------------------------------------------------------

interface DashboardGridProps {
  pageId: ReturnType<typeof selectCurrentPage> extends infer T
    ? T extends { id: infer I }
      ? I
      : never
    : never
  widgets: readonly WidgetInstance[]
  isEditMode: boolean
}

const DashboardGrid = React.memo(function DashboardGrid({
  pageId,
  widgets,
  isEditMode,
}: DashboardGridProps): React.ReactElement {
  const dispatch = useAppDispatch()
  const { width, containerRef, mounted } = useContainerWidth()

  // Shape widgets → RGL layout. `i` must equal the child's `key`, and we
  // carry over min sizes from the registry so RGL enforces them on resize.
  const layout = useMemo<Layout>(
    () =>
      widgets.map((widget) => {
        const def = getWidgetDefinition(widget.type)
        return {
          i: widget.id,
          x: widget.x,
          y: widget.y,
          w: widget.w,
          h: widget.h,
          minW: def?.minSize.w ?? 1,
          minH: def?.minSize.h ?? 1,
        }
      }),
    [widgets],
  )

  const handleLayoutChange = useCallback(
    (next: Layout) => {
      if (!pageId) return
      dispatch(
        updateLayout({
          pageId,
          layout: next.map((item) => ({
            i: item.i,
            x: item.x,
            y: item.y,
            w: item.w,
            h: item.h,
          })),
        }),
      )
    },
    [dispatch, pageId],
  )

  return (
    <div ref={containerRef} className="h-full w-full">
      {mounted && width > 0 && (
        <ReactGridLayout
          layout={layout}
          width={width}
          gridConfig={{
            cols: GRID_COLS,
            rowHeight: GRID_ROW_HEIGHT_PX,
            margin: GRID_MARGIN_PX,
            containerPadding: GRID_CONTAINER_PADDING_PX,
          }}
          dragConfig={{
            enabled: isEditMode,
            handle: `.${WIDGET_DRAG_HANDLE_CLASS}`,
          }}
          resizeConfig={{
            enabled: isEditMode,
            handles: ['se'],
          }}
          onLayoutChange={handleLayoutChange}
        >
          {widgets.map((widget) => {
            const def = getWidgetDefinition(widget.type)
            if (!def) return null // defensive: persisted state may reference removed types
            return (
              <div key={widget.id}>
                <WidgetShell instance={widget} definition={def} />
              </div>
            )
          })}
        </ReactGridLayout>
      )}
    </div>
  )
})
