import { Copy, Loader2, Trash2, Unlink, X } from 'lucide-react'
import React from 'react'

import { Button } from '@/renderer/src/components/ui/button'
import { cn } from '@/renderer/src/lib/utils'
import { useAppDispatch, useAppSelector } from '@/renderer/src/redux/hooks'
import {
  selectBulkSelectableVisibleSkillNames,
  selectHiddenSelectedCount,
  selectSelectedCount,
  selectSelectedVisibleCount,
  selectVisibleIneligibleSelectedCount,
} from '@/renderer/src/redux/selectors'
import {
  clearSelection,
  selectAll,
  selectBulkCopying,
  selectBulkDeleting,
  selectBulkProgress,
  selectBulkUnlinking,
} from '@/renderer/src/redux/slices/skillsSlice'
import {
  selectBulkSelectMode,
  selectSelectedAgentId,
} from '@/renderer/src/redux/slices/uiSlice'
import { BULK_PROGRESS_THRESHOLD } from '@/shared/constants'

import { getToolbarState } from './bulkDeleteHelpers'

interface SelectionToolbarProps {
  /**
   * Callback fired when the primary destructive action is confirmed.
   * MainContent passes the actual dispatch (deleteSelectedSkills /
   * unlinkSelectedFromAgent) so the toolbar stays presentation-only.
   */
  onPrimaryAction: () => void
  /**
   * The name of the currently selected agent (for agent-view unlink label).
   * Undefined when in global view.
   */
  agentDisplayName?: string
  /**
   * Callback fired when the non-destructive "Copy to…" action is clicked.
   * MainContent opens the BulkCopyToAgentsModal. Only rendered in global view
   * (selectedAgentId === null); omit it to hide the button.
   */
  onCopyAction?: () => void
}

/**
 * Sticky selection band above the skills list. Renders whenever bulk select
 * mode is active — including the zero-selection state where only "Select all
 * visible ⌘A" is shown so users can bulk-select without first manually ticking
 * a row. Shows:
 *   - `N selected` (aria-live="polite") — hidden at 0 selections
 *   - `+K hidden by filter` badge when some ticked names are outside the filter
 *   - `+K not eligible` badge when visible rows cannot use the bulk action
 *   - Primary action button (Delete / Unlink) whose label varies by view — hidden at 0
 *   - "Select all visible ⌘A" always; "Clear Esc" and Copy only when ≥1 selected
 *   - Progress counter ("3 of 12") during active bulk op when total >= 10
 *
 * The component is presentation-only — it never dispatches the actual bulk op.
 * The caller (MainContent) owns the confirmation + dispatch flow.
 *
 * @param onPrimaryAction - Callback when the user clicks the destructive button
 * @param agentDisplayName - For the "Unlink from {agent}" label
 * @returns Rendered toolbar or null when not in bulk select mode
 */
export const SelectionToolbar = function SelectionToolbar({
  onPrimaryAction,
  agentDisplayName,
  onCopyAction,
}: SelectionToolbarProps): React.ReactElement | null {
  const dispatch = useAppDispatch()

  const selectedCount = useAppSelector(selectSelectedCount)
  const visibleSelectedCount = useAppSelector(selectSelectedVisibleCount)
  const hiddenSelectedCount = useAppSelector(selectHiddenSelectedCount)
  const visibleIneligibleSelectedCount = useAppSelector(
    selectVisibleIneligibleSelectedCount,
  )
  const visibleNames = useAppSelector(selectBulkSelectableVisibleSkillNames)
  const selectedAgentId = useAppSelector(selectSelectedAgentId)
  const bulkSelectMode = useAppSelector(selectBulkSelectMode)
  const bulkDeleting = useAppSelector(selectBulkDeleting)
  const bulkUnlinking = useAppSelector(selectBulkUnlinking)
  const bulkCopying = useAppSelector(selectBulkCopying)
  const bulkProgress = useAppSelector(selectBulkProgress)

  const handleSelectAllVisible = (): void => {
    dispatch(selectAll(visibleNames))
  }

  const handleClear = (): void => {
    dispatch(clearSelection())
  }

  // Belt-and-suspenders: the listener middleware already clears selection on
  // any context switch that exits bulkSelectMode, but gating here enforces the
  // invariant at the render boundary too. The destructive Delete/Unlink action
  // must only be reachable while the selection is visually auditable (i.e. the
  // per-row checkboxes are rendered). If selection were ever to outlive mode,
  // this gate prevents a Delete click over invisible state.
  if (!bulkSelectMode) return null

  // Computed only when items are selected; null in the zero-selection state.
  const toolbarState =
    selectedCount > 0
      ? getToolbarState({
          view: selectedAgentId ? 'agent' : 'global',
          agentId: selectedAgentId,
          count: selectedCount,
          visibleCount: visibleSelectedCount,
          agentDisplayName,
        })
      : null
  const isBusy = bulkDeleting || bulkUnlinking || bulkCopying

  const showProgress =
    bulkProgress !== null && bulkProgress.total >= BULK_PROGRESS_THRESHOLD

  return (
    <div
      // Sticky below the search/filter row; matches the border styling of
      // MainContent's neighbouring bars for visual continuity. `gap-y-2` gives
      // the action cluster breathing room on the rare second row at narrow
      // widths; `gap-x-3` keeps the count↔cluster horizontal rhythm.
      className="px-4 py-2 border-b border-border bg-primary/5 flex items-center gap-x-3 gap-y-2 flex-wrap"
      // `role="group"` rather than `role="toolbar"`: the WAI-ARIA toolbar
      // pattern requires roving-tabindex arrow-key navigation between its
      // children, which we do not implement. `group` keeps the labelled
      // container semantics without overclaiming behaviour we don't provide.
      // react-doctor-disable-next-line react-doctor/prefer-tag-over-role -- role="group" is the correct labelled-container semantic; <address> (react-doctor's suggestion) is for contact info, not a toolbar group.
      role="group"
      aria-label="Bulk selection actions"
    >
      {/* Count text — only shown once ≥1 item is ticked. */}
      {selectedCount > 0 && (
        <span
          aria-live="polite"
          className="text-sm font-medium tabular-nums shrink-0"
        >
          {selectedCount === 1 ? '1 selected' : `${selectedCount} selected`}
        </span>
      )}

      {/* Hidden-by-filter indicator — warns the user that not all ticked rows
           will be affected when the filter hides some of them. */}
      {selectedCount > 0 && hiddenSelectedCount > 0 && (
        <span
          className="text-xs text-muted-foreground shrink-0"
          title={`${hiddenSelectedCount} selected ${hiddenSelectedCount === 1 ? 'row is' : 'rows are'} hidden by the current filter and will not be affected`}
        >
          +{hiddenSelectedCount} hidden by filter
        </span>
      )}

      {/* Visible-but-ineligible indicator — separates on-screen manual-review
           rows from genuinely hidden filtered selections. */}
      {selectedCount > 0 && visibleIneligibleSelectedCount > 0 && (
        <span
          className="text-xs text-muted-foreground shrink-0"
          title={`${visibleIneligibleSelectedCount} selected ${visibleIneligibleSelectedCount === 1 ? 'row is' : 'rows are'} visible but cannot use this bulk action`}
        >
          +{visibleIneligibleSelectedCount} not eligible
        </span>
      )}

      {/* Progress counter — only during large batches to reduce noise. */}
      {selectedCount > 0 && showProgress && (
        <span
          aria-live="polite"
          className="text-xs text-muted-foreground tabular-nums shrink-0"
        >
          {bulkProgress.current} of {bulkProgress.total}
        </span>
      )}

      {/* Action cluster — kept as one `ml-auto` right-aligned group so that
           when the count + buttons exceed the panel width the whole cluster
           wraps to a second row as a cohesive, right-aligned block, rather than
           the toolbar's own flex-wrap orphaning the trailing primary button on a
           lone left-aligned row. Also absorbs agent-view's long "Unlink from
           {agent}" label without disturbing the count on the left. */}
      <div className="ml-auto flex items-center gap-2 flex-wrap justify-end">
        {/* Always visible — the zero-selection entry point (Fixes #227 / #230). */}
        <Button
          variant="ghost"
          size="sm"
          onClick={handleSelectAllVisible}
          disabled={isBusy}
          aria-label="Select all visible"
          className="shrink-0"
        >
          Select all visible
          <kbd className="ml-1.5 text-[10px] opacity-50 bg-muted px-1 py-0.5 rounded font-mono leading-none">
            ⌘A
          </kbd>
        </Button>

        {/* Clear + Esc badge — only once something is selected. */}
        {selectedCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClear}
            disabled={isBusy}
            aria-label="Clear"
            className="shrink-0"
          >
            <X className="h-3 w-3 mr-1" />
            Clear
            <kbd className="ml-1.5 text-[10px] opacity-50 bg-muted px-1 py-0.5 rounded font-mono leading-none">
              Esc
            </kbd>
          </Button>
        )}

        {/* Non-destructive bulk copy — global view only, ≥1 selected. */}
        {selectedCount > 0 && selectedAgentId === null && onCopyAction && (
          <Button
            variant="outline"
            size="sm"
            onClick={onCopyAction}
            disabled={isBusy}
            aria-label="Copy selected skills to agents"
            className="shrink-0"
          >
            <Copy className="h-4 w-4" />
            Copy to...
          </Button>
        )}

        {/* Primary destructive / Unlink action — only when ≥1 selected. */}
        {selectedCount > 0 && toolbarState && (
          <Button
            variant={toolbarState.isDestructive ? 'destructive' : 'default'}
            size="sm"
            onClick={onPrimaryAction}
            disabled={toolbarState.isPrimaryDisabled || isBusy}
            aria-label={toolbarState.primaryAriaLabel}
            className={cn(
              'shrink-0 gap-1.5',
              toolbarState.isDestructive && 'font-medium',
            )}
          >
            {isBusy ? (
              <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
            ) : toolbarState.isDestructive ? (
              <Trash2 className="h-4 w-4" />
            ) : (
              <Unlink className="h-4 w-4" />
            )}
            {toolbarState.primaryLabel}
          </Button>
        )}
      </div>
    </div>
  )
}
