import {
  ArrowDownAZ,
  ArrowUpAZ,
  Copy,
  Loader2,
  Trash2,
  Unlink,
  X,
} from 'lucide-react'
import React, { useRef } from 'react'

import { Button } from '@/renderer/src/components/ui/button'
import { Checkbox } from '@/renderer/src/components/ui/checkbox'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/renderer/src/components/ui/tooltip'
import { useUpdateEffect } from '@/renderer/src/hooks/useUpdateEffect'
import { cn } from '@/renderer/src/lib/utils'
import { useAppDispatch, useAppSelector } from '@/renderer/src/redux/hooks'
import {
  selectBulkSelectableVisibleSkillNames,
  selectFilteredSkillCount,
  selectHiddenSelectedCount,
  selectSelectedCount,
  selectSelectedVisibleCount,
  selectVisibleIneligibleSelectedCount,
} from '@/renderer/src/redux/selectors'
import {
  clearSelection,
  selectAll,
  selectBulkProgress,
  selectIsBulkOpBusy,
} from '@/renderer/src/redux/slices/skillsSlice'
import {
  selectSelectedAgentId,
  selectSortOrder,
  toggleSortOrder,
} from '@/renderer/src/redux/slices/uiSlice'
import { formatInstalledSearchCount } from '@/renderer/src/utils/formatInstalledSearchCount'
import { pluralize } from '@/renderer/src/utils/pluralize'
import { BULK_PROGRESS_THRESHOLD } from '@/shared/constants'
import { toSkillCount } from '@/shared/types'

import { getPrimaryActionState } from './bulkDeleteHelpers'

/**
 * Shared `<kbd>` hint styling (DESIGN.md "Keyboard Shortcut Hints"). A border
 * in the text color and no fill, so the chip stays legible on the ghost
 * button's hover fill; the Button's own gap spaces it from the label.
 */
const KBD_HINT_CLASS =
  'rounded border border-current/25 px-1 py-0.5 font-mono text-[10px] leading-none opacity-60'

/**
 * `<kbd>` hint styling inside a tooltip. The tooltip is always slate-700 with
 * white text, so the hint uses white alphas instead of the theme's muted tokens.
 */
const TOOLTIP_KBD_HINT_CLASS =
  'ml-1.5 rounded border border-white/20 bg-white/10 px-1 py-0.5 font-mono text-[10px] leading-none text-white/80'

/** Radix checkbox value: unchecked, checked, or the mixed state. */
type MasterCheckedState = boolean | 'indeterminate'

interface InstalledListHeaderProps {
  /**
   * Callback fired when the primary destructive action is clicked.
   * MainContent opens the Delete/Unlink confirmation, so the header stays
   * presentation-only.
   */
  onPrimaryAction: () => void
  /**
   * The name of the currently selected agent (for agent-view unlink label).
   * Undefined when in global view.
   */
  agentDisplayName?: string
  /**
   * Callback fired when the non-destructive "Copy to…" action is clicked.
   * MainContent opens the BulkCopyToAgentsModal. Only rendered in global view
   * (selectedAgentId === null); omit it to hide the button.
   */
  onCopyAction?: () => void
}

/**
 * The Installed list's 36px header row, rendered above {@link SkillsList} and outside
 * its scroller so it never scrolls away. Selection is modeless: the tri-state
 * master checkbox is always here, and the rest of the row swaps on the
 * selection alone.
 *   - Rest (0 selected): the `Name` sort toggle and, with the `inline` count
 *     setting, the visible-skill count.
 *   - Selected: `N selected`, the `+N hidden` / `+N not eligible` indicators
 *     (or the bulk progress), then Copy to… (global view), the primary
 *     Delete/Unlink action and Clear.
 * The row is a container: below a 30rem content width Copy turns icon-only and
 * the indicators show only their numbers (their words stay for screen readers);
 * below 24rem the summary becomes screen-reader-only and every action shrinks,
 * so the row never wraps. In every tier the count and the `+N` numbers stay
 * whole: a crowded row drops the indicator words first, then truncates the
 * primary label, whose tooltip keeps the whole action. Accessible names and
 * tooltips are identical in every tier.
 *
 * When the swap removes the control that had keyboard focus (Clear, or ⌘A/Esc
 * pressed from a header button), focus moves to the master checkbox, the one
 * control both states share, instead of dropping to the page.
 *
 * The component never dispatches the bulk op itself; MainContent owns the
 * confirmation + dispatch flow.
 *
 * @param onPrimaryAction - Callback when the user clicks Delete / Unlink
 * @param agentDisplayName - For the "Unlink from {agent}" label
 * @param onCopyAction - Opens the bulk copy modal; omit to hide Copy to…
 * @returns The list header row
 * @example
 * <InstalledListHeader onPrimaryAction={openConfirm} onCopyAction={openCopy} agentDisplayName="Cursor" />
 */
export const InstalledListHeader = function InstalledListHeader({
  onPrimaryAction,
  agentDisplayName,
  onCopyAction,
}: InstalledListHeaderProps): React.ReactElement {
  const selectedCount = useAppSelector(selectSelectedCount)
  const isBulkOpBusy = useAppSelector(selectIsBulkOpBusy)
  const hasSelection = selectedCount > 0
  const masterCheckboxRef = useRef<HTMLButtonElement | null>(null)
  // The control that held focus when its half of the row unmounted, if any.
  const focusedBeforeSwapRef = useRef<Element | null>(null)

  // React detaches this ref before it removes the swapped-out half, so the
  // focused control is still in the DOM when the cleanup reads it. The latest
  // cleanup always overwrites, so a stale record can never steal focus later.
  const rememberFocusBeforeSwap = (
    swappedContent: HTMLDivElement | null,
  ): (() => void) | undefined => {
    if (swappedContent === null) return undefined
    return (): void => {
      const { activeElement } = document
      focusedBeforeSwapRef.current =
        activeElement !== null && swappedContent.contains(activeElement)
          ? activeElement
          : null
    }
  }

  useUpdateEffect(() => {
    const focusedBeforeSwap = focusedBeforeSwapRef.current
    focusedBeforeSwapRef.current = null
    // Only a control the swap removed strands focus; one that survived keeps it.
    if (focusedBeforeSwap === null || focusedBeforeSwap.isConnected) return
    // Focus the user already moved elsewhere is theirs to keep.
    const { activeElement } = document
    if (activeElement !== null && activeElement !== document.body) return
    masterCheckboxRef.current?.focus()
  }, [hasSelection])

  return (
    <div
      // `@container` lets the tiers key off this row's own width, not the window.
      // pl-[17px] matches a card's 1px border + 16px padding, so the master box
      // sits on the row checkbox column.
      className={cn(
        '@container h-9 shrink-0 flex flex-nowrap items-center gap-2 pl-[17px] pr-2 border-b border-border rounded-t-md transition-colors duration-150 motion-reduce:transition-none',
        hasSelection && 'bg-primary/5',
      )}
      // `role="group"` rather than `role="toolbar"`: the WAI-ARIA toolbar
      // pattern requires roving-tabindex arrow-key navigation between its
      // children, which we do not implement. `group` keeps the labelled
      // container semantics without overclaiming behaviour we don't provide.
      // react-doctor-disable-next-line react-doctor/prefer-tag-over-role -- role="group" is the correct labelled-container semantic; <address> (react-doctor's suggestion) is for contact info, not a toolbar group.
      role="group"
      aria-label="List header"
    >
      <MasterSelectionCheckbox
        ref={masterCheckboxRef}
        isBulkOpBusy={isBulkOpBusy}
      />
      {/* `contents` keeps the row's flex layout; the key remounts it per state. */}
      <div
        key={hasSelection ? 'selected' : 'rest'}
        ref={rememberFocusBeforeSwap}
        className="contents"
      >
        {hasSelection ? (
          <SelectedHeaderContent
            selectedCount={selectedCount}
            isBulkOpBusy={isBulkOpBusy}
            onPrimaryAction={onPrimaryAction}
            onCopyAction={onCopyAction}
            agentDisplayName={agentDisplayName}
          />
        ) : (
          <RestHeaderContent isBulkOpBusy={isBulkOpBusy} />
        )}
      </div>
    </div>
  )
}

/**
 * Maps how many eligible visible rows are ticked onto the master checkbox state.
 * @param tickedCount - Selected names that are visible and bulk-eligible.
 * @param eligibleCount - Visible bulk-eligible names.
 * @returns
 * - `false` when none are ticked (an empty list included)
 * - `true` when every eligible visible row is ticked
 * - `'indeterminate'` otherwise
 * @example
 * getMasterCheckedState(0, 5) // => false
 * getMasterCheckedState(5, 5) // => true
 * getMasterCheckedState(2, 5) // => 'indeterminate'
 */
function getMasterCheckedState(
  tickedCount: number,
  eligibleCount: number,
): MasterCheckedState {
  if (tickedCount === 0) return false
  return tickedCount === eligibleCount ? true : 'indeterminate'
}

/**
 * Picks the keyboard shortcut the master checkbox tooltip advertises, so the
 * hint always names the key that does what a click would do right now.
 * @param checkedState - The master checkbox's current state.
 * @param isDisabled - True with nothing eligible to select or while a bulk op settles.
 * @returns
 * - `null` when disabled, since neither key does anything then
 * - `'Esc'` when checked, because a click clears the selection
 * - `'⌘A'` when unchecked or mixed, because a click selects every eligible row
 * @example
 * getMasterShortcutHint(false, false) // => '⌘A'
 * getMasterShortcutHint(true, false) // => 'Esc'
 * getMasterShortcutHint('indeterminate', true) // => null
 */
function getMasterShortcutHint(
  checkedState: MasterCheckedState,
  isDisabled: boolean,
): '⌘A' | 'Esc' | null {
  if (isDisabled) return null
  return checkedState === true ? 'Esc' : '⌘A'
}

/**
 * Names what a click on the master checkbox does, for its accessible name and
 * tooltip. With nothing eligible it says so, rather than offering to select 0.
 * @param checkedState - The master checkbox's current state.
 * @param eligibleCount - Visible rows the current view can bulk-select.
 * @returns
 * - `'No skills to select'` with nothing eligible, when the box is disabled
 * - `'Deselect all'` when checked, because a click clears the selection
 * - `'Select all N visible skill(s)'` when unchecked or mixed
 * @example
 * getMasterLabel(false, 0) // => 'No skills to select'
 * getMasterLabel(true, 3) // => 'Deselect all'
 * getMasterLabel('indeterminate', 1) // => 'Select all 1 visible skill'
 */
function getMasterLabel(
  checkedState: MasterCheckedState,
  eligibleCount: number,
):
  | 'No skills to select'
  | 'Deselect all'
  | `Select all ${number} visible ${string}` {
  if (eligibleCount === 0) return 'No skills to select'
  if (checkedState === true) return 'Deselect all'
  return `Select all ${eligibleCount} visible ${pluralize(eligibleCount, 'skill')}`
}

interface MasterSelectionCheckboxProps {
  isBulkOpBusy: boolean
  /** The header moves focus here when a state swap removes the focused control. */
  ref?: React.Ref<HTMLButtonElement>
}

/**
 * Tri-state select-all checkbox (W3C APG mixed checkbox) aligned with the row
 * checkbox column: unchecked or mixed selects every eligible visible row,
 * checked clears the whole selection. Disabled with nothing eligible to select
 * (empty, loading, or errored list) and while a bulk op settles.
 * @param props - Bulk-op busy flag and the focus ref from the header.
 * @returns The master checkbox in a 28px hit area, with its shortcut tooltip.
 * @example
 * <MasterSelectionCheckbox ref={masterCheckboxRef} isBulkOpBusy={false} />
 */
const MasterSelectionCheckbox = function MasterSelectionCheckbox({
  isBulkOpBusy,
  ref,
}: MasterSelectionCheckboxProps): React.ReactElement {
  const dispatch = useAppDispatch()
  const eligibleVisibleNames = useAppSelector(
    selectBulkSelectableVisibleSkillNames,
  )
  const tickedEligibleCount = useAppSelector(selectSelectedVisibleCount)
  const eligibleCount = eligibleVisibleNames.length
  const checkedState = getMasterCheckedState(tickedEligibleCount, eligibleCount)
  const isDisabled = eligibleCount === 0 || isBulkOpBusy
  const label = getMasterLabel(checkedState, eligibleCount)
  const shortcutHint = getMasterShortcutHint(checkedState, isDisabled)

  const handleCheckedChange = (nextChecked: MasterCheckedState): void => {
    // Radix moves unchecked and mixed to true, and checked to false.
    if (nextChecked === true) {
      dispatch(selectAll(eligibleVisibleNames))
      return
    }
    dispatch(clearSelection())
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* react-doctor-disable-next-line react-doctor/label-has-associated-control -- the label wraps a Radix <Checkbox> (a real <button role="checkbox">) that react-doctor can't see as the control. */}
        <label
          className={cn(
            // -ml-1.5 lines the box up with the row checkboxes below; mr-1 plus
            // the row's gap-2 matches a card's gap-3, so the text after the box
            // starts on the skill titles' column.
            'shrink-0 size-7 -ml-1.5 mr-1 flex items-center justify-center',
            isDisabled ? 'cursor-not-allowed' : 'cursor-pointer',
          )}
        >
          <Checkbox
            ref={ref}
            checked={checkedState}
            disabled={isDisabled}
            aria-label={label}
            onCheckedChange={handleCheckedChange}
            // Keeps the row boxes' `border-primary` (3:1 at rest). ui/checkbox.tsx
            // only fills the checked state; these fill mixed too.
            className="data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground transition-colors motion-reduce:transition-none"
          />
        </label>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {label}
        {shortcutHint !== null ? (
          <kbd className={TOOLTIP_KBD_HINT_CLASS}>{shortcutHint}</kbd>
        ) : null}
      </TooltipContent>
    </Tooltip>
  )
}

interface RestHeaderContentProps {
  isBulkOpBusy: boolean
}

/**
 * The header's rest state (nothing selected): the `Name` sort toggle, plus the
 * visible-skill count when the user keeps it in the list header rather than the
 * Installed tab badge.
 * @param props - Bulk-op busy flag; a per-row Delete can run with 0 selected.
 * @returns Sort button and the optional live count.
 * @example
 * <RestHeaderContent isBulkOpBusy={false} />
 */
const RestHeaderContent = function RestHeaderContent({
  isBulkOpBusy,
}: RestHeaderContentProps): React.ReactElement {
  const dispatch = useAppDispatch()
  const sortOrder = useAppSelector(selectSortOrder)
  const filteredSkillCount = useAppSelector(selectFilteredSkillCount)
  const countDisplay = useAppSelector(
    (state) => state.settings.installedSearchCountDisplay,
  )

  const handleToggleSortOrder = (): void => {
    dispatch(toggleSortOrder())
  }

  return (
    <>
      <Button
        variant="ghost"
        size="xs"
        onClick={handleToggleSortOrder}
        disabled={isBulkOpBusy}
        // Starts with the visible "Name" so voice control can target it (WCAG 2.5.3).
        aria-label={
          sortOrder === 'asc'
            ? 'Name, sorted A to Z, click to reverse'
            : 'Name, sorted Z to A, click to reverse'
        }
        // Ghost hover supplies `text-accent-foreground`, readable on `bg-accent`.
        className="-ml-2 gap-1 text-xs text-muted-foreground [&_svg]:size-3.5"
      >
        Name
        {/* The arrow flips with the order; swapped letters alone are unreadable at 14px. */}
        {sortOrder === 'asc' ? <ArrowDownAZ /> : <ArrowUpAZ />}
      </Button>
      {/* The `tab` setting moves this count onto the Installed tab badge. */}
      {countDisplay === 'inline' ? (
        <p
          className="ml-auto shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground"
          aria-live="polite"
          aria-atomic="true"
        >
          {formatInstalledSearchCount(filteredSkillCount)}
        </p>
      ) : null}
    </>
  )
}

interface SelectedHeaderContentProps {
  selectedCount: number
  isBulkOpBusy: boolean
  onPrimaryAction: () => void
  onCopyAction?: () => void
  agentDisplayName?: string
}

/**
 * The header's selected state: the selection summary on the left and the bulk
 * actions on the right. Every button is disabled while a bulk op settles.
 * @param props - Selected count, busy flag, and the header's action callbacks.
 * @returns Summary text plus the Copy to… / primary / Clear cluster.
 * @example
 * <SelectedHeaderContent selectedCount={3} isBulkOpBusy={false} onPrimaryAction={openConfirm} />
 */
const SelectedHeaderContent = function SelectedHeaderContent({
  selectedCount,
  isBulkOpBusy,
  onPrimaryAction,
  onCopyAction,
  agentDisplayName,
}: SelectedHeaderContentProps): React.ReactElement {
  const dispatch = useAppDispatch()
  const visibleSelectedCount = useAppSelector(selectSelectedVisibleCount)
  const hiddenSelectedCount = useAppSelector(selectHiddenSelectedCount)
  const visibleIneligibleSelectedCount = useAppSelector(
    selectVisibleIneligibleSelectedCount,
  )
  const selectedAgentId = useAppSelector(selectSelectedAgentId)
  const bulkProgress = useAppSelector(selectBulkProgress)

  const primaryActionState = getPrimaryActionState({
    view: selectedAgentId ? 'agent' : 'global',
    agentId: selectedAgentId,
    count: toSkillCount(selectedCount),
    visibleCount: toSkillCount(visibleSelectedCount),
    agentDisplayName,
  })
  // Only large batches get a counter, to keep small ops quiet.
  const progressText =
    bulkProgress !== null && bulkProgress.total >= BULK_PROGRESS_THRESHOLD
      ? `${bulkProgress.current} of ${bulkProgress.total}`
      : null

  const handleClear = (): void => {
    dispatch(clearSelection())
  }

  return (
    <>
      {/* Fills the room the actions leave; below 24rem it stays for screen
          readers only. No min-w-0: its content-based minimum is the count plus
          the `+N` numbers, so a crowded row drops the indicator words first,
          then truncates the primary label. */}
      <p className="flex flex-1 items-baseline text-sm @max-[24rem]:sr-only">
        <span
          aria-live="polite"
          className="shrink-0 whitespace-nowrap font-medium tabular-nums"
        >
          {selectedCount} selected
        </span>
        {/* While a large batch runs, its progress replaces the indicators. */}
        {progressText !== null ? (
          <span
            aria-live="polite"
            className="ml-2 shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground"
          >
            {progressText}
          </span>
        ) : (
          <>
            {/* Warns that ticked rows outside the filter will not be affected. */}
            {hiddenSelectedCount > 0 ? (
              <SelectionIndicator
                count={hiddenSelectedCount}
                words="hidden by filter"
                title={`${hiddenSelectedCount} selected ${pluralize(hiddenSelectedCount, 'row is', 'rows are')} hidden by the current filter and will not be affected`}
              />
            ) : null}
            {/* Separates on-screen rows the action skips from hidden ones. */}
            {visibleIneligibleSelectedCount > 0 ? (
              <SelectionIndicator
                count={visibleIneligibleSelectedCount}
                words="not eligible"
                title={`${visibleIneligibleSelectedCount} selected ${pluralize(visibleIneligibleSelectedCount, 'row is', 'rows are')} visible but cannot use this bulk action`}
              />
            ) : null}
          </>
        )}
      </p>

      {/* min-w-0 lets the primary label give up room before the count does. */}
      <div className="ml-auto flex min-w-0 items-center gap-1.5">
        {/* Non-destructive bulk copy — global view only. The tooltip names the
            action once narrow widths reduce it to a 24px icon. It copies the
            visible ticks only, so like the primary it rests with none on screen. */}
        {selectedAgentId === null && onCopyAction ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="xs"
                onClick={onCopyAction}
                disabled={isBulkOpBusy || visibleSelectedCount === 0}
                aria-label="Copy selected skills to agents"
                className="shrink-0 @max-[30rem]:size-6 @max-[30rem]:px-0"
              >
                <Copy />
                <span className="@max-[30rem]:hidden">Copy to…</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              Copy selected skills to agents
            </TooltipContent>
          </Tooltip>
        ) : null}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={
                primaryActionState.isDestructive ? 'destructive' : 'default'
              }
              size="xs"
              onClick={onPrimaryAction}
              disabled={primaryActionState.isPrimaryDisabled || isBulkOpBusy}
              aria-label={primaryActionState.primaryAriaLabel}
              className="min-w-0"
            >
              {isBulkOpBusy ? (
                <Loader2 className="animate-spin motion-reduce:animate-none" />
              ) : primaryActionState.isDestructive ? (
                <Trash2 />
              ) : (
                <Unlink />
              )}
              {/* A long agent name truncates instead of wrapping the row. */}
              <span className="min-w-0 max-w-48 truncate @max-[24rem]:hidden">
                {primaryActionState.primaryLabel}
              </span>
              <span className="hidden @max-[24rem]:inline">
                {primaryActionState.compactPrimaryLabel}
              </span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {primaryActionState.primaryAriaLabel}
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="xs"
              onClick={handleClear}
              disabled={isBulkOpBusy}
              aria-label="Clear selection"
              className="shrink-0 @max-[24rem]:size-6 @max-[24rem]:px-0"
            >
              <X className="hidden @max-[24rem]:block" />
              <span className="@max-[24rem]:hidden">Clear</span>
              {/* Esc stands down while a bulk op settles, so the hint goes too. */}
              {!isBulkOpBusy ? (
                <kbd className={cn(KBD_HINT_CLASS, '@max-[24rem]:hidden')}>
                  Esc
                </kbd>
              ) : null}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            Clear selection
            {!isBulkOpBusy ? (
              <kbd className={TOOLTIP_KBD_HINT_CLASS}>Esc</kbd>
            ) : null}
          </TooltipContent>
        </Tooltip>
      </div>
    </>
  )
}

interface SelectionIndicatorProps {
  /** Selected rows the note is about. */
  count: number
  /** The words after the number, e.g. `hidden by filter`. */
  words: string
  /** The whole sentence, shown on hover whatever the words have lost. */
  title: string
}

/**
 * One `+N words` note in the selected header's summary, e.g. `+2 hidden by
 * filter`. The number never shrinks. The words take only the room the row has
 * left and truncate inside it, and below 30rem they stay for screen readers
 * only; the `title` keeps the whole sentence either way.
 * @param props - The count, the words after it, and the full-sentence title.
 * @returns The note's number and words, laid out as items of the summary row.
 * @example
 * <SelectionIndicator count={2} words="hidden by filter" title="2 selected rows are hidden by the current filter and will not be affected" />
 */
const SelectionIndicator = function SelectionIndicator({
  count,
  words,
  title,
}: SelectionIndicatorProps): React.ReactElement {
  return (
    // `contents` makes the number and the words items of the summary row, so
    // each gets its own shrink rule; the `title` still covers both on hover.
    <span
      className="contents text-xs tabular-nums text-muted-foreground"
      title={title}
    >
      <span className="ml-2 shrink-0">+{count}</span>
      {/* w-0 keeps the words out of the summary's minimum width, and
          max-w-fit stops them growing past their own text. The nbsp survives
          the line-start whitespace collapse a flex item applies. */}
      <span className="w-0 max-w-fit grow truncate @max-[30rem]:sr-only">
        &nbsp;{words}
      </span>
    </span>
  )
}
