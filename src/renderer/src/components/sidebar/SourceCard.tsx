import {
  Folder,
  FolderOpen,
  FolderSync,
  Loader2,
  MoreVertical,
  RefreshCw,
  Terminal,
} from 'lucide-react'
import React, { useCallback, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/renderer/src/components/ui/button'
import { Card, CardContent } from '@/renderer/src/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/renderer/src/components/ui/dropdown-menu'
import { useComponentEffect } from '@/renderer/src/hooks/useComponentEffect'
import { useOpenFolder } from '@/renderer/src/hooks/useOpenFolder'
import { cn } from '@/renderer/src/lib/utils'
import { useAppDispatch, useAppSelector } from '@/renderer/src/redux/hooks'
import { fetchAgents } from '@/renderer/src/redux/slices/agentsSlice'
import { fetchSkills } from '@/renderer/src/redux/slices/skillsSlice'
import {
  fetchSourceStats,
  fetchSyncPreview,
  selectAgent,
  setSearchQuery,
  setSyncPreview,
} from '@/renderer/src/redux/slices/uiSlice'

/**
 * Source directory card showing stats, refresh, and sync buttons
 * Clicking the path clears all filters to show all skills
 */
export const SourceCard = React.memo(function SourceCard(): React.ReactElement {
  const dispatch = useAppDispatch()
  const { sourceStats, isRefreshing, isSyncing, selectedAgentId } =
    useAppSelector((state) => state.ui)
  const isActive = selectedAgentId === null
  const [contextOpen, setContextOpen] = useState(false)
  const { revealInFinder, openInTerminal } = useOpenFolder()

  useComponentEffect(() => {
    dispatch(fetchSourceStats())
  }, [dispatch])

  const handleRefresh = useCallback(async (): Promise<void> => {
    try {
      await Promise.all([
        dispatch(fetchSourceStats()).unwrap(),
        dispatch(fetchSkills()).unwrap(),
        dispatch(fetchAgents()).unwrap(),
      ])
    } catch {
      toast.error('Failed to refresh data')
    }
  }, [dispatch])

  /**
   * Click path text → clear all filters and show all skills
   */
  const handlePathClick = useCallback((): void => {
    dispatch(selectAgent(null))
    dispatch(setSearchQuery(''))
  }, [dispatch])

  /**
   * Right-click on the card body opens the same DropdownMenu the kebab opens.
   * `preventDefault` suppresses the OS context menu; `stopPropagation` keeps
   * the Card-level `onClick` (which clears filters) from also firing.
   * No-ops while sourceStats hasn't loaded — without a path there is nothing
   * to reveal.
   */
  const handleContextMenu = useCallback(
    (e: React.MouseEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (!sourceStats) return
      setContextOpen(true)
    },
    [sourceStats],
  )

  const handleRevealInFinder = useCallback((): void => {
    if (!sourceStats) return
    void revealInFinder(sourceStats.path)
  }, [revealInFinder, sourceStats])

  const handleOpenInTerminal = useCallback((): void => {
    if (!sourceStats) return
    void openInTerminal(sourceStats.path)
  }, [openInTerminal, sourceStats])

  /**
   * Fetch sync preview and let the appropriate dialog handle execution.
   * SyncConfirmDialog opens when there are symlinks to create (no conflicts).
   * SyncConflictDialog opens when conflicts exist.
   * Edge cases (no skills, already synced) are handled with toasts.
   */
  const handleSync = useCallback(async (): Promise<void> => {
    const previewResult = await dispatch(fetchSyncPreview())

    if (fetchSyncPreview.fulfilled.match(previewResult)) {
      const preview = previewResult.payload

      if (preview.totalSkills === 0) {
        dispatch(setSyncPreview(null))
        toast.info('No skills to sync')
        return
      }

      if (preview.toCreate === 0 && preview.conflicts.length === 0) {
        dispatch(setSyncPreview(null))
        toast.info('Already synced', {
          description: `All ${preview.alreadySynced} skills are already linked`,
        })
        return
      }
      // Otherwise, syncPreview state in Redux will open the appropriate dialog
    } else {
      toast.error('Failed to preview sync')
    }
  }, [dispatch])

  const handleContextOpenChange = useCallback((open: boolean): void => {
    if (!open) setContextOpen(false)
  }, [])

  const handleSyncClick = useCallback(
    (e: React.MouseEvent): void => {
      e.stopPropagation()
      void handleSync()
    },
    [handleSync],
  )

  const handleRefreshClick = useCallback(
    (e: React.MouseEvent): void => {
      e.stopPropagation()
      handleRefresh()
    },
    [handleRefresh],
  )

  const handleKebabClick = useCallback((e: React.MouseEvent): void => {
    e.stopPropagation()
    setContextOpen((prev) => !prev)
  }, [])

  return (
    <DropdownMenu open={contextOpen} onOpenChange={handleContextOpenChange}>
      <Card
        className={cn(
          'bg-card/50 border-l-4 border-l-transparent transition-colors cursor-pointer',
          isActive && 'border-l-primary bg-primary/5',
        )}
        onClick={handlePathClick}
        onContextMenu={handleContextMenu}
        title="Click to clear filters and show all skills"
      >
        <CardContent className="p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Folder className="h-4 w-4 text-primary" />
              <Button
                variant="ghost"
                size="sm"
                className="min-h-11 px-2 text-xs font-medium gap-1"
                onClick={handleSyncClick}
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
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-11 w-11"
                aria-label={
                  isRefreshing
                    ? 'Refreshing skills and agent status'
                    : 'Refresh skills and agent status'
                }
                onClick={handleRefreshClick}
                disabled={isRefreshing}
              >
                <RefreshCw
                  className={`h-3 w-3 ${isRefreshing ? 'animate-spin' : ''}`}
                />
              </Button>
              {/* Kebab uses asChild so the Button itself becomes the trigger — */}
              {/* avoids a nested button (a11y violation) and routes the open */}
              {/* state through the controlled `contextOpen` flag. */}
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-11 w-11"
                  aria-label="Source folder actions"
                  disabled={!sourceStats}
                  onClick={handleKebabClick}
                >
                  <MoreVertical className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
            </div>
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
      <DropdownMenuContent align="end">
        {/* `onSelect` (not `onClick`) — Radix DropdownMenu.Item only fires */}
        {/* `onSelect` for keyboard activation (Enter/Space). `onClick` would */}
        {/* silently no-op for keyboard-only users. */}
        <DropdownMenuItem onSelect={handleRevealInFinder}>
          <FolderOpen className="h-4 w-4 mr-2" />
          Reveal in Finder
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={handleOpenInTerminal}>
          <Terminal className="h-4 w-4 mr-2" />
          Open in Terminal
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
})
