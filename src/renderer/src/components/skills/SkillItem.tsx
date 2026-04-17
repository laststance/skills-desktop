import {
  BookmarkCheck,
  BookmarkPlus,
  Copy,
  FolderDot,
  Link2,
  Plus,
  X,
} from 'lucide-react'
import React, { useMemo, useState } from 'react'

import type { Skill } from '../../../../shared/types'
import { cn } from '../../lib/utils'
import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import {
  addBookmark,
  removeBookmark,
  selectIsBookmarked,
} from '../../redux/slices/bookmarkSlice'
import {
  selectSkill,
  setSkillToAddSymlinks,
  setSkillToCopy,
  setSkillToDelete,
  setSkillToUnlink,
} from '../../redux/slices/skillsSlice'
import { StatusBadge } from '../status/StatusBadge'
import { Button } from '../ui/button'
import { Card, CardContent } from '../ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

import { canBookmarkSkill, skillToBookmarkData } from './bookmarkHelpers'
import { getSkillItemVisibility } from './skillItemHelpers'
import { SourceLink } from './SourceLink'

interface SkillItemProps {
  skill: Skill
}

/**
 * Single skill card in the skills list.
 * Shows a top-right X button that deletes the skill in global view, or
 * unlinks/deletes from the selected agent in agent view. Add button creates symlinks.
 */
export const SkillItem = React.memo(function SkillItem({
  skill,
}: SkillItemProps): React.ReactElement {
  const dispatch = useAppDispatch()
  const { selectedSkill } = useAppSelector((state) => state.skills)
  const { selectedAgentId } = useAppSelector((state) => state.ui)
  const { items: agents } = useAppSelector((state) => state.agents)
  const isSelected = selectedSkill?.path === skill.path
  const isBookmarked = useAppSelector((state) =>
    selectIsBookmarked(state, skill.name),
  )
  const showBookmark = canBookmarkSkill(skill)

  const validSymlinks = useMemo(
    () => skill.symlinks.filter((s) => s.status === 'valid'),
    [skill.symlinks],
  )
  const brokenSymlinks = useMemo(
    () => skill.symlinks.filter((s) => s.status === 'broken'),
    [skill.symlinks],
  )
  const validCount = validSymlinks.length
  const brokenCount = brokenSymlinks.length
  const validAgentNames = useMemo(
    () => validSymlinks.map((s) => s.agentName),
    [validSymlinks],
  )
  const brokenAgentNames = useMemo(
    () => brokenSymlinks.map((s) => s.agentName),
    [brokenSymlinks],
  )

  const {
    showDeleteButton,
    showAddButton,
    showUnlinkButton,
    showCopyButton,
    isLinked,
    isLocalSkill,
    selectedAgentSymlink,
    selectedLocalSkillInfo,
  } = getSkillItemVisibility(selectedAgentId, skill.symlinks)

  // Get selected agent name for tooltip
  const selectedAgentName =
    agents.find((a) => a.id === selectedAgentId)?.name || 'agent'

  const handleUnlinkClick = (e: React.MouseEvent): void => {
    e.stopPropagation()
    const targetSymlink = selectedAgentSymlink ?? selectedLocalSkillInfo
    if (targetSymlink) {
      dispatch(setSkillToUnlink({ skill, symlink: targetSymlink }))
    }
  }

  const handleDeleteClick = (e: React.MouseEvent): void => {
    e.stopPropagation()
    dispatch(setSkillToDelete(skill))
  }

  const handleAddClick = (e: React.MouseEvent): void => {
    e.stopPropagation()
    dispatch(setSkillToAddSymlinks(skill))
  }

  const handleToggleBookmark = (e: React.MouseEvent): void => {
    e.stopPropagation()
    if (isBookmarked) {
      dispatch(removeBookmark(skill.name))
    } else {
      const { repo, url } = skillToBookmarkData(skill)
      dispatch(addBookmark({ name: skill.name, repo, url }))
    }
  }

  const [contextOpen, setContextOpen] = useState(false)

  const handleContextMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    if (!showCopyButton) return
    setContextOpen(true)
  }

  const handleCopyClick = (): void => {
    dispatch(setSkillToCopy(skill))
    setContextOpen(false)
  }

  return (
    <DropdownMenu
      open={contextOpen}
      onOpenChange={(open) => {
        if (!open) setContextOpen(false)
      }}
    >
      <DropdownMenuTrigger asChild disabled={!showCopyButton}>
        <Card
          className={cn(
            'group cursor-pointer transition-colors hover:border-primary/50 relative',
            isSelected && 'border-primary bg-primary/5',
            isLinked && 'border-l-2 border-l-cyan-400/40',
            isLocalSkill && 'border-l-2 border-l-emerald-400/40',
          )}
          onClick={() => dispatch(selectSkill(isSelected ? null : skill))}
          onContextMenu={handleContextMenu}
        >
          {/* X button — top-right delete/unlink action.
              In global view: deletes the skill entirely.
              In agent view: unlinks symlink, or deletes local skill from agent.
              Apple HIG: 44×44 hit area via min-h/min-w; visible icon stays compact
              so the two actions don't visually collide on the card. */}
          {(showDeleteButton || showUnlinkButton) && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={
                    showDeleteButton ? handleDeleteClick : handleUnlinkClick
                  }
                  className="absolute top-0 right-0 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive z-10 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left">
                {showDeleteButton
                  ? 'Delete skill'
                  : isLocalSkill
                    ? `Delete from ${selectedAgentName}`
                    : `Remove from ${selectedAgentName}`}
              </TooltipContent>
            </Tooltip>
          )}

          {/* Bookmark toggle — only for skills with repo source.
              Positioned to the left of the X button with a 44×44 hit area. */}
          {showBookmark && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleToggleBookmark}
                  aria-label={
                    isBookmarked
                      ? `Remove bookmark from ${skill.name}`
                      : `Bookmark ${skill.name}`
                  }
                  className={cn(
                    'absolute top-0 right-11 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-md z-10 transition-opacity',
                    isBookmarked
                      ? 'text-cyan-400'
                      : 'text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
                  )}
                >
                  {isBookmarked ? (
                    <BookmarkCheck className="h-3.5 w-3.5" />
                  ) : (
                    <BookmarkPlus className="h-3.5 w-3.5" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="left">
                {isBookmarked ? 'Remove bookmark' : 'Bookmark'}
              </TooltipContent>
            </Tooltip>
          )}

          <CardContent className="p-4 pr-14">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <h3 className="font-medium truncate flex items-center gap-1.5">
                  {isLinked && (
                    <Link2
                      className="h-3.5 w-3.5 shrink-0 text-cyan-400/70"
                      aria-label="Linked skill"
                    />
                  )}
                  {isLocalSkill && (
                    <FolderDot
                      className="h-3.5 w-3.5 shrink-0 text-emerald-400/70"
                      aria-label="Local skill"
                    />
                  )}
                  <span className="truncate">{skill.name}</span>
                  {/* Add button - only when viewing all skills (no agent filter) */}
                  {showAddButton && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleAddClick}
                      className="h-5 px-1.5 text-xs shrink-0 ml-1"
                    >
                      <Plus className="h-3 w-3 mr-0.5" />
                      Add
                    </Button>
                  )}
                </h3>
                {skill.description && (
                  <p className="text-sm text-muted-foreground line-clamp-2 mt-1 min-h-[2.5rem]">
                    {skill.description}
                  </p>
                )}
                <SourceLink source={skill.source} sourceUrl={skill.sourceUrl} />
              </div>
            </div>

            {/* Status badges — only shown in global view (no agent selected) */}
            {!selectedAgentId && (
              <div className="flex items-center gap-2 mt-3">
                {validCount > 0 && (
                  <StatusBadge
                    status="valid"
                    count={validCount}
                    agentNames={validAgentNames}
                  />
                )}
                {brokenCount > 0 && (
                  <StatusBadge
                    status="broken"
                    count={brokenCount}
                    agentNames={brokenAgentNames}
                  />
                )}
                {validCount === 0 && brokenCount === 0 && (
                  <span className="text-xs text-muted-foreground">
                    Not linked to any agent
                  </span>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onClick={handleCopyClick}>
          <Copy className="h-4 w-4 mr-2" />
          Copy to...
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
})
