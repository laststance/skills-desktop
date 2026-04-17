import { LayoutGrid, RefreshCw, RotateCw, Store } from 'lucide-react'
import React, { useCallback } from 'react'

import { useAppDispatch, useAppSelector } from '../../../redux/hooks'
import { resetToDefaults } from '../../../redux/slices/dashboardSlice'
import {
  fetchSyncPreview,
  selectIsRefreshing,
  selectIsSyncing,
  setActiveTab,
} from '../../../redux/slices/uiSlice'
import { refreshAllData } from '../../../redux/thunks'

// ----------------------------------------------------------------------------
// ActionTile — a single quick action button. Kept as a local component so we
// don't pay the abstraction cost elsewhere (only used here).
// ----------------------------------------------------------------------------

interface ActionTileProps {
  icon: React.ComponentType<{ className?: string }>
  label: string
  description: string
  onClick: () => void
  isBusy?: boolean
  accentClass?: string
}

const ActionTile = React.memo(function ActionTile({
  icon: Icon,
  label,
  description,
  onClick,
  isBusy = false,
  accentClass = 'text-foreground',
}: ActionTileProps): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isBusy}
      aria-label={label}
      className="
        group flex-1 min-w-0 min-h-[44px] flex items-center gap-2 px-3 py-2
        rounded-md border border-border/60 bg-background/30 text-left
        hover:bg-muted hover:border-border
        disabled:opacity-60 disabled:cursor-not-allowed
        transition-colors focus-visible:outline-none
        focus-visible:ring-2 focus-visible:ring-ring
      "
    >
      <Icon
        className={`h-4 w-4 shrink-0 ${accentClass} ${isBusy ? 'animate-spin' : ''}`}
        aria-hidden="true"
      />
      <div className="flex-1 min-w-0 flex flex-col">
        <span className="text-xs font-medium text-foreground truncate">
          {label}
        </span>
        <span className="text-[10px] text-muted-foreground truncate">
          {description}
        </span>
      </div>
    </button>
  )
})

/**
 * Quick Actions widget body.
 *
 * Four shortcuts the user needs most often from a cold start:
 *   - Sync: opens the sync preview dialog (fetches conflicts, then the
 *     existing SyncResultDialog handles execution + result display).
 *   - Refresh: re-reads skills/agents/source-stats in parallel via the
 *     shared `refreshAllData` thunk.
 *   - Open Marketplace: flips the main tab so the user lands on search.
 *   - Reset Layout: restores the default 4-page dashboard arrangement,
 *     preserving `welcomeDismissed` so reset is a "layout" thing, not a
 *     "preferences wipe".
 *
 * Spinning icons on Sync and Refresh mirror the status bar indicators so
 * the user sees activity without having to look elsewhere.
 */
export const QuickActionsWidget = React.memo(
  function QuickActionsWidget(): React.ReactElement {
    const dispatch = useAppDispatch()
    const isSyncing = useAppSelector(selectIsSyncing)
    const isRefreshing = useAppSelector(selectIsRefreshing)

    const handleSync = useCallback((): void => {
      dispatch(fetchSyncPreview())
    }, [dispatch])

    const handleRefresh = useCallback((): void => {
      refreshAllData(dispatch)
    }, [dispatch])

    const handleOpenMarketplace = useCallback((): void => {
      dispatch(setActiveTab('marketplace'))
    }, [dispatch])

    const handleResetLayout = useCallback((): void => {
      // No confirm dialog here by design — `welcomeDismissed` is preserved,
      // so reset is reversible (re-arrange manually) and data-safe.
      dispatch(resetToDefaults())
    }, [dispatch])

    return (
      <div className="h-full w-full flex flex-col justify-center p-3">
        <div className="grid grid-cols-2 gap-2">
          <ActionTile
            icon={RotateCw}
            label="Sync"
            description="Preview conflicts"
            onClick={handleSync}
            isBusy={isSyncing}
            accentClass="text-cyan-400"
          />
          <ActionTile
            icon={RefreshCw}
            label="Refresh"
            description="Re-scan local state"
            onClick={handleRefresh}
            isBusy={isRefreshing}
            accentClass="text-emerald-400"
          />
          <ActionTile
            icon={Store}
            label="Marketplace"
            description="Browse skills.sh"
            onClick={handleOpenMarketplace}
          />
          <ActionTile
            icon={LayoutGrid}
            label="Reset Layout"
            description="Restore default pages"
            onClick={handleResetLayout}
          />
        </div>
      </div>
    )
  },
)
