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
  selectSelectedCount,
  selectSelectedSkillNamesSet,
  selectVisibleSkillNames,
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
  selectIsBulkOpBusy,
  selectRange,
  selectSelectionAnchor,
  selectSkill,
  setSkillToAddSymlinks,
  setSkillToCopy,
  setSkillToUnlink,
  toggleSelection,
} from '@/renderer/src/redux/slices/skillsSlice'
import { setBulkConfirm } from '@/renderer/src/redux/slices/uiSlice'
import { BULK_ITEM_FAILED_EVENT } from '@/renderer/src/utils/bulkOpVisuals'
import { GSTACK_REPOSITORY_URL } from '@/shared/constants'
import type { AgentId, AgentName } from '@/shared/constants'
import type {
  Skill,
  SkillName,
  SymlinkCount,
  SymlinkInfo,
} from '@/shared/types'
import { toSymlinkCount } from '@/shared/types'

import { canBookmarkSkill, skillToBookmarkData } from './bookmarkHelpers'
import { computeRangeSelection } from './bulkDeleteHelpers'
import { partitionGlobalDeleteTargets } from './reviewedDestructiveTargets'
import {
  getCardClickIntent,
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
  /**
   * Scan-time identity of the skill directory, stored with the lock so a later
   * rename can be followed. `undefined` for rows the scan had none for (agent-only
   * links, orphans) — those locks stay name-only, exactly as before.
   */
  identity: Skill['filesystemIdentity']
  /** Whether the bookmark button is visible (affects horizontal positioning). */
  showBookmark: boolean
  /** Whether an X button (unlink or delete) is visible (affects positioning). */
  hasXButton: boolean
}

/**
 * Lock / unlock toggle shown on every skill row. Manages its own Redux state
 * so the parent SkillItem only needs `isProtected` for status and action guards.
 * @param props - Skill name, its filesystem identity, and the sibling-button flags used for positioning.
 * @returns Tooltip-wrapped lock icon button that dispatches protect actions.
 * @example
 * <ProtectButton skillName="task" identity={skill.filesystemIdentity} showBookmark={true} hasXButton={false} />
 */
const ProtectButton = function ProtectButton({
  skillName,
  identity,
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
      isProtected
        ? removeProtection(skillName)
        : // Recorded at lock time, not left to the next scan: the identity the
          // user is locking is the one on screen right now, and a rename before
          // the next `fetchSkills` would otherwise slip through unfollowed.
          addProtection({
            name: skillName,
            identity: identity && { dev: identity.dev, ino: identity.ino },
          }),
    )
  }

  const rightClass =
    showBookmark && hasXButton
      ? 'right-14'
      : hasXButton || showBookmark
        ? 'right-7'
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
            'absolute top-3.5 size-7 flex items-center justify-center rounded-md z-10 transition-opacity focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
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
    validCount: toSymlinkCount(0),
    brokenCount: toSymlinkCount(0),
    inaccessibleCount: toSymlinkCount(0),
    validAgentNames: [],
    brokenAgentNames: [],
    inaccessibleAgentNames: [],
  }

  for (const symlink of symlinks) {
    if (symlink.status === 'valid') {
      buckets.validCount = toSymlinkCount(buckets.validCount + 1)
      buckets.validAgentNames.push(symlink.agentName)
    } else if (symlink.status === 'broken') {
      buckets.brokenCount = toSymlinkCount(buckets.brokenCount + 1)
      buckets.brokenAgentNames.push(symlink.agentName)
    } else if (symlink.status === 'inaccessible') {
      buckets.inaccessibleCount = toSymlinkCount(buckets.inaccessibleCount + 1)
      buckets.inaccessibleAgentNames.push(symlink.agentName)
    }
  }

  return buckets
}

/**
 * Decide whether this rendered row can be ticked for a bulk action.
 * @param selectedAgentId - Current agent filter, or null in global view.
 * @param eligibleNames - Visible names the bulk selectors allow in the agent view.
 * @param skillName - Skill row currently rendered by SkillItem.
 * @returns
 * - true in the global view, where every row can be ticked
 * - true in an agent view when the row is among the eligible names
 * - false otherwise; the row's checkbox stays disabled unless already ticked
 * @example
 * canBulkSelectRenderedSkill(null, [], 'task') // => true
 * canBulkSelectRenderedSkill('cursor', ['task'], 'tdd') // => false
 */
function canBulkSelectRenderedSkill(
  selectedAgentId: AgentId | null,
  eligibleNames: readonly SkillName[],
  skillName: SkillName,
): boolean {
  if (selectedAgentId === null) return true
  return eligibleNames.includes(skillName)
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

/**
 * Shared amber pill styling for the three "this row needs a look" markers
 * (inaccessible link, orphan, unreadable). One string so the badges cannot
 * drift apart visually when one of them is restyled.
 */
const AMBER_STATUS_BADGE_CLASS =
  'inline-flex items-center rounded-md border border-amber-400/50 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300 shrink-0'

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
            className={AMBER_STATUS_BADGE_CLASS}
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
            className={AMBER_STATUS_BADGE_CLASS}
            aria-label="Orphan skill — source directory is missing"
            title="Source directory is missing — use Cleanup to remove the dangling symlinks"
          >
            orphan
          </span>
        )}
        {skill.isUnreadable && (
          <span
            // react-doctor-disable-next-line react-doctor/prefer-tag-over-role -- composed "unreadable" text status badge collapsed to one labelled graphic via role="img"+aria-label. <img> needs a src and cannot contain the badge text.
            role="img"
            data-testid={`skill-unreadable-badge-${skill.name}`}
            className={AMBER_STATUS_BADGE_CLASS}
            aria-label="Unreadable skill — SKILL.md could not be read"
            title="SKILL.md could not be read, so this folder cannot be confirmed as a skill — check its permissions"
          >
            unreadable
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
  const visibleNames = useAppSelector(selectVisibleSkillNames)
  const eligibleNames = useAppSelector(selectBulkSelectableVisibleSkillNames)
  // Once anything is ticked, every row shows its checkbox.
  const isAnyRowSelected = useAppSelector(
    (state) => selectSelectedCount(state) > 0,
  )
  const isBulkOpBusy = useAppSelector(selectIsBulkOpBusy)
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
    eligibleNames,
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
    // Bulk ops share one busy flag, so a second delete would end the running
    // header op's busy state early and its hand-off would drop newer ticks.
    if (isBulkOpBusy) return
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
        // A card's own Delete leaves the other ticked rows alone when it settles.
        origin: 'row',
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
   * ⇧ range from the anchor to this row — the one rule shared by the row
   * checkbox and a ⇧-click on the card. An empty span (nothing eligible in
   * reach) changes nothing.
   * @param anchorName - The selection anchor the range starts from.
   */
  const selectRangeToThisRow = (anchorName: SkillName): void => {
    const namesInRange = computeRangeSelection(
      anchorName,
      skill.name,
      visibleNames,
      new Set(eligibleNames),
    )
    if (namesInRange.length === 0) return
    dispatch(selectRange(namesInRange))
  }

  /**
   * Keeps a checkbox press from reaching the card: the card's context-menu
   * trigger would otherwise react to it (and steal the checkbox's focus).
   */
  const handleCheckboxPointerDown = (
    event: React.PointerEvent<HTMLButtonElement>,
  ): void => {
    event.stopPropagation()
  }

  /**
   * Routes a ⇧-click with an anchor to `selectRange` instead of a toggle.
   * Radix runs this handler before its own toggle and skips the toggle once
   * the default is prevented, so the clicked row is not flipped back off.
   * With no anchor (first click into an empty selection), a ⇧-click falls
   * through to the plain toggle, and the reducer promotes this row to the new
   * anchor. Behaves like macOS Finder: a first shift-click is not a range.
   */
  const handleCheckboxClick = (
    event: React.MouseEvent<HTMLButtonElement>,
  ): void => {
    if (!event.shiftKey || selectionAnchor === null) return
    event.preventDefault()
    selectRangeToThisRow(selectionAnchor)
  }

  const handleCheckedChange = (checked: boolean | 'indeterminate'): void => {
    // Only fire when the user actually toggled — ignore the initial sync from props.
    if (checked === 'indeterminate') return
    // Toggle only when the slice disagrees with the box's new state, so a box
    // that already matches the selection never flips the row twice.
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

  /**
   * A plain click toggles the inspector. ⌘-click toggles this row's bulk
   * selection and ⇧-click extends the range from the anchor; neither touches
   * the inspector. Selection clicks are inert while a bulk op settles.
   */
  const handleCardClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    const clickIntent = getCardClickIntent(event)
    if (clickIntent === 'open') {
      dispatch(selectSkill(isSelected ? null : skill))
      return
    }
    if (isBulkOpBusy) return
    // ⇧ needs an anchor to measure from; without one it toggles like ⌘.
    if (clickIntent === 'range' && selectionAnchor !== null) {
      selectRangeToThisRow(selectionAnchor)
      return
    }
    // An ineligible row can be let go but never picked up.
    if (isBulkSelectable || isTicked) {
      dispatch(toggleSelection(skill.name))
    }
  }

  const handleCardMouseDown = (
    event: React.MouseEvent<HTMLDivElement>,
  ): void => {
    // ⇧-click would otherwise drag the page's text selection across cards.
    if (event.shiftKey) event.preventDefault()
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
    return (): void => {
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
            // A ticked row tints so the batch reads at a glance; the inspected
            // row's full `border-primary` below still outranks it.
            isTicked && 'border-primary/40 bg-primary/5',
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
            // Orphan and unreadable share one amber "needs a look" accent. Orphan
            // is mutually exclusive with linked/local rows by definition, so the
            // order here is purely for the partial-fail override.
            !didPartialFail &&
              (skill.isOrphan || skill.isUnreadable) &&
              'border-l-2 border-l-amber-400/60',
            // In-flight fade while the row is part of an active bulk op.
            isInFlight && 'opacity-50 duration-150',
            // Partial-failure red edge (PARTIAL_FAIL_FLASH_MS).
            didPartialFail && 'border-l-2 border-l-red-500/70',
          )}
          onClick={handleCardClick}
          onMouseDown={handleCardMouseDown}
          onContextMenu={handleContextMenu}
        >
          <SkillItemOverlayActions
            skill={skill}
            protectButton={
              <ProtectButton
                skillName={skill.name}
                identity={skill.filesystemIdentity}
                showBookmark={showBookmark}
                hasXButton={showUnlinkButtonBase || showDeleteButtonBase}
              />
            }
            selectedAgentName={selectedAgentName}
            isLocalSkill={isLocalSkill}
            isProtected={isProtected}
            isBookmarked={isBookmarked}
            showBookmark={showBookmark}
            showUnlinkButton={showUnlinkButton}
            showDeleteButton={showDeleteButton}
            onUnlinkClick={handleUnlinkClick}
            onDeleteClick={handleDeleteClick}
            onToggleBookmark={handleToggleBookmark}
          />

          <CardContent
            className={cn(
              'p-4',
              // Reserve right space for the absolute-positioned X/bookmark
              // overlays so the always-visible "+ Add" control never slides
              // under them. Bookmark + X stack to 56px, so that case needs
              // pr-15 (60px), not the single-button pr-8 (32px).
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
                isTicked={isTicked}
                isBulkSelectable={isBulkSelectable}
                isAnyRowSelected={isAnyRowSelected}
                isBulkOpBusy={isBulkOpBusy}
                skillName={skill.name}
                onCheckedChange={handleCheckedChange}
                onPointerDown={handleCheckboxPointerDown}
                onClick={handleCheckboxClick}
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
  protectButton: React.ReactNode
  selectedAgentName: string
  isLocalSkill: boolean
  isProtected: boolean
  isBookmarked: boolean
  showBookmark: boolean
  showUnlinkButton: boolean
  showDeleteButton: boolean
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
  protectButton,
  selectedAgentName,
  isLocalSkill,
  isProtected,
  isBookmarked,
  showBookmark,
  showUnlinkButton,
  showDeleteButton,
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
        'absolute top-3.5 right-0 size-7 flex items-center justify-center rounded-md z-10 transition-opacity focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
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
              className="absolute top-3.5 right-0 size-7 flex items-center justify-center rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive z-10 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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

      {protectButton}

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
                'absolute top-3.5 size-7 flex items-center justify-center rounded-md z-10 transition-opacity focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                showUnlinkButton || showDeleteButton ? 'right-7' : 'right-0',
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
  isTicked: boolean
  isBulkSelectable: boolean
  /** True once any row is ticked; every row then shows its checkbox. */
  isAnyRowSelected: boolean
  /** True while a bulk op runs; the checkbox is disabled until it settles. */
  isBulkOpBusy: boolean
  skillName: SkillName
  onCheckedChange: (checked: boolean | 'indeterminate') => void
  onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
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
 * The row's bulk-selection checkbox, always rendered in a fixed 28px gutter so
 * ticking the first row never shifts the card content (selection is modeless).
 * With nothing selected the column stays quiet: a row's box appears on hover or
 * keyboard focus. Once any row is ticked, every row shows its box, so the
 * header's Delete/Unlink is only reachable while each ticked row is visible.
 * @param props - Selection state, eligibility, busy flag, and handlers prepared by SkillItem.
 * @returns Checkbox label with a stable 28px hit area.
 * @example
 * <BulkSelectionCheckbox isTicked={false} isBulkSelectable isAnyRowSelected={false} isBulkOpBusy={false} skillName="task" />
 */
const BulkSelectionCheckbox = function BulkSelectionCheckbox({
  isTicked,
  isBulkSelectable,
  isAnyRowSelected,
  isBulkOpBusy,
  skillName,
  onCheckedChange,
  onPointerDown,
  onClick,
}: BulkSelectionCheckboxProps): React.ReactElement {
  const isDisabled = isBulkOpBusy || (!isBulkSelectable && !isTicked)

  return (
    // react-doctor-disable-next-line react-doctor/label-has-associated-control, react-doctor/no-noninteractive-element-interactions -- the label wraps a Radix <Checkbox> (renders a real <input>) that react-doctor can't see as the control; the onClick is a stopPropagation guard, not an interactive handler.
    <label
      className={cn(
        'shrink-0 size-7 -mt-1.5 -ml-1.5 flex items-center justify-center cursor-pointer',
        // A disabled box cannot take focus, so it only needs the hover reveal.
        // It lives on the label because the checkbox's own
        // `disabled:opacity-50` would outrank an `opacity-0` on the box.
        !isAnyRowSelected &&
          isDisabled &&
          'opacity-0 group-hover:opacity-100 transition-opacity duration-150 motion-reduce:transition-none',
      )}
      onClick={handleBulkSelectionLabelClick}
    >
      <Checkbox
        checked={isTicked}
        onCheckedChange={onCheckedChange}
        onPointerDown={onPointerDown}
        onClick={onClick}
        disabled={isDisabled}
        aria-label={
          isTicked
            ? `Deselect ${skillName}`
            : isBulkSelectable
              ? `Select ${skillName}`
              : `${skillName} is not eligible for bulk selection`
        }
        className={cn(
          // The reveal sits on the focusable box itself, so Tab reveals it.
          !isAnyRowSelected &&
            !isDisabled &&
            'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=checked]:opacity-100 transition-opacity duration-150 motion-reduce:transition-none',
        )}
      />
    </label>
  )
}
