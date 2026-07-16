import {
  BookmarkCheck,
  BookmarkPlus,
  Copy,
  ExternalLink,
  FolderDot,
  Link2,
  Lock,
  LockOpen,
  Plus,
  X,
} from 'lucide-react'
import React, { useRef, useState } from 'react'

import { StatusBadge } from '@/renderer/src/components/status/StatusBadge'
import { badgeVariants } from '@/renderer/src/components/ui/badge'
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
  addProtection,
  removeProtection,
  selectIsProtected,
} from '@/renderer/src/redux/slices/protectSlice'
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
import type { AgentId, AgentName } from '@/shared/constants'
import type {
  Skill,
  SkillName,
  SymlinkCount,
  SymlinkInfo,
} from '@/shared/types'

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

interface ProtectButtonProps {
  skillName: SkillName
  /** Whether the bookmark button is visible (affects horizontal positioning). */
  showBookmark: boolean
  /** Whether an X button (unlink or delete) is visible (affects positioning). */
  hasXButton: boolean
}

/**
 * Lock / unlock toggle shown on every skill row. Manages its own Redux state
 * so the parent SkillItem only needs `isProtected` for status and action guards.
 * @param props - Skill name, bookmark visibility, and X-button visibility for positioning.
 * @returns Tooltip-wrapped lock icon button that dispatches protect actions.
 * @example
 * <ProtectButton skillName="task" showBookmark={true} hasXButton={false} />
 */
const ProtectButton = function ProtectButton({
  skillName,
  showBookmark,
  hasXButton,
}: ProtectButtonProps): React.ReactElement {
  const dispatch = useAppDispatch()
  const isProtected = useAppSelector((state) =>
    selectIsProtected(state, skillName),
  )

  const handleToggle = (e: React.MouseEvent): void => {
    e.stopPropagation()
    dispatch(
      isProtected ? removeProtection(skillName) : addProtection(skillName),
    )
  }

  const rightClass =
    showBookmark && hasXButton
      ? 'right-22'
      : hasXButton || showBookmark
        ? 'right-11'
        : 'right-0'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={handleToggle}
          aria-label={isProtected ? `Unlock ${skillName}` : `Lock ${skillName}`}
          data-testid={`skill-protect-${skillName}`}
          className={cn(
            'absolute top-1.5 min-h-11 min-w-11 flex items-center justify-center rounded-md z-10 transition-opacity focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            rightClass,
            isProtected
              ? 'text-foreground'
              : 'text-muted-foreground opacity-40 hover:opacity-70 focus-visible:opacity-100',
          )}
        >
          {isProtected ? (
            <Lock className="h-3.5 w-3.5" />
          ) : (
            <LockOpen className="h-3.5 w-3.5" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="left">
        {isProtected
          ? 'Protected — cannot be deleted or removed'
          : 'Click to protect'}
      </TooltipContent>
    </Tooltip>
  )
}

interface SkillItemProps {
  skill: Skill
}

interface SymlinkStatusBuckets {
  validCount: SymlinkCount
  brokenCount: SymlinkCount
  inaccessibleCount: SymlinkCount
  validAgentNames: AgentName[]
  brokenAgentNames: AgentName[]
  inaccessibleAgentNames: AgentName[]
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
  selectedAgentId: AgentId | null,
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
const GlobalStatusBadges = function GlobalStatusBadges({
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
}

interface SkillTitleRowProps {
  skill: Skill
  isLinked: boolean
  isLocalSkill: boolean
  isInaccessibleSkill: boolean
  isProtected: boolean
  showAddButton: boolean
  showGStackBadge: boolean
  onAddClick: React.MouseEventHandler<HTMLButtonElement>
}

/**
 * Renders skill identity and compact row actions without merging controls into the heading.
 * @param props - Skill state flags and Add click handler for one list row.
 * @returns Header row with a clean skill heading plus adjacent actions.
 * @example
 * <SkillTitleRow skill={skill} isLinked={false} isLocalSkill={false} isInaccessibleSkill={false} isProtected={false} showAddButton showGStackBadge={false} onAddClick={handleAddClick} />
 */
const SkillTitleRow = function SkillTitleRow({
  skill,
  isLinked,
  isLocalSkill,
  isInaccessibleSkill,
  isProtected,
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
        {isProtected && (
          <span
            data-testid={`skill-protected-badge-${skill.name}`}
            className={cn(
              badgeVariants({ variant: 'outline' }),
              'h-5 shrink-0 gap-1 border-border bg-muted px-1.5 py-0 text-[10px] font-semibold leading-none text-foreground',
            )}
          >
            <Lock className="h-3 w-3" aria-hidden="true" />
            <span>Protected</span>
          </span>
        )}
        {isInaccessibleSkill && (
          <span
            // react-doctor-disable-next-line react-doctor/prefer-tag-over-role -- composed "inaccessible" text status badge collapsed to one labelled graphic via role="img"+aria-label. <img> needs a src and cannot contain the badge text.
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
            // react-doctor-disable-next-line react-doctor/prefer-tag-over-role -- composed "orphan" text status badge collapsed to one labelled graphic via role="img"+aria-label. <img> needs a src and cannot contain the badge text.
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
}

/**
 * Single skill card in the skills list.
 *
 * Renders a bulk-selection checkbox, the skill's name and metadata, and — in
 * agent view or for local skills — a per-row X button. During an in-flight
 * bulk op the row fades to `opacity-50`; rows that errored out of a bulk op
 * flash a red left edge for {@link PARTIAL_FAIL_FLASH_MS} via the
 * `skills:bulkItemFailed` custom event so the survivors are easy to spot.
 */
export const SkillItem = function SkillItem({
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
  const isProtected = useAppSelector((state) =>
    selectIsProtected(state, skill.name),
  )
  const showBookmark = canBookmarkSkill(skill)

  const selectedNamesSet = useAppSelector(selectSelectedSkillNamesSet)
  const inFlightRemovalSet = useAppSelector(selectAnyInFlightRemovalSet)
  const selectionAnchor = useAppSelector(selectSelectionAnchor)
  const visibleNames = useAppSelector(selectBulkSelectableVisibleSkillNames)
  const bulkSelectMode = useAppSelector(selectBulkSelectMode)
  const isTicked = selectedNamesSet.has(skill.name)
  const isInFlight = inFlightRemovalSet.has(skill.name)

  const symlinkStatusBuckets = getSymlinkStatusBuckets(skill.symlinks)

  const {
    showAddButton,
    showUnlinkButton: showUnlinkButtonBase,
    showCopyButton,
    showDeleteButton: showDeleteButtonBase,
    isLinked,
    isLocalSkill,
    isInaccessibleSkill,
    selectedAgentSymlink,
    selectedLocalSkillInfo,
    showGStackBadge,
  } = getSkillItemVisibility(selectedAgentId, skill)
  // Global Delete keeps its slot while protected so the disabled action explains why it cannot run.
  const showDeleteButton = showDeleteButtonBase
  const showUnlinkButton = showUnlinkButtonBase && !isProtected
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
    // Protection is enforced here too so future UI refactors cannot stage a
    // locked skill for removal by accidentally showing the button.
    if (isProtected) return
    const targetSymlink = selectedAgentSymlink ?? selectedLocalSkillInfo
    if (targetSymlink) {
      dispatch(setSkillToUnlink({ skill, symlink: targetSymlink }))
    }
  }

  const handleAddClick = (e: React.MouseEvent): void => {
    e.stopPropagation()
    if (selectedAgentId) {
      dispatch(setSkillToCopy(skill))
      return
    }
    dispatch(setSkillToAddSymlinks(skill))
  }

  /**
   * Global-view per-row delete. Routes every skill — including ones tracked in
   * `~/.agents/.skill-lock.json` — through the shared bulk-confirm dialog,
   * which cascades into the trash + undo flow on confirm. Lock-file entries
   * become stale by design: simple file deletion is preferred over the
   * unreliable `npx skills remove` spawn the CLI used to perform.
   */
  const handleDeleteClick = (e: React.MouseEvent): void => {
    e.stopPropagation()
    const {
      deleteTargets,
      orphanRecords,
      staleDeleteErrors,
      orphanErrors,
      protectedErrors,
    } = partitionGlobalDeleteTargets(
      [skill],
      [skill.name],
      // Pass the real protection state so business logic enforces the guard
      // even if the UI gate (showDeleteButton) is weakened in future refactors.
      new Set<SkillName>(isProtected ? [skill.name] : []),
    )
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
        protectedErrors,
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

  const handleContextOpenChange = (open: boolean): void => {
    if (!open) setContextOpen(false)
  }

  const handleCardClick = (): void => {
    dispatch(selectSkill(isSelected ? null : skill))
  }

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
          <SkillItemOverlayActions
            skill={skill}
            selectedAgentName={selectedAgentName}
            isLocalSkill={isLocalSkill}
            isProtected={isProtected}
            isBookmarked={isBookmarked}
            showBookmark={showBookmark}
            showUnlinkButton={showUnlinkButton}
            showDeleteButton={showDeleteButton}
            hasXButton={showUnlinkButtonBase || showDeleteButtonBase}
            onUnlinkClick={handleUnlinkClick}
            onDeleteClick={handleDeleteClick}
            onToggleBookmark={handleToggleBookmark}
          />

          <CardContent
            className={cn(
              'p-4',
              // Reserve right space for the absolute-positioned X/bookmark
              // overlays so the always-visible "+ Add" control never slides
              // under them on hover. Bookmark + X stack to 88px, so that case
              // needs pr-24 (96px), not the single-button pr-14 (56px).
              getCardContentPaddingClass({
                showProtect: true,
                showBookmark,
                showUnlinkButton: showUnlinkButtonBase,
                // Use the pre-gate value: ProtectButton position is computed from
                // showDeleteButtonBase, so padding must match that slot count.
                showDeleteButton: showDeleteButtonBase,
              }),
            )}
          >
            <div className="flex items-start gap-3">
              <BulkSelectionCheckbox
                bulkSelectMode={bulkSelectMode}
                isTicked={isTicked}
                isBulkSelectable={isBulkSelectable}
                skillName={skill.name}
                onCheckedChange={handleCheckedChange}
                onPointerDown={handleCheckboxPointerDown}
              />

              <div className="flex-1 min-w-0">
                <SkillTitleRow
                  skill={skill}
                  isLinked={isLinked}
                  isLocalSkill={isLocalSkill}
                  isInaccessibleSkill={isInaccessibleSkill}
                  isProtected={isProtected}
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
}

interface SkillItemOverlayActionsProps {
  skill: Skill
  selectedAgentName: string
  isLocalSkill: boolean
  isProtected: boolean
  isBookmarked: boolean
  showBookmark: boolean
  showUnlinkButton: boolean
  showDeleteButton: boolean
  hasXButton: boolean
  onUnlinkClick: (event: React.MouseEvent) => void
  onDeleteClick: (event: React.MouseEvent) => void
  onToggleBookmark: (event: React.MouseEvent) => void
}

/**
 * Renders row overlay buttons after SkillItem decides action visibility and availability.
 * @param props - Skill row action visibility, protection state, and handlers wired by SkillItem.
 * @returns Top-right unlink/delete, protect, and bookmark controls for one row.
 * @example
 * <SkillItemOverlayActions skill={skill} selectedAgentName="Claude" showBookmark={true} />
 */
const SkillItemOverlayActions = function SkillItemOverlayActions({
  skill,
  selectedAgentName,
  isLocalSkill,
  isProtected,
  isBookmarked,
  showBookmark,
  showUnlinkButton,
  showDeleteButton,
  hasXButton,
  onUnlinkClick,
  onDeleteClick,
  onToggleBookmark,
}: SkillItemOverlayActionsProps): React.ReactElement {
  const globalDeleteButton = showDeleteButton ? (
    <button
      type="button"
      onClick={(event) => {
        // aria-disabled keeps the recovery tooltip keyboard-accessible without activating the card.
        if (isProtected) {
          event.stopPropagation()
          return
        }
        onDeleteClick(event)
      }}
      aria-disabled={isProtected}
      aria-label={
        isProtected
          ? `Delete ${skill.name} unavailable while protected`
          : `Delete ${skill.name}`
      }
      data-testid={`skill-delete-${skill.name}`}
      className={cn(
        'absolute top-1.5 right-0 min-h-11 min-w-11 flex items-center justify-center rounded-md z-10 transition-opacity focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        isProtected
          ? 'cursor-not-allowed text-muted-foreground opacity-40'
          : 'text-muted-foreground opacity-0 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100',
      )}
    >
      <X className="h-3.5 w-3.5" />
    </button>
  ) : null

  return (
    <>
      {showUnlinkButton ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onUnlinkClick}
              aria-label={
                isLocalSkill
                  ? `Delete ${skill.name} from ${selectedAgentName}`
                  : `Unlink ${skill.name} from ${selectedAgentName}`
              }
              className="absolute top-1.5 right-0 min-h-11 min-w-11 flex items-center justify-center rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive z-10 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
      ) : null}

      {globalDeleteButton ? (
        <Tooltip>
          <TooltipTrigger asChild>{globalDeleteButton}</TooltipTrigger>
          {/* Keep the recovery hint clear of the adjacent Unlock control. */}
          <TooltipContent
            side={isProtected ? 'bottom' : 'left'}
            align={isProtected ? 'end' : 'center'}
          >
            {isProtected ? 'Unlock to delete' : 'Delete'}
          </TooltipContent>
        </Tooltip>
      ) : null}

      <ProtectButton
        skillName={skill.name}
        showBookmark={showBookmark}
        hasXButton={hasXButton}
      />

      {showBookmark ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onToggleBookmark}
              aria-label={
                isBookmarked
                  ? `Remove bookmark from ${skill.name}`
                  : `Bookmark ${skill.name}`
              }
              className={cn(
                'absolute top-1.5 min-h-11 min-w-11 flex items-center justify-center rounded-md z-10 transition-opacity focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                showUnlinkButton || showDeleteButton ? 'right-11' : 'right-0',
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
      ) : null}
    </>
  )
}

interface BulkSelectionCheckboxProps {
  bulkSelectMode: boolean
  isTicked: boolean
  isBulkSelectable: boolean
  skillName: SkillName
  onCheckedChange: (checked: boolean | 'indeterminate') => void
  onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void
}

/**
 * Prevents checkbox label clicks from opening the row while preserving the checkbox's own toggle.
 * @param event - Label click from the bulk selection hit area.
 * @returns void
 * @example <label onClick={handleBulkSelectionLabelClick}>
 */
function handleBulkSelectionLabelClick(
  event: React.MouseEvent<HTMLLabelElement>,
): void {
  event.stopPropagation()
}

/**
 * Shows the row checkbox only while Installed bulk-select mode is active.
 * @param props - Selection state, eligibility, and handlers prepared by SkillItem.
 * @returns Checkbox label with stable hit area, or null outside bulk-select mode.
 * @example
 * <BulkSelectionCheckbox bulkSelectMode={true} isTicked={false} skillName="task" />
 */
const BulkSelectionCheckbox = function BulkSelectionCheckbox({
  bulkSelectMode,
  isTicked,
  isBulkSelectable,
  skillName,
  onCheckedChange,
  onPointerDown,
}: BulkSelectionCheckboxProps): React.ReactElement | null {
  if (!bulkSelectMode) return null

  return (
    // react-doctor-disable-next-line react-doctor/label-has-associated-control, react-doctor/no-noninteractive-element-interactions -- the label wraps a Radix <Checkbox> (renders a real <input>) that react-doctor can't see as the control; the onClick is a stopPropagation guard, not an interactive handler.
    <label
      className="shrink-0 min-h-11 min-w-11 flex items-center justify-center -mt-1 -ml-1 cursor-pointer"
      onClick={handleBulkSelectionLabelClick}
    >
      <Checkbox
        checked={isTicked}
        onCheckedChange={onCheckedChange}
        onPointerDown={onPointerDown}
        disabled={!isBulkSelectable && !isTicked}
        aria-label={
          isTicked
            ? `Deselect ${skillName}`
            : isBulkSelectable
              ? `Select ${skillName}`
              : `${skillName} is not eligible for bulk selection`
        }
      />
    </label>
  )
}
