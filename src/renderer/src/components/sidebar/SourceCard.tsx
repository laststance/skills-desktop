import { Folder, Loader2, RefreshCw, FolderSync } from 'lucide-react'
import React, { useEffect } from 'react'
import { toast } from 'sonner'

import { cn } from '../../lib/utils'
import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import { fetchAgents } from '../../redux/slices/agentsSlice'
import { fetchSkills } from '../../redux/slices/skillsSlice'
import {
  fetchSourceStats,
  fetchSyncPreview,
  selectAgent,
  setSearchQuery,
} from '../../redux/slices/uiSlice'
import { Button } from '../ui/button'
import { Card, CardContent } from '../ui/card'

/**
 * Source directory card showing stats, refresh, and sync buttons
 * Clicking the path clears all filters to show all skills
 */
export const SourceCard = React.memo(function SourceCard(): React.ReactElement {
  const dispatch = useAppDispatch()
  const { sourceStats, isRefreshing, isSyncing, selectedAgentId } =
    useAppSelector((state) => state.ui)
  const isActive = selectedAgentId === null

  useEffect(() => {
    dispatch(fetchSourceStats())
  }, [dispatch])

  const handleRefresh = (): void => {
    Promise.all([
      dispatch(fetchSourceStats()),
      dispatch(fetchSkills()),
      dispatch(fetchAgents()),
    ])
  }

  /**
   * Click path text → clear all filters and show all skills
   */
  const handlePathClick = (): void => {
    dispatch(selectAgent(null))
    dispatch(setSearchQuery(''))
  }

  /**
   * Fetch sync preview and let the appropriate dialog handle execution.
   * SyncConfirmDialog opens when there are symlinks to create (no conflicts).
   * SyncConflictDialog opens when conflicts exist.
   * Edge cases (no skills, already synced) are handled with toasts.
   */
  const handleSync = async (): Promise<void> => {
    const previewResult = await dispatch(fetchSyncPreview())

    if (fetchSyncPreview.fulfilled.match(previewResult)) {
      const preview = previewResult.payload

      if (preview.totalSkills === 0) {
        toast.info('No skills to sync')
        return
      }

      if (preview.toCreate === 0 && preview.conflicts.length === 0) {
        toast.info('Already synced', {
          description: `All ${preview.alreadySynced} skills are already linked`,
        })
        return
      }
      // Otherwise, syncPreview state in Redux will open the appropriate dialog
    } else {
      toast.error('Failed to preview sync')
    }
  }

  return (
    <Card
      className={cn(
        'bg-card/50 border-l-4 border-l-transparent transition-colors cursor-pointer',
        isActive && 'border-l-primary bg-primary/5',
      )}
      onClick={handlePathClick}
      title="Click to clear filters and show all skills"
    >
      <CardContent className="p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Folder className="h-4 w-4 text-primary" />
            <Button
              variant="ghost"
              size="sm"
              className="min-h-[44px] px-2 text-xs font-medium gap-1"
              onClick={(e) => {
                e.stopPropagation()
                handleSync()
              }}
              disabled={isSyncing}
            >
              {isSyncing ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <FolderSync className="h-3 w-3" />
              )}
              Sync
            </Button>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-11 w-11"
            onClick={(e) => {
              e.stopPropagation()
              handleRefresh()
            }}
            disabled={isRefreshing}
          >
            <RefreshCw
              className={`h-3 w-3 ${isRefreshing ? 'animate-spin' : ''}`}
            />
          </Button>
        </div>
        <div className="hover:text-primary transition-colors">
          <p className="text-sm font-medium truncate">~/.agents/skills</p>
          {sourceStats && (
            <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
              <span>{sourceStats.skillCount} skills</span>
              <span>{sourceStats.totalSize}</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
})
