import {
  BookmarkCheck,
  BookmarkPlus,
  Copy,
  ExternalLink,
  FolderDot,
  Link2,
  Plus,
  X,
} from 'lucide-react'
import React, { useCallback, useMemo, useRef, useState } from 'react'

import { StatusBadge } from '@/renderer/src/components/status/StatusBadge'
import { Button } from '@/renderer/src/components/ui/button'
import { Card, CardContent } from '@/renderer/src/components/ui/card'
import { Checkbox } from '@/renderer/src/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/renderer/src/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/renderer/src/components/ui/tooltip'
import { useCycleEffect } from '@/renderer/src/hooks/useCycleEffect'
import { useUnmountEffect } from '@/renderer/src/hooks/useUnmountEffect'
import { cn } from '@/renderer/src/lib/utils'
import { useAppDispatch, useAppSelector } from '@/renderer/src/redux/hooks'
import {
  selectBulkSelectableVisibleSkillNames,
  selectAnyInFlightRemovalSet,
  selectSelectedSkillNamesSet,
} from '@/renderer/src/redux/selectors'
import {
  addBookmark,
  removeBookmark,
  selectIsBookmarked,
} from '@/renderer/src/redux/slices/bookmarkSlice'
import {
  selectRange,
  selectSelectionAnchor,
  selectSkill,
  setSkillToAddSymlinks,
  setSkillToCopy,
  setSkillToUnlink,
  toggleSelection,
} from '@/renderer/src/redux/slices/skillsSlice'
import {
  selectBulkSelectMode,
  setBulkConfirm,
} from '@/renderer/src/redux/slices/uiSlice'
import { BULK_ITEM_FAILED_EVENT } from '@/renderer/src/utils/bulkOpVisuals'
import { GSTACK_REPOSITORY_URL } from '@/shared/constants'
import type { Skill, SkillName, SymlinkInfo } from '@/shared/types'

import { canBookmarkSkill, skillToBookmarkData } from './bookmarkHelpers'
import { computeRangeSelection } from './bulkDeleteHelpers'
import { partitionGlobalDeleteTargets } from './reviewedDestructiveTargets'
import {
  getCardContentPaddingClass,
  getSkillItemVisibility,
} from './skillItemHelpers'
import { SourceLink } from './SourceLink'

// Strongly-type the `skills:bulkItemFailed` CustomEvent so the cast inside
// handleFailEvent is compile-checked instead of a freeform `as CustomEvent<…>`.
// The dispatch site lives in utils/bulkOpVisuals.ts.
declare global {
  interface WindowEventMap {
    'skills:bulkItemFailed': CustomEvent<{ skillName: SkillName }>
  }
}

interface SkillItemProps {
  skill: Skill
}

interface SymlinkStatusBuckets {
  validCount: number
  brokenCount: number
  inaccessibleCount: number
  validAgentNames: string[]
  brokenAgentNames: string[]
  inaccessibleAgentNames: string[]
}

/** How long the partial-failure red edge persists (ms). */
const PARTIAL_FAIL_FLASH_MS = 3_000

/**
 * Groups symlink status counts outside the large card render path to keep the component under fallow complexity limits.
 * @param symlinks - Symlink rows attached to the skill being rendered.
 * @returns Counts plus tooltip agent names for the global-view badges.
 * @example
 * getSymlinkStatusBuckets([{ status: 'valid', agentName: 'Codex', ... }]).validCount // => 1
 */
function getSymlinkStatusBuckets(
  symlinks: readonly SymlinkInfo[],
): SymlinkStatusBuckets {
  const buckets: SymlinkStatusBuckets = {
    validCount: 0,
    brokenCount: 0,
    inaccessibleCount: 0,
    validAgentNames: [],
    brokenAgentNames: [],
    inaccessibleAgentNames: [],
  }

  for (const symlink of symlinks) {
    if (symlink.status === 'valid') {
      buckets.validCount += 1
      buckets.validAgentNames.push(symlink.agentName)
    } else if (symlink.status === 'broken') {
      buckets.brokenCount += 1
      buckets.brokenAgentNames.push(symlink.agentName)
    } else if (symlink.status === 'inaccessible') {
      buckets.inaccessibleCount += 1
      buckets.inaccessibleAgentNames.push(symlink.agentName)
    }
  }

  return buckets
}

/**
 * Decide whether this rendered row can participate in bulk selection.
 * @param selectedAgentId - Current agent filter, or null in global view.
 * @param visibleNames - Selector-approved names for agent-view bulk actions.
 * @param skillName - Skill row currently rendered by SkillItem.
 * @returns True when a checkbox should render for this row.
 * @example
 * canBulkSelectRenderedSkill(null, [], 'task') // => true
 */
function canBulkSelectRenderedSkill(
  selectedAgentId: string | null,
  visibleNames: readonly SkillName[],
  skillName: SkillName,
): boolean {
  if (selectedAgentId === null) return true
  return visibleNames.includes(skillName)
}

interface GlobalStatusBadgesProps {
  buckets: SymlinkStatusBuckets
}

/**
 * Renders global-view symlink badges while keeping the already-large card component simple.
 * @param props - Precomputed symlink status buckets for one skill.
 * @returns Badge row showing valid, broken, inaccessible, or unlinked state.
 * @example
 * <GlobalStatusBadges buckets={buckets} />
 */
const GlobalStatusBadges = React.memo(function GlobalStatusBadges({
  buckets,
}: GlobalStatusBadgesProps): React.ReactElement {
  const hasNoLinks =
    buckets.validCount === 0 &&
    buckets.brokenCount === 0 &&
    buckets.inaccessibleCount === 0

  return (
    <div className="flex items-center gap-2 mt-3">
      {buckets.validCount > 0 && (
        <StatusBadge
          status="valid"
          count={buckets.validCount}
          agentNames={buckets.validAgentNames}
        />
      )}
      {buckets.brokenCount > 0 && (
        <StatusBadge
          status="broken"
          count={buckets.brokenCount}
          agentNames={buckets.brokenAgentNames}
        />
      )}
      {buckets.inaccessibleCount > 0 && (
        <StatusBadge
          status="inaccessible"
          count={buckets.inaccessibleCount}
          agentNames={buckets.inaccessibleAgentNames}
        />
      )}
      {hasNoLinks && (
        <span className="text-xs text-muted-foreground">
          Not linked to any agent
        </span>
      )}
    </div>
  )
})

interface SkillTitleRowProps {
  skill: Skill
  isLinked: boolean
  isLocalSkill: boolean
  isInaccessibleSkill: boolean
  showAddButton: boolean
  showGStackBadge: boolean
  onAddClick: React.MouseEventHandler<HTMLButtonElement>
}

/**
 * Renders skill identity and compact row actions without merging controls into the heading.
 * @param props - Skill state flags and Add click handler for one list row.
 * @returns Header row with a clean skill heading plus adjacent actions.
 * @example
 * <SkillTitleRow skill={skill} isLinked={false} isLocalSkill={false} isInaccessibleSkill={false} showAddButton showGStackBadge={false} onAddClick={handleAddClick} />
 */
const SkillTitleRow = React.memo(function SkillTitleRow({
  skill,
  isLinked,
  isLocalSkill,
  isInaccessibleSkill,
  showAddButton,
  showGStackBadge,
  onAddClick,
}: SkillTitleRowProps): React.ReactElement {
  return (
    <div className="flex items-start gap-2">
      <h3 className="font-medium truncate flex min-w-0 flex-1 items-center gap-1.5">
        {isLinked && (
          <Link2
            className="h-3.5 w-3.5 shrink-0 text-success/70"
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
        {isInaccessibleSkill && (
          <span
            role="img"
            className="inline-flex items-center rounded-md border border-amber-400/50 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300 shrink-0"
            aria-label="Inaccessible link - manual review required"
            title="Target cannot be verified - review this link before removing it"
          >
            inaccessible
          </span>
        )}
        {skill.isOrphan && (
          <span
            role="img"
            data-testid={`skill-orphan-badge-${skill.name}`}
            className="inline-flex items-center rounded-md border border-amber-400/50 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300 shrink-0"
            aria-label="Orphan skill — source directory is missing"
            title="Source directory is missing — use Cleanup to remove the dangling symlinks"
          >
            orphan
          </span>
        )}
      </h3>
      {(showAddButton || showGStackBadge) && (
        <div className="flex shrink-0 items-center gap-1">
          {showAddButton && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onAddClick}
              className="h-6 px-2 text-xs"
            >
              <Plus className="mr-0.5 h-3 w-3" />
              Add
            </Button>
          )}
          {showGStackBadge && (
            <a
              href={GSTACK_REPOSITORY_URL}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex h-6 items-center gap-1 rounded-md border border-sky-400/40 bg-sky-500/15 px-1.5 text-[10px] font-semibold text-sky-300 transition-colors hover:bg-sky-500/25"
              aria-label="Open G-Stack GitHub repository"
            >
              G-Stack
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
          )}
        </div>
      )}
    </div>
  )
})

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
  const inFlightRemovalSet = useAppSelector(selectAnyInFlightRemovalSet)
  const selectionAnchor = useAppSelector(selectSelectionAnchor)
  const visibleNames = useAppSelector(selectBulkSelectableVisibleSkillNames)
  const bulkSelectMode = useAppSelector(selectBulkSelectMode)
  const isTicked = selectedNamesSet.has(skill.name)
  const isInFlight = inFlightRemovalSet.has(skill.name)

  const symlinkStatusBuckets = useMemo(
    () => getSymlinkStatusBuckets(skill.symlinks),
    [skill.symlinks],
  )

  const {
    showAddButton,
    showUnlinkButton,
    showCopyButton,
    showDeleteButton,
    isLinked,
    isLocalSkill,
    isInaccessibleSkill,
    selectedAgentSymlink,
    selectedLocalSkillInfo,
    showGStackBadge,
  } = getSkillItemVisibility(selectedAgentId, skill)
  const isBulkSelectable = canBulkSelectRenderedSkill(
    selectedAgentId,
    visibleNames,
    skill.name,
  )

  // Get selected agent name for tooltip
  const selectedAgentName =
    agents.find((a) => a.id === selectedAgentId)?.name || 'agent'

  // NOTE: handleUnlinkClick is exercised by the "SkillItem unlink button" specs
  // (click → setSkillToUnlink asserted in store), but the browser-lane v8/esbuild
  // transform fails to attribute the FNDA function hit to this const-arrow onClick
  // handler. It is a coverage instrumentation artifact, not untested code; a
  // `/* v8 ignore */` here does not cleanly recover the hit (the transform remaps
  // FNDA attribution off this const-arrow onto a different node), so the function
  // threshold is floored just below 100 rather than chased. See vitest.config.ts.
  const handleUnlinkClick = (e: React.MouseEvent): void => {
    e.stopPropagation()
    const targetSymlink = selectedAgentSymlink ?? selectedLocalSkillInfo
    if (targetSymlink) {
      dispatch(setSkillToUnlink({ skill, symlink: targetSymlink }))
    }
  }

  const handleAddClick = useCallback(
    (e: React.MouseEvent): void => {
      e.stopPropagation()
      if (selectedAgentId) {
        dispatch(setSkillToCopy(skill))
        return
      }
      dispatch(setSkillToAddSymlinks(skill))
    },
    [dispatch, selectedAgentId, skill],
  )

  /**
   * Global-view per-row delete. Routes every skill — including ones tracked in
   * `~/.agents/.skill-lock.json` — through the shared bulk-confirm dialog,
   * which cascades into the trash + undo flow on confirm. Lock-file entries
   * become stale by design: simple file deletion is preferred over the
   * unreliable `npx skills remove` spawn the CLI used to perform.
   */
  const handleDeleteClick = (e: React.MouseEvent): void => {
    e.stopPropagation()
    const { deleteTargets, orphanRecords, staleDeleteErrors, orphanErrors } =
      partitionGlobalDeleteTargets([skill], [skill.name])
    dispatch(
      setBulkConfirm({
        kind: 'delete',
        skillNames: [skill.name],
        agentId: null,
        agentName: null,
        // A single-row delete carries no repo-filter scope to report.
        sourceSummary: null,
        deleteTargets,
        orphanRecords,
        staleDeleteErrors,
        orphanErrors,
      }),
    )
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
  const handleCheckboxPointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>): void => {
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
    },
    [dispatch, selectionAnchor, skill.name, visibleNames],
  )

  const handleCheckedChange = useCallback(
    (checked: boolean | 'indeterminate'): void => {
      // Only fire when the user actually toggled — ignore the initial sync from props.
      if (checked === 'indeterminate') return
      // If we just handled a range via shift+click, the state is already correct.
      // Reconcile via presence in the selection set: only toggle when the slice
      // state disagrees with the checkbox's new visual state. Avoids double-toggle.
      const isCurrentlyTicked = selectedNamesSet.has(skill.name)
      if (isCurrentlyTicked !== checked) {
        dispatch(toggleSelection(skill.name))
      }
    },
    [dispatch, selectedNamesSet, skill.name],
  )

  const [contextOpen, setContextOpen] = useState(false)

  const handleContextMenu = useCallback(
    (e: React.MouseEvent): void => {
      e.preventDefault()
      if (!showCopyButton) return
      setContextOpen(true)
    },
    [showCopyButton],
  )

  const handleCopyClick = useCallback((): void => {
    dispatch(setSkillToCopy(skill))
    setContextOpen(false)
  }, [dispatch, skill])

  const handleContextOpenChange = useCallback((open: boolean): void => {
    if (!open) setContextOpen(false)
  }, [])

  const handleCardClick = useCallback((): void => {
    dispatch(selectSkill(isSelected ? null : skill))
  }, [dispatch, isSelected, skill])

  const [didPartialFail, setDidPartialFail] = useState(false)
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useUnmountEffect(() => {
    // Clean up timer on unmount to prevent a stale setState on an unmounted row.
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
  })
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
  useCycleEffect(() => {
    // Typed via the `WindowEventMap` augmentation above, so `event.detail` is
    // known to carry `{ skillName }` without a cast.
    const handleFailEvent = (
      event: WindowEventMap[typeof BULK_ITEM_FAILED_EVENT],
    ): void => {
      if (event.detail.skillName !== skill.name) return
      setDidPartialFail(true)
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
      resetTimerRef.current = setTimeout(() => {
        setDidPartialFail(false)
      }, PARTIAL_FAIL_FLASH_MS)
    }
    window.addEventListener(BULK_ITEM_FAILED_EVENT, handleFailEvent)
    return () => {
      window.removeEventListener(BULK_ITEM_FAILED_EVENT, handleFailEvent)
    }
  }, [skill.name])

  return (
    <DropdownMenu open={contextOpen} onOpenChange={handleContextOpenChange}>
      <DropdownMenuTrigger asChild disabled={!showCopyButton}>
        <Card
          data-skill-name={skill.name}
          className={cn(
            'group cursor-pointer transition-all hover:border-primary/50 relative motion-reduce:transition-none',
            isSelected && 'border-primary bg-primary/5',
            // Skill-type accent (only when NOT flashing red) — making the
            // precedence explicit, rather than relying on tailwind-merge
            // class-order to let the red override cyan/emerald.
            !didPartialFail && isLinked && 'border-l-2 border-l-success/40',
            !didPartialFail &&
              isLocalSkill &&
              'border-l-2 border-l-emerald-400/40',
            !didPartialFail &&
              isInaccessibleSkill &&
              'border-l-2 border-l-amber-400/60',
            // Orphan accent — mutually exclusive with linked/local rows by
            // definition, so the order below is purely for the partial-fail override.
            !didPartialFail &&
              skill.isOrphan &&
              'border-l-2 border-l-amber-400/60',
            // In-flight fade while the row is part of an active bulk op.
            isInFlight && 'opacity-50 duration-150',
            // Partial-failure red edge (PARTIAL_FAIL_FLASH_MS).
            didPartialFail && 'border-l-2 border-l-red-500/70',
          )}
          onClick={handleCardClick}
          onContextMenu={handleContextMenu}
        >
          {/* X button — agent-view only (unlink or delete a local skill from
              the selected agent). Apple HIG 44×44 hit area via min-h/min-w. */}
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
                  className="absolute top-1.5 right-0 min-h-11 min-w-11 flex items-center justify-center rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive z-10 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
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

          {/* X button — global-view only (delete entire skill). Routes to the
              shared bulk-confirm dialog which cascades to trash + undo toast.
              Same visual corner as showUnlinkButton; they're mutually
              exclusive because `!selectedAgentId` gates showDeleteButton. */}
          {showDeleteButton && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleDeleteClick}
                  aria-label={`Delete ${skill.name}`}
                  data-testid={`skill-delete-${skill.name}`}
                  className="absolute top-1.5 right-0 min-h-11 min-w-11 flex items-center justify-center rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive z-10 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left">Delete</TooltipContent>
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
                    'absolute top-1.5 min-h-11 min-w-11 flex items-center justify-center rounded-md z-10 transition-opacity',
                    // Right-align: slide the bookmark left of the X when an
                    // X button (unlink in agent view, delete in global view)
                    // shares the top-right corner.
                    showUnlinkButton || showDeleteButton
                      ? 'right-11'
                      : 'right-0',
                    isBookmarked
                      ? 'text-primary'
                      : 'text-muted-foreground hover:text-foreground opacity-40 group-hover:opacity-100 focus-visible:opacity-100',
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
              // Reserve right space for the absolute-positioned X/bookmark
              // overlays so the always-visible "+ Add" control never slides
              // under them on hover. Bookmark + X stack to 88px, so that case
              // needs pr-24 (96px), not the single-button pr-14 (56px).
              getCardContentPaddingClass({
                showBookmark,
                showUnlinkButton,
                showDeleteButton,
              }),
            )}
          >
            <div className="flex items-start gap-3">
              {/* 44×44 hit area via the wrapper; the visual Checkbox stays
                  16×16 per shadcn default. The focusable Checkbox below owns
                  the accessible name — duplicating `aria-label` on the wrapper
                  caused some screen readers to announce the skill twice.
                  Rendered only when the user has entered bulk-select mode via
                  the filter-row toggle; the default view stays clean. */}
              {bulkSelectMode && (
                <label
                  className="shrink-0 min-h-11 min-w-11 flex items-center justify-center -mt-1 -ml-1 cursor-pointer"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Checkbox
                    checked={isTicked}
                    onCheckedChange={handleCheckedChange}
                    onPointerDown={handleCheckboxPointerDown}
                    // Keep the slot rendered for every row in bulk mode so titles
                    // stay aligned, but block selecting an ineligible row (still
                    // allow deselecting one that is already ticked).
                    disabled={!isBulkSelectable && !isTicked}
                    aria-label={
                      isTicked
                        ? `Deselect ${skill.name}`
                        : isBulkSelectable
                          ? `Select ${skill.name}`
                          : `${skill.name} is not eligible for bulk selection`
                    }
                  />
                </label>
              )}
              <div className="flex-1 min-w-0">
                <SkillTitleRow
                  skill={skill}
                  isLinked={isLinked}
                  isLocalSkill={isLocalSkill}
                  isInaccessibleSkill={isInaccessibleSkill}
                  showAddButton={showAddButton}
                  showGStackBadge={showGStackBadge}
                  onAddClick={handleAddClick}
                />
                {skill.description && (
                  <p className="text-sm text-muted-foreground line-clamp-2 mt-1 min-h-10">
                    {skill.description}
                  </p>
                )}
                <SourceLink source={skill.source} sourceUrl={skill.sourceUrl} />
              </div>
            </div>

            {/* Status badges — only shown in global view (no agent selected) */}
            {!selectedAgentId && (
              <GlobalStatusBadges buckets={symlinkStatusBuckets} />
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
