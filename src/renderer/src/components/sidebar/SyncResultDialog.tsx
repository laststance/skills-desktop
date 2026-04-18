import React from 'react'

import type { SyncResultAction } from '../../../../shared/types'
import {
  getSyncResultPresentation,
  shouldShowSyncResult,
} from '../../lib/syncHelpers'
import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import { clearSyncResult } from '../../redux/slices/uiSlice'
import { refreshAllData } from '../../redux/thunks'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { ScrollArea } from '../ui/scroll-area'

/** Maps sync result action to Badge variant for consistent status colors */
const ACTION_BADGE_VARIANT: Record<
  SyncResultAction,
  'valid' | 'broken' | 'destructive' | 'secondary'
> = {
  created: 'valid',
  replaced: 'broken',
  skipped: 'secondary',
  error: 'destructive',
}

/** Human-readable labels for each action type */
const ACTION_LABEL: Record<SyncResultAction, string> = {
  created: 'Created',
  replaced: 'Replaced',
  skipped: 'Skipped',
  error: 'Error',
}

/**
 * Dialog showing per-item sync results after execution.
 * Auto-opens when syncResult is populated by executeSyncAction.fulfilled.
 * Displays a scrollable list of each skill x agent action with color-coded badges.
 */
export const SyncResultDialog = React.memo(
  function SyncResultDialog(): React.ReactElement | null {
    const dispatch = useAppDispatch()
    const syncResult = useAppSelector((state) => state.ui.syncResult)
    const isOpen = shouldShowSyncResult(syncResult)

    const handleClose = (): void => {
      const hadChanges =
        syncResult !== null &&
        (syncResult.created > 0 ||
          syncResult.replaced > 0 ||
          syncResult.errors.length > 0)
      dispatch(clearSyncResult())
      if (hadChanges) {
        refreshAllData(dispatch)
      }
    }

    // Skip all derivations when dialog is closed
    if (!isOpen || !syncResult) return null

    const { HeaderIcon, iconColor, description } =
      getSyncResultPresentation(syncResult)

    return (
      <Dialog open={isOpen} onOpenChange={handleClose}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <HeaderIcon className={`h-5 w-5 ${iconColor}`} />
              <DialogTitle>Sync Results</DialogTitle>
            </div>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-3">
            <div className="flex gap-4 text-sm">
              {syncResult.created > 0 && (
                <span className="text-primary">
                  {syncResult.created} created
                </span>
              )}
              {syncResult.replaced > 0 && (
                <span className="text-amber-400">
                  {syncResult.replaced} replaced
                </span>
              )}
              {syncResult.errors.length > 0 && (
                <span className="text-destructive">
                  {syncResult.errors.length} errors
                </span>
              )}
              {syncResult.skipped > 0 && (
                <span className="text-muted-foreground">
                  {syncResult.skipped} skipped
                </span>
              )}
            </div>

            {syncResult.details.length > 0 ? (
              <ScrollArea className="max-h-[300px] rounded-md border p-2">
                <div className="space-y-1">
                  {syncResult.details.map((item, index) => (
                    <div
                      key={`${item.skillName}-${item.agentName}-${index}`}
                      className="flex items-center gap-3 p-2 rounded-md text-sm"
                    >
                      <Badge variant={ACTION_BADGE_VARIANT[item.action]}>
                        {ACTION_LABEL[item.action]}
                      </Badge>
                      <div className="min-w-0 flex-1">
                        <span className="font-medium">{item.skillName}</span>
                        <span className="text-muted-foreground">
                          {' '}
                          → {item.agentName}
                        </span>
                        {item.action === 'error' && (
                          <span className="text-xs text-destructive block truncate">
                            {item.error}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            ) : (
              <p className="text-sm text-muted-foreground">
                No items were processed.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button onClick={handleClose}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  },
)
