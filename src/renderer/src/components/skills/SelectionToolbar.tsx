import { Loader2, Trash2, Unlink, X } from 'lucide-react'
import React from 'react'

import { BULK_PROGRESS_THRESHOLD } from '../../../../shared/constants'
import { cn } from '../../lib/utils'
import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import {
  selectHiddenSelectedCount,
  selectSelectedCount,
  selectSelectedVisibleCount,
  selectVisibleSkillNames,
} from '../../redux/selectors'
import {
  clearSelection,
  selectAll,
  selectBulkCliRemoving,
  selectBulkDeleting,
  selectBulkProgress,
  selectBulkUnlinking,
} from '../../redux/slices/skillsSlice'
import {
  selectBulkSelectMode,
  selectSelectedAgentId,
} from '../../redux/slices/uiSlice'
import { Button } from '../ui/button'

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
}

/**
 * Sticky selection band above the skills list. Renders only when at least one
 * skill is ticked. Shows:
 *   - `N selected` (aria-live="polite")
 *   - `+K hidden by filter` badge when some ticked names are outside the filter
 *   - Primary action button (Delete / Unlink) whose label varies by view
 *   - Secondary "Select all visible" + "Clear selection" buttons
 *   - Progress counter ("3 of 12") during active bulk op when total >= 10
 *
 * The component is presentation-only — it never dispatches the actual bulk op.
 * The caller (MainContent) owns the confirmation + dispatch flow.
 *
 * @param onPrimaryAction - Callback when the user clicks the destructive button
 * @param agentDisplayName - For the "Unlink from {agent}" label
 * @returns Rendered toolbar or null when no rows are selected
 */
export const SelectionToolbar = React.memo(function SelectionToolbar({
  onPrimaryAction,
  agentDisplayName,
}: SelectionToolbarProps): React.ReactElement | null {
  const dispatch = useAppDispatch()

  const selectedCount = useAppSelector(selectSelectedCount)
  const visibleSelectedCount = useAppSelector(selectSelectedVisibleCount)
  const hiddenSelectedCount = useAppSelector(selectHiddenSelectedCount)
  const visibleNames = useAppSelector(selectVisibleSkillNames)
  const selectedAgentId = useAppSelector(selectSelectedAgentId)
  const bulkSelectMode = useAppSelector(selectBulkSelectMode)
  const bulkDeleting = useAppSelector(selectBulkDeleting)
  const bulkUnlinking = useAppSelector(selectBulkUnlinking)
  const bulkCliRemoving = useAppSelector(selectBulkCliRemoving)
  const bulkProgress = useAppSelector(selectBulkProgress)

  // Belt-and-suspenders: the listener middleware already clears selection on
  // any context switch that exits bulkSelectMode, but gating here enforces the
  // invariant at the render boundary too. The destructive Delete/Unlink action
  // must only be reachable while the selection is visually auditable (i.e. the
  // per-row checkboxes are rendered). If selection were ever to outlive mode,
  // this gate prevents a Delete click over invisible state.
  if (!bulkSelectMode || selectedCount === 0) return null

  const toolbarState = getToolbarState({
    view: selectedAgentId ? 'agent' : 'global',
    agentId: selectedAgentId,
    count: selectedCount,
    visibleCount: visibleSelectedCount,
    agentDisplayName,
  })
  // OR bulkCliRemoving too — the CLI batch loop spawns npx serially
  // (~600ms–2s each) with no per-item progress, so without this the user
  // could double-click and fire a second batch while the first is still
  // running against the shared `.skill-lock.json` file.
  const isBusy = bulkDeleting || bulkUnlinking || bulkCliRemoving

  const showProgress =
    bulkProgress !== null && bulkProgress.total >= BULK_PROGRESS_THRESHOLD

  const handleSelectAllVisible = (): void => {
    dispatch(selectAll(visibleNames))
  }

  const handleClear = (): void => {
    dispatch(clearSelection())
  }

  return (
    <div
      // Sticky below the search/filter row; matches the border styling of
      // MainContent's neighbouring bars for visual continuity.
      className="px-4 py-2 border-b border-border bg-primary/5 flex items-center gap-3 flex-wrap"
      // `role="group"` rather than `role="toolbar"`: the WAI-ARIA toolbar
      // pattern requires roving-tabindex arrow-key navigation between its
      // children, which we do not implement. `group` keeps the labelled
      // container semantics without overclaiming behaviour we don't provide.
      role="group"
      aria-label="Bulk selection actions"
    >
      <span
        aria-live="polite"
        className="text-sm font-medium tabular-nums shrink-0"
      >
        {selectedCount === 1 ? '1 selected' : `${selectedCount} selected`}
      </span>

      {/* Hidden-by-filter indicator — warns the user that not all ticked rows
          will be affected when the filter hides some of them. */}
      {hiddenSelectedCount > 0 && (
        <span
          className="text-xs text-muted-foreground shrink-0"
          title={`${hiddenSelectedCount} selected ${hiddenSelectedCount === 1 ? 'row is' : 'rows are'} hidden by the current filter and will not be affected`}
        >
          +{hiddenSelectedCount} hidden by filter
        </span>
      )}

      {/* Progress counter — only during large batches to reduce noise. */}
      {showProgress && (
        <span
          aria-live="polite"
          className="text-xs text-muted-foreground tabular-nums shrink-0"
        >
          {bulkProgress.current} of {bulkProgress.total}
        </span>
      )}

      <div className="flex-1" />

      <Button
        variant="ghost"
        size="sm"
        onClick={handleSelectAllVisible}
        disabled={isBusy}
        className="shrink-0 min-h-[44px]"
      >
        Select all visible
      </Button>

      <Button
        variant="ghost"
        size="sm"
        onClick={handleClear}
        disabled={isBusy}
        className="shrink-0 min-h-[44px]"
      >
        <X className="h-3 w-3 mr-1" />
        Clear
      </Button>

      <Button
        variant={toolbarState.isDestructive ? 'destructive' : 'default'}
        size="sm"
        onClick={onPrimaryAction}
        disabled={toolbarState.isPrimaryDisabled || isBusy}
        aria-label={toolbarState.primaryAriaLabel}
        className={cn(
          'shrink-0 min-h-[44px] gap-1.5',
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
    </div>
  )
})
