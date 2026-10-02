import {
  Folder,
  FolderOpen,
  MoreVertical,
  RefreshCw,
  Terminal,
} from 'lucide-react'
import React, { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/renderer/src/components/ui/button'
import { Card, CardContent } from '@/renderer/src/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/renderer/src/components/ui/dropdown-menu'
import { useInitialEffect } from '@/renderer/src/hooks/useInitialEffect'
import { useOpenFolder } from '@/renderer/src/hooks/useOpenFolder'
import { cn } from '@/renderer/src/lib/utils'
import { useAppDispatch, useAppSelector } from '@/renderer/src/redux/hooks'
import { fetchAgents } from '@/renderer/src/redux/slices/agentsSlice'
import { fetchSkills } from '@/renderer/src/redux/slices/skillsSlice'
import {
  clearExcludedSkillTypeFilters,
  clearSelectedSources,
  fetchSourceStats,
  selectAgent,
  setActiveTab,
  setSearchQuery,
  setSkillTypeFilter,
} from '@/renderer/src/redux/slices/uiSlice'
import { toSearchQuery } from '@/shared/types'

/**
 * Source directory card showing stats, refresh, and folder actions
 * Clicking the path clears all filters to show all skills
 */
export const SourceCard = function SourceCard(): React.ReactElement {
  const dispatch = useAppDispatch()
  const { sourceStats, isRefreshing, selectedAgentId } = useAppSelector(
    (state) => state.ui,
  )
  const isActive = selectedAgentId === null
  const [contextOpen, setContextOpen] = useState(false)
  const { revealInFinder, openInTerminal } = useOpenFolder()

  useInitialEffect(() => {
    dispatch(fetchSourceStats())
  })

  const handleRefresh = async (): Promise<void> => {
    try {
      await Promise.all([
        dispatch(fetchSourceStats()).unwrap(),
        dispatch(fetchSkills()).unwrap(),
        dispatch(fetchAgents()).unwrap(),
      ])
    } catch {
      toast.error('Failed to refresh data')
    }
  }

  /**
   * Click path text → clear all filters and show all skills
   */
  const handlePathClick = (): void => {
    // Source-card navigation is the sidebar's universal installed-skills view,
    // so it leaves Marketplace before clearing filters.
    dispatch(setActiveTab('installed'))
    dispatch(selectAgent(null))
    dispatch(setSearchQuery(toSearchQuery('')))
    // Drop the source-repo include filter too — the card's contract ("clear
    // all filters and show all skills") was previously half-kept, leaving a
    // repo narrow active after the click.
    dispatch(clearSelectedSources())
    // selectAgent no longer resets the skill-type axes (filters persist across
    // agent switches), so the clear-all contract resets them explicitly —
    // otherwise a persisted 'orphan'/'local' survives this click.
    dispatch(setSkillTypeFilter('all'))
    dispatch(clearExcludedSkillTypeFilters())
  }

  /**
   * Right-click on the card body opens the same DropdownMenu the kebab opens.
   * `preventDefault` suppresses the OS context menu; `stopPropagation` keeps
   * the Card-level `onClick` (which clears filters) from also firing.
   * No-ops while sourceStats hasn't loaded — without a path there is nothing
   * to reveal.
   */
  const handleContextMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    if (!sourceStats) return
    setContextOpen(true)
  }

  const handleRevealInFinder = (): void => {
    if (!sourceStats) return
    void revealInFinder(sourceStats.path)
  }

  const handleOpenInTerminal = (): void => {
    if (!sourceStats) return
    void openInTerminal(sourceStats.path)
  }

  const handleContextOpenChange = (open: boolean): void => {
    if (!open) setContextOpen(false)
  }

  const handleRefreshClick = (e: React.MouseEvent): void => {
    e.stopPropagation()
    handleRefresh()
  }

  const handleKebabClick = (e: React.MouseEvent): void => {
    e.stopPropagation()
    setContextOpen((prev) => !prev)
  }

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
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
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
            {sourceStats &&
              (sourceStats.isUnreadable ? (
                // A folder we could not open must never be reported as "0 skills" —
                // that reads as "you have no skills" and sends users reinstalling.
                // `text-amber-400` is DESIGN.md's needs-review status-text hue;
                // the `text-amber-300` exception is only for badge text sitting
                // on an amber tint, and this notice has no background.
                <div className="mt-2 text-xs text-amber-400">
                  Folder could not be read — check its permissions
                </div>
              ) : (
                <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                  <span>{sourceStats.skillCount} skills</span>
                  <span>{sourceStats.totalSize}</span>
                </div>
              ))}
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
}
