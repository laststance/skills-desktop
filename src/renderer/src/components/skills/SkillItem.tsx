import { Plus, Trash2, X } from 'lucide-react'

import type { Skill } from '../../../../shared/types'
import { cn } from '../../lib/utils'
import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import {
  selectSkill,
  setSkillToAddSymlinks,
  setSkillToDelete,
  setSkillToUnlink,
} from '../../redux/slices/skillsSlice'
import { StatusBadge } from '../status/StatusBadge'
import { Button } from '../ui/button'
import { Card, CardContent } from '../ui/card'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

interface SkillItemProps {
  skill: Skill
}

/**
 * Single skill card in the skills list
 * Shows X button for deletion, trash icon for unlinking, Add button for symlink creation
 */
export function SkillItem({ skill }: SkillItemProps): React.ReactElement {
  const dispatch = useAppDispatch()
  const { selectedSkill } = useAppSelector((state) => state.skills)
  const { selectedAgentId } = useAppSelector((state) => state.ui)
  const { items: agents } = useAppSelector((state) => state.agents)
  const isSelected = selectedSkill?.path === skill.path

  const validCount = skill.symlinks.filter((s) => s.status === 'valid').length
  const brokenCount = skill.symlinks.filter((s) => s.status === 'broken').length

  // Find symlink for selected agent (if any)
  const selectedAgentSymlink = selectedAgentId
    ? skill.symlinks.find(
        (s) =>
          s.agentId === selectedAgentId &&
          (s.status === 'valid' || s.status === 'broken') &&
          !s.isLocal,
      )
    : null

  // Determine if this skill is symlinked (not local) for selected agent
  const isLinked =
    !!selectedAgentSymlink && selectedAgentSymlink.status === 'valid'

  // Get selected agent name for tooltip
  const selectedAgentName =
    agents.find((a) => a.id === selectedAgentId)?.name || 'agent'

  const handleUnlinkClick = (e: React.MouseEvent): void => {
    e.stopPropagation()
    if (selectedAgentSymlink) {
      dispatch(setSkillToUnlink({ skill, symlink: selectedAgentSymlink }))
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

  return (
    <Card
      className={cn(
        'group cursor-pointer transition-colors hover:border-primary/50 relative',
        isSelected && 'border-primary bg-primary/5',
      )}
      onClick={() => dispatch(selectSkill(skill))}
    >
      {/* X button - always visible at top-right corner */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={handleDeleteClick}
            className="absolute top-2 right-2 p-1 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive z-10 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="left">Delete skill</TooltipContent>
      </Tooltip>

      <CardContent className="p-4 pr-8">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h3 className="font-medium truncate flex items-center gap-1">
              {isLinked && <span title="Linked skill">🔗 </span>}
              <span className="truncate">{skill.name}</span>
              {/* Add button - only when viewing all skills (no agent filter) */}
              {!selectedAgentId && (
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
              <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                {skill.description}
              </p>
            )}
          </div>

          {/* Trash icon - visible on hover for linked (non-local) skills */}
          {selectedAgentSymlink && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleUnlinkClick}
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left">
                Remove from {selectedAgentName}
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        <div className="flex items-center gap-2 mt-3">
          {validCount > 0 && <StatusBadge status="valid" count={validCount} />}
          {brokenCount > 0 && (
            <StatusBadge status="broken" count={brokenCount} />
          )}
          {validCount === 0 && brokenCount === 0 && (
            <span className="text-xs text-muted-foreground">
              Not linked to any agent
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
