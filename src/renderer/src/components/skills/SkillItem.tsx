import {
  BookmarkCheck,
  BookmarkPlus,
  Copy,
  FolderDot,
  Link2,
  Plus,
  X,
} from 'lucide-react'
import React, { useEffect, useMemo, useRef, useState } from 'react'

import type { Skill, SkillName } from '../../../../shared/types'
import { cn } from '../../lib/utils'
import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import {
  selectInFlightDeleteNamesSet,
  selectSelectedSkillNamesSet,
  selectVisibleSkillNames,
} from '../../redux/selectors'
import {
  addBookmark,
  removeBookmark,
  selectIsBookmarked,
} from '../../redux/slices/bookmarkSlice'
import {
  selectRange,
  selectSelectionAnchor,
  selectSkill,
  setSkillToAddSymlinks,
  setSkillToCopy,
  setSkillToUnlink,
  toggleSelection,
} from '../../redux/slices/skillsSlice'
import { StatusBadge } from '../status/StatusBadge'
import { Button } from '../ui/button'
import { Card, CardContent } from '../ui/card'
import { Checkbox } from '../ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

import { canBookmarkSkill, skillToBookmarkData } from './bookmarkHelpers'
import { computeRangeSelection } from './bulkDeleteHelpers'
import { getSkillItemVisibility } from './skillItemHelpers'
import { SourceLink } from './SourceLink'

interface SkillItemProps {
  skill: Skill
}

/** How long the partial-failure red edge persists (ms). */
const PARTIAL_FAIL_FLASH_MS = 3_000

/**
 * Single skill card in the skills list.
 *
 * Renders a bulk-selection checkbox, the skill's name and metadata, and — in
 * agent view or for local skills — a per-row X button. During an in-flight
 * bulk op the row fades to `opacity-50`; rows that errored out of a bulk op
 * flash a red left edge for {@link PARTIAL_FAIL_FLASH_MS} via the
 * `skills:bulkItemFailed` custom event so the survivors are easy to spot.
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

  const selectedNamesSet = useAppSelector(selectSelectedSkillNamesSet)
  const inFlightDeleteSet = useAppSelector(selectInFlightDeleteNamesSet)
  const selectionAnchor = useAppSelector(selectSelectionAnchor)
  const visibleNames = useAppSelector(selectVisibleSkillNames)
  const isTicked = selectedNamesSet.has(skill.name)
  const isInFlight = inFlightDeleteSet.has(skill.name)

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

  /**
   * Checkbox click handler — `onPointerDown` captures the shift modifier
   * before Radix's internal click stops the event.
   *
   * Routes to `selectRange` ONLY when Shift is held AND an anchor already
   * exists (from a prior single-click). With no anchor (first click into an
   * empty selection), Shift-click falls through to the non-shift path: Radix
   * fires `onCheckedChange`, `handleCheckedChange` dispatches `toggleSelection`,
   * and the reducer promotes this click to the new anchor. Behaves like macOS
   * Finder — a first shift-click with no anchor is a plain toggle, not a range.
   */
  const handleCheckboxPointerDown = (
    event: React.PointerEvent<HTMLButtonElement>,
  ): void => {
    // Stop propagation so the Card's onClick (inspector selection) does not fire.
    event.stopPropagation()
    if (event.shiftKey && selectionAnchor) {
      event.preventDefault()
      const namesInRange = computeRangeSelection(
        selectionAnchor,
        skill.name,
        visibleNames,
      )
      dispatch(selectRange(namesInRange))
      return
    }
    // Non-shift path (and shift-without-anchor): let the checkbox settle to
    // its new `checked` state; Radix emits `onCheckedChange` and we dispatch
    // the toggle there. The reducer records the new anchor on toggle.
  }

  const handleCheckedChange = (checked: boolean | 'indeterminate'): void => {
    // Only fire when the user actually toggled — ignore the initial sync from props.
    if (checked === 'indeterminate') return
    // If we just handled a range via shift+click, the state is already correct.
    // Reconcile via presence in the selection set: only toggle when the slice
    // state disagrees with the checkbox's new visual state. Avoids double-toggle.
    const isCurrentlyTicked = selectedNamesSet.has(skill.name)
    if (isCurrentlyTicked !== checked) {
      dispatch(toggleSelection(skill.name))
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

  // Partial-fail flash (local to the row). The parent (MainContent) decides
  // which skills recently failed by subscribing to the thunk result and
  // seeding a DOM-level data attribute or ref; for now, the flag is wired
  // through a ref kept in sync with a sentinel attribute so Phase D (if any)
  // can animate it without structural changes. Initialised off; the
  // MainContent-level effect flips it on when a bulk op returns errors.
  const [didPartialFail, setDidPartialFail] = useState(false)
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    return () => {
      // Clean up timer on unmount to prevent a stale setState on an unmounted row.
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
    }
  }, [])
  /**
   * Expose a row-level method so MainContent can imperatively trigger the flash
   * without threading per-row state through Redux. The MainContent effect reads
   * the Set of failed names from the thunk result and calls into the row via a
   * data-skill-name DOM selector.
   *
   * Because this is imperative, we use a CustomEvent listener keyed on the
   * skill name for decoupling. This keeps SkillItem agnostic of which bulk op
   * produced the failure.
   */
  useEffect(() => {
    const handleFailEvent = (event: Event): void => {
      const customEvent = event as CustomEvent<{ skillName: SkillName }>
      if (customEvent.detail.skillName !== skill.name) return
      setDidPartialFail(true)
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
      resetTimerRef.current = setTimeout(() => {
        setDidPartialFail(false)
      }, PARTIAL_FAIL_FLASH_MS)
    }
    window.addEventListener('skills:bulkItemFailed', handleFailEvent)
    return () => {
      window.removeEventListener('skills:bulkItemFailed', handleFailEvent)
    }
  }, [skill.name])

  return (
    <DropdownMenu
      open={contextOpen}
      onOpenChange={(open) => {
        if (!open) setContextOpen(false)
      }}
    >
      <DropdownMenuTrigger asChild disabled={!showCopyButton}>
        <Card
          data-skill-name={skill.name}
          className={cn(
            'group cursor-pointer transition-all hover:border-primary/50 relative motion-reduce:transition-none',
            isSelected && 'border-primary bg-primary/5',
            isLinked && 'border-l-2 border-l-cyan-400/40',
            isLocalSkill && 'border-l-2 border-l-emerald-400/40',
            // In-flight fade while the row is part of an active bulk op.
            isInFlight && 'opacity-50 duration-150',
            // Partial-failure red edge (3s).
            didPartialFail && 'border-l-2 border-l-red-500/70',
          )}
          onClick={() => dispatch(selectSkill(isSelected ? null : skill))}
          onContextMenu={handleContextMenu}
        >
          {/* X button — agent-view only (unlink or delete a local skill from
              the selected agent). Global-view delete lives on the bulk
              SelectionToolbar. Apple HIG 44×44 hit area via min-h/min-w. */}
          {showUnlinkButton && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleUnlinkClick}
                  aria-label={
                    isLocalSkill
                      ? `Delete ${skill.name} from ${selectedAgentName}`
                      : `Unlink ${skill.name} from ${selectedAgentName}`
                  }
                  className="absolute top-0 right-0 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive z-10 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left">
                {isLocalSkill
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
                    'absolute top-0 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-md z-10 transition-opacity',
                    // Right-align: slide the bookmark left of the X when both are visible.
                    showUnlinkButton ? 'right-11' : 'right-0',
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

          <CardContent
            className={cn(
              'p-4',
              // Reserve right space for the X/bookmark buttons when shown.
              showUnlinkButton || showBookmark ? 'pr-14' : 'pr-4',
            )}
          >
            <div className="flex items-start gap-3">
              {/* 44×44 hit area via the wrapper; the visual Checkbox stays
                  16×16 per shadcn default. The focusable Checkbox below owns
                  the accessible name — duplicating `aria-label` on the wrapper
                  caused some screen readers to announce the skill twice. */}
              <label
                className="shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center -mt-1 -ml-1 cursor-pointer"
                onClick={(e) => e.stopPropagation()}
              >
                <Checkbox
                  checked={isTicked}
                  onCheckedChange={handleCheckedChange}
                  onPointerDown={handleCheckboxPointerDown}
                  aria-label={
                    isTicked ? `Deselect ${skill.name}` : `Select ${skill.name}`
                  }
                />
              </label>
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
