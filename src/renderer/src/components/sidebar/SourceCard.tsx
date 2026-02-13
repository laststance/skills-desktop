import { Folder, Loader2, RefreshCw, FolderSync } from 'lucide-react'
import { useEffect } from 'react'
import { toast } from 'sonner'

import { cn } from '../../lib/utils'
import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import { fetchAgents } from '../../redux/slices/agentsSlice'
import { fetchSkills } from '../../redux/slices/skillsSlice'
import {
  executeSyncAction,
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
export function SourceCard(): React.ReactElement {
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
   * Sync all source skills to all agents as symlinks
   * If no conflicts, executes immediately. If conflicts, opens dialog.
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

      // If no conflicts, execute immediately
      if (preview.conflicts.length === 0) {
        const result = await dispatch(
          executeSyncAction({ replaceConflicts: [] }),
        )
        if (executeSyncAction.fulfilled.match(result)) {
          toast.success('Sync completed', {
            description: `Created ${result.payload.created} symlinks`,
          })
          dispatch(fetchSkills())
          dispatch(fetchAgents())
          dispatch(fetchSourceStats())
        } else {
          toast.error('Sync failed')
        }
      }
      // If conflicts exist, the dialog will open via syncPreview state
    } else {
      toast.error('Failed to preview sync')
    }
  }

  return (
    <Card
      className={cn(
        'bg-card/50 border-l-4 border-l-transparent transition-colors',
        isActive && 'border-l-primary bg-primary/5',
      )}
    >
      <CardContent className="p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Folder className="h-4 w-4 text-primary" />
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-1.5 text-xs font-medium gap-1"
              onClick={handleSync}
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
            className="h-6 w-6"
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw
              className={`h-3 w-3 ${isRefreshing ? 'animate-spin' : ''}`}
            />
          </Button>
        </div>
        <div
          className="cursor-pointer hover:text-primary transition-colors"
          onClick={handlePathClick}
          title="Click to clear filters and show all skills"
        >
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
}
