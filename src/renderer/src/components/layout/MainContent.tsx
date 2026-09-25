import { AlertTriangle, ChevronDown, GitBranch } from 'lucide-react'
import React, { useRef } from 'react'
import { toast } from 'sonner'

import { LockPruneDialog } from '@/renderer/src/components/dashboard/LockPruneDialog'
import { SymlinkCleanupDialog } from '@/renderer/src/components/dashboard/SymlinkCleanupDialog'
import { SkillsMarketplace } from '@/renderer/src/components/marketplace'
import { InstallModal } from '@/renderer/src/components/marketplace/InstallModal'
import { FilterPill } from '@/renderer/src/components/shared/FilterPill'
import { CleanupAgentDialog } from '@/renderer/src/components/sidebar/CleanupAgentDialog'
import { SyncConfirmDialog } from '@/renderer/src/components/sidebar/SyncConfirmDialog'
import { SyncConflictDialog } from '@/renderer/src/components/sidebar/SyncConflictDialog'
import { SyncResultDialog } from '@/renderer/src/components/sidebar/SyncResultDialog'
import { AddSymlinkModal } from '@/renderer/src/components/skills/AddSymlinkModal'
import { BulkCopyToAgentsModal } from '@/renderer/src/components/skills/BulkCopyToAgentsModal'
import { renderBulkDeleteDescription } from '@/renderer/src/components/skills/bulkDeleteCopy'
import {
  formatCascadeSummary,
  formatUnlinkSummary,
} from '@/renderer/src/components/skills/bulkDeleteHelpers'
import { CopyToAgentsModal } from '@/renderer/src/components/skills/CopyToAgentsModal'
import { InstalledListHeader } from '@/renderer/src/components/skills/InstalledListHeader'
import {
  buildAgentUnlinkTargets,
  type PartitionedGlobalDeleteTargets,
  partitionGlobalDeleteTargets,
} from '@/renderer/src/components/skills/reviewedDestructiveTargets'
import { SearchBox } from '@/renderer/src/components/skills/SearchBox'
import { SkillsList } from '@/renderer/src/components/skills/SkillsList'
import { UndoToast } from '@/renderer/src/components/skills/UndoToast'
import { UnlinkDialog } from '@/renderer/src/components/skills/UnlinkDialog'
import { Button } from '@/renderer/src/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/renderer/src/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/renderer/src/components/ui/dropdown-menu'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/renderer/src/components/ui/tabs'
import { useCycleEffect } from '@/renderer/src/hooks/useCycleEffect'
import { useInitialEffect } from '@/renderer/src/hooks/useInitialEffect'
import { useMarketplaceProgress } from '@/renderer/src/hooks/useMarketplaceProgress'
import { useRenderEffect } from '@/renderer/src/hooks/useRenderEffect'
import { cn } from '@/renderer/src/lib/utils'
import { useAppDispatch, useAppSelector } from '@/renderer/src/redux/hooks'
import {
  type RepoFacetOption,
  selectBulkSelectableVisibleSkillNames,
  selectFilteredSkillCount,
  selectRepoFacetOptions,
  selectSelectedVisibleNames,
  selectSourceFilterViewModel,
  type SourceFilterViewModel,
} from '@/renderer/src/redux/selectors'
import { setPreviewSkill } from '@/renderer/src/redux/slices/marketplaceSlice'
import { selectProtectedNamesSet } from '@/renderer/src/redux/slices/protectSlice'
import {
  clearSelection,
  clearSelectedOrphanSymlinks,
  deleteSelectedSkills,
  narrowSelection,
  selectAll,
  selectIsBulkOpBusy,
  selectSelectedSkillNames,
  selectSkillsItems,
  setBulkCopyModalOpen,
  setBulkProgress,
  undoLastBulkDelete,
  unlinkSelectedFromAgent,
} from '@/renderer/src/redux/slices/skillsSlice'
import {
  clearBulkConfirm,
  clearExcludedSkillTypeFilters,
  clearSelectedSources,
  clearUndoToast,
  clearUndoToastIfCurrent,
  getAvailableExcludeTypes,
  selectAgent,
  selectBulkConfirm,
  selectExcludedSkillTypeFilters,
  setActiveTab,
  setBulkConfirm,
  setSelectedSources,
  setSkillTypeFilter,
  setUndoToast,
  toggleExcludedSkillTypeFilter,
  toggleSource,
} from '@/renderer/src/redux/slices/uiSlice'
import type {
  ActiveTab,
  BulkConfirmState,
  ExcludableSkillTypeFilter,
  SkillTypeFilter,
} from '@/renderer/src/redux/slices/uiSlice'
import { refreshAllData } from '@/renderer/src/redux/thunks'
import { flashFailedRows } from '@/renderer/src/utils/bulkOpVisuals'
import { errorToastDescription } from '@/renderer/src/utils/errorToastDescription'
import { formatInstalledSearchCount } from '@/renderer/src/utils/formatInstalledSearchCount'
import { isEditableTarget } from '@/renderer/src/utils/isEditableTarget'
import { isInspectorFocused } from '@/renderer/src/utils/isInspectorFocused'
import { pluralize } from '@/renderer/src/utils/pluralize'
import {
  SOURCE_FILTER_MAX_VISIBLE_REPOS,
  UNDO_WINDOW_MS,
} from '@/shared/constants'
import type { Settings } from '@/shared/settings'
import type {
  Agent,
  BulkDeleteItemResult,
  IsoTimestamp,
  RepositoryId,
  Skill,
  ToastId,
  TombstoneId,
} from '@/shared/types'
import { toIsoTimestamp } from '@/shared/types'

/** One row of the skill-type include menu: the filter it selects plus its presentation. */
interface SkillTypeFilterOption {
  value: SkillTypeFilter
  label: string
  /** Colored dot class to match skill type visual indicators */
  dotClass?: string
  /**
   * Optional hover hint surfaced as a native tooltip. Used for modes whose
   * label is not self-explanatory (Unique reads as opaque without it) so the
   * filter is discoverable without docs. @see issue #203
   */
  hint?: string
}

const SKILL_TYPE_FILTER_OPTIONS: SkillTypeFilterOption[] = [
  { value: 'all', label: 'All' },
  { value: 'symlinked', label: 'Symlinked', dotClass: 'bg-success' },
  { value: 'local', label: 'Local', dotClass: 'bg-emerald-400' },
  { value: 'gstack', label: 'G-Stack', dotClass: 'bg-gstack' },
  { value: 'orphan', label: 'Orphan', dotClass: 'bg-destructive' },
  {
    value: 'unique',
    label: 'Unique',
    dotClass: 'bg-violet-400',
    hint: 'Available to only one agent',
  },
]

const EXCLUDABLE_SKILL_TYPE_FILTER_OPTIONS = SKILL_TYPE_FILTER_OPTIONS.filter(
  (
    option,
  ): option is SkillTypeFilterOption & { value: ExcludableSkillTypeFilter } =>
    option.value !== 'all',
)

/**
 * Explain why an exclude checkbox is unavailable for the current include mode.
 * @param includeFilter - Positive skill type selected in the Include group.
 * @param excludeFilter - Negative skill type shown in the Exclude group.
 * @returns Short helper copy, or null when the option is available.
 * @example
 * getUnavailableExcludeReason('symlinked', 'local') // => "Not in view"
 */
function getUnavailableExcludeReason(
  includeFilter: SkillTypeFilter,
  excludeFilter: ExcludableSkillTypeFilter,
): string | null {
  if (getAvailableExcludeTypes(includeFilter).includes(excludeFilter)) {
    return null
  }
  return includeFilter === excludeFilter ? 'Already included' : 'Not in view'
}

type ExcludedSkillTypeToggleHandlers = Record<
  ExcludableSkillTypeFilter,
  () => void
>

interface InstalledBulkKeyboardShortcutsOptions {
  activeTab: ActiveTab
  selectedCount: number
  visibleNames: Skill['name'][]
  isBulkOpBusy: boolean
}

/**
 * Registers the Installed tab's selection shortcuts while that tab is active.
 * Selection is modeless, so they are always on there: ⌘/Ctrl+A selects every
 * visible eligible row and Esc clears a non-empty selection. Both stand down
 * inside editable targets (the search box keeps native text select-all), under
 * open dialogs and menus, for a key an overlay already handled (the Esc that
 * dismisses it), and while a bulk op settles. ⌘A also leaves the Inspector's
 * text to native select-all.
 * @param options - Active tab, selected count, visible eligible names, and the bulk-op busy flag.
 * @returns Nothing; attaches Cmd/Ctrl+A and Escape handlers while Installed is active.
 * @example
 * useInstalledBulkKeyboardShortcuts({ activeTab: 'installed', selectedCount: 2, visibleNames: ['task'], isBulkOpBusy: false })
 */
function useInstalledBulkKeyboardShortcuts({
  activeTab,
  selectedCount,
  visibleNames,
  isBulkOpBusy,
}: InstalledBulkKeyboardShortcutsOptions): void {
  const dispatch = useAppDispatch()
  const visibleNamesRef = useRef(visibleNames)
  const selectedCountRef = useRef(selectedCount)
  const isBulkOpBusyRef = useRef(isBulkOpBusy)

  useRenderEffect(() => {
    visibleNamesRef.current = visibleNames
  }, [visibleNames])
  useRenderEffect(() => {
    selectedCountRef.current = selectedCount
  }, [selectedCount])
  useRenderEffect(() => {
    isBulkOpBusyRef.current = isBulkOpBusy
  }, [isBulkOpBusy])

  useCycleEffect(() => {
    if (activeTab !== 'installed') return
    const handleKey = (event: KeyboardEvent): void => {
      // Radix prevents the Esc that dismisses a dialog or menu. By the time a
      // real keypress bubbles here React has already closed the overlay, so the
      // open-overlay query below would miss it and wipe the selection too.
      if (event.defaultPrevented) return

      const isSelectAllChord =
        (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a'
      // With nothing selected, Esc is left alone.
      const isClearKey = event.key === 'Escape' && selectedCountRef.current > 0
      // Cheap key checks first: every other keystroke skips the DOM queries.
      if (!isSelectAllChord && !isClearKey) return

      // Open dialogs and menus own Escape/Cmd+A, so bulk selection stands down.
      if (
        document.querySelector(
          '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"]',
        )
      )
        return

      // Editable surfaces, the search box included, keep native keyboard behavior.
      if (isEditableTarget(document.activeElement)) return

      if (isSelectAllChord) {
        // The Inspector's file text keeps native select-all.
        if (
          isInspectorFocused(
            document.activeElement,
            document.getSelection()?.anchorNode ?? null,
          )
        ) {
          return
        }
        event.preventDefault()
        // Like the disabled header checkbox: nothing to select, or an op is settling.
        if (isBulkOpBusyRef.current || visibleNamesRef.current.length === 0) {
          return
        }
        dispatch(selectAll(visibleNamesRef.current))
        return
      }
      event.preventDefault()
      if (isBulkOpBusyRef.current) return
      dispatch(clearSelection())
    }
    document.addEventListener('keydown', handleKey)
    return (): void => {
      document.removeEventListener('keydown', handleKey)
    }
  }, [dispatch, activeTab])
}

interface CreatePrimaryBulkActionOptions {
  selectedVisibleNames: Skill['name'][]
  selectedAgentId: Agent['id'] | null
  selectedAgentName: Agent['name'] | null
  sourceFilter: SourceFilterViewModel
  skills: Skill[]
  protectedNamesSet: ReadonlySet<Skill['name']>
}

type PrimaryBulkActionResult =
  | { kind: 'empty' }
  | { kind: 'stale-unlink'; staleNames: Skill['name'][] }
  | { kind: 'confirm'; confirm: BulkConfirmState }

/**
 * Builds the pending bulk confirm payload when MainContent primary action fires.
 * @param options - Current selection, active agent, source filter, skills, and protected names.
 * @returns Empty, stale-unlink failure, or a delete/unlink confirmation payload.
 * @example
 * createPrimaryBulkAction({ selectedVisibleNames: ['task'], selectedAgentId: null, selectedAgentName: null, sourceFilter, skills, protectedNamesSet })
 */
function createPrimaryBulkAction({
  selectedVisibleNames,
  selectedAgentId,
  selectedAgentName,
  sourceFilter,
  skills,
  protectedNamesSet,
}: CreatePrimaryBulkActionOptions): PrimaryBulkActionResult {
  if (selectedVisibleNames.length === 0) return { kind: 'empty' }
  const sourceSummary: BulkConfirmState['sourceSummary'] =
    sourceFilter.validRepoIds.length > 0 || sourceFilter.localHiddenCount > 0
      ? {
          repositoryIds: sourceFilter.validRepoIds,
          localHiddenCount: sourceFilter.localHiddenCount,
        }
      : null

  if (selectedAgentId) {
    const { targets, staleNames } = buildAgentUnlinkTargets(
      skills,
      selectedVisibleNames,
      selectedAgentId,
    )
    if (staleNames.length > 0) {
      return { kind: 'stale-unlink', staleNames }
    }
    return {
      kind: 'confirm',
      confirm: {
        kind: 'unlink',
        origin: 'selection',
        skillNames: targets.map((target) => target.skillName),
        agentId: selectedAgentId,
        agentName: selectedAgentName,
        sourceSummary,
        unlinkTargets: targets,
      },
    }
  }

  const {
    deleteTargets,
    orphanRecords,
    staleDeleteErrors,
    orphanErrors,
    protectedErrors,
  } = partitionGlobalDeleteTargets(
    skills,
    selectedVisibleNames,
    protectedNamesSet,
  )
  return {
    kind: 'confirm',
    confirm: {
      kind: 'delete',
      origin: 'selection',
      skillNames: selectedVisibleNames,
      agentId: null,
      agentName: null,
      sourceSummary,
      deleteTargets,
      orphanRecords,
      staleDeleteErrors,
      orphanErrors,
      protectedErrors,
    },
  }
}

/**
 * Creates the InstalledListHeader primary action callback when MainContent renders.
 * @param options - Current selection, agent, source filter, skills, and protected names.
 * @returns Callback that opens a bulk confirmation or reports stale unlink rows.
 * @example
 * const handlePrimaryAction = usePrimaryBulkAction({ selectedVisibleNames, selectedAgentId, selectedAgentName: null, sourceFilter, skills, protectedNamesSet })
 */
function usePrimaryBulkAction({
  selectedVisibleNames,
  selectedAgentId,
  selectedAgentName,
  sourceFilter,
  skills,
  protectedNamesSet,
}: CreatePrimaryBulkActionOptions): () => void {
  const dispatch = useAppDispatch()

  return (): void => {
    const result = createPrimaryBulkAction({
      selectedVisibleNames,
      selectedAgentId,
      selectedAgentName,
      sourceFilter,
      skills,
      protectedNamesSet,
    })
    if (result.kind === 'empty') return
    if (result.kind === 'stale-unlink') {
      flashFailedRows(result.staleNames)
      toast.error('Bulk unlink failed', {
        description: 'Selection changed. Rescan before unlinking.',
      })
      refreshAllData(dispatch)
      return
    }
    dispatch(setBulkConfirm(result.confirm))
  }
}

type BulkUnlinkConfirm = Extract<BulkConfirmState, { kind: 'unlink' }>
type BulkDeleteConfirm = Extract<BulkConfirmState, { kind: 'delete' }>
type UndoDeleteHandler = (tombstoneIds: TombstoneId[]) => Promise<void>
type HandOffRejectedDeleteSelection = (
  deleteNames: readonly Skill['name'][],
  cleanupReadyOrphanNames: readonly Skill['name'][],
  shouldHandOffSelection: boolean,
) => void
type ReconcileDeleteSelection = (
  deleteItems: readonly BulkDeleteItemResult[],
  orphanCleanupNames: ReadonlySet<Skill['name']>,
  shouldHandOffSelection: boolean,
) => { rescanRequiredNames: Skill['name'][] }

interface DeleteSelectionHandoff {
  handOffRejectedDeleteSelection: HandOffRejectedDeleteSelection
  reconcileDeleteSelection: ReconcileDeleteSelection
}

/**
 * Handles delete undo toast callbacks after useBulkConfirmActions shows UndoToast.
 * @param none - Reads dispatch from Redux hooks when MainContent mounts.
 * @returns Async UndoToast callback that restores tombstones and refreshes rows.
 * @example
 * const handleUndoDelete = useUndoDeleteHandler()
 */
function useUndoDeleteHandler(): UndoDeleteHandler {
  const dispatch = useAppDispatch()

  return async (tombstoneIds: TombstoneId[]): Promise<void> => {
    const action = await dispatch(undoLastBulkDelete(tombstoneIds))
    if (undoLastBulkDelete.fulfilled.match(action)) {
      const restoredCount = action.payload.filter(
        (outcome) => outcome.result.outcome === 'restored',
      ).length
      const totalCount = action.payload.length
      if (restoredCount === totalCount) {
        toast.success(
          `Restored ${restoredCount} ${pluralize(restoredCount, 'skill')}.`,
        )
      } else {
        toast.info(
          `Restored ${restoredCount} of ${totalCount} ${pluralize(totalCount, 'skill')}.`,
        )
      }
    } else {
      toast.error('Restore failed', {
        description: errorToastDescription(action),
      })
    }
    refreshAllData(dispatch)
    dispatch(clearUndoToast())
  }
}

/**
 * Hands the selection off after a delete settles: failed rows flash, and for a
 * header-started delete the selection narrows to the rows the user can retry.
 * Narrowing only removes names, so a tab/agent/sync switch that cleared the
 * selection while the delete ran is never undone.
 * @param none - Reads dispatch from Redux hooks when MainContent mounts.
 * @returns Hand-off (rejected thunk) and reconcile (settled run) callbacks used by the delete confirmation hook.
 * @example
 * const { reconcileDeleteSelection } = useDeleteSelectionHandoff()
 */
function useDeleteSelectionHandoff(): DeleteSelectionHandoff {
  const dispatch = useAppDispatch()

  const handOffRejectedDeleteSelection = (
    deleteNames: readonly Skill['name'][],
    cleanupReadyOrphanNames: readonly Skill['name'][],
    shouldHandOffSelection: boolean,
  ): void => {
    const unresolvedNames = Array.from(
      new Set([...deleteNames, ...cleanupReadyOrphanNames]),
    )
    flashFailedRows(unresolvedNames)
    // A rejected thunk keeps its attempted targets ticked for a retry.
    if (shouldHandOffSelection) dispatch(narrowSelection(unresolvedNames))
  }

  const reconcileDeleteSelection = (
    deleteItems: readonly BulkDeleteItemResult[],
    orphanCleanupNames: ReadonlySet<Skill['name']>,
    shouldHandOffSelection: boolean,
  ): { rescanRequiredNames: Skill['name'][] } => {
    const failedNames = deleteItems
      .filter((item) => item.outcome === 'error')
      .map((item) => item.skillName)
    const uniqueFailedNames = Array.from(new Set(failedNames))
    const rescanRequiredNames = Array.from(
      new Set(
        deleteItems
          .filter((item) =>
            isRescanRequiredDeleteError(item, orphanCleanupNames),
          )
          .map((item) => item.skillName),
      ),
    )
    const retryableFailedNames = uniqueFailedNames.filter(
      (name) => !rescanRequiredNames.includes(name),
    )

    flashFailedRows(uniqueFailedNames)
    // Only the retryable failures stay ticked; an all-success run clears.
    if (shouldHandOffSelection) {
      dispatch(narrowSelection(retryableFailedNames))
    }
    return { rescanRequiredNames }
  }

  return {
    handOffRejectedDeleteSelection,
    reconcileDeleteSelection,
  }
}

/**
 * Executes reviewed agent-view unlink confirmations after the dialog closes.
 * A header-started unlink then narrows the selection to its failed rows (or to
 * its attempted targets when the thunk rejects), so a retry needs no re-tick.
 * @param none - Reads dispatch from Redux hooks when MainContent mounts.
 * @returns Async callback for a narrowed unlink confirmation payload.
 * @example
 * const confirmBulkUnlink = useConfirmBulkUnlink()
 */
function useConfirmBulkUnlink(): (confirm: BulkUnlinkConfirm) => Promise<void> {
  const dispatch = useAppDispatch()

  return async (confirm: BulkUnlinkConfirm): Promise<void> => {
    const { agentId, agentName } = confirm
    const shouldHandOffSelection = confirm.origin === 'selection'
    const action = await dispatch(
      unlinkSelectedFromAgent({
        agentId,
        selectedNames: confirm.unlinkTargets,
      }),
    )
    if (unlinkSelectedFromAgent.fulfilled.match(action)) {
      const failedNames = action.payload.items
        .filter((item) => item.outcome === 'error')
        .map((item) => item.skillName)
      const unlinkedCount = action.payload.items.length - failedNames.length
      flashFailedRows(failedNames)
      if (shouldHandOffSelection) dispatch(narrowSelection(failedNames))
      if (unlinkedCount === 0) {
        toast.error('Bulk unlink failed', {
          description: formatUnlinkSummary(
            action.payload,
            agentName ?? 'agent',
          ),
        })
      } else {
        toast.success(formatUnlinkSummary(action.payload, agentName ?? 'agent'))
      }
    } else {
      const attemptedNames = confirm.unlinkTargets.map(
        (target) => target.skillName,
      )
      // Every attempted row failed, so each one flashes like a per-item failure.
      flashFailedRows(attemptedNames)
      // A rejected thunk keeps its attempted targets ticked for a retry.
      if (shouldHandOffSelection) dispatch(narrowSelection(attemptedNames))
      toast.error('Bulk unlink failed', {
        description: errorToastDescription(action),
      })
    }
    refreshAllData(dispatch)
  }
}

interface ConfirmBulkDeleteOptions {
  handleUndoDelete: UndoDeleteHandler
  reconcileDeleteSelection: ReconcileDeleteSelection
  handOffRejectedDeleteSelection: HandOffRejectedDeleteSelection
}

/**
 * Executes reviewed global delete confirmations including orphan cleanup and undo.
 * @param options - Undo, rejected-delete hand-off, and selection-reconciliation callbacks.
 * @returns Async callback for a narrowed delete confirmation payload.
 * @example
 * const confirmBulkDelete = useConfirmBulkDelete({ handleUndoDelete, reconcileDeleteSelection, handOffRejectedDeleteSelection })
 */
function useConfirmBulkDelete({
  handleUndoDelete,
  reconcileDeleteSelection,
  handOffRejectedDeleteSelection,
}: ConfirmBulkDeleteOptions): (confirm: BulkDeleteConfirm) => Promise<void> {
  const dispatch = useAppDispatch()

  return async (confirm: BulkDeleteConfirm): Promise<void> => {
    const { deleteTargets, orphanRecords, staleDeleteErrors, orphanErrors } =
      confirm
    // Only the header's Delete hands off the selection; a card's own Delete
    // leaves the other ticked rows to the reducers.
    const shouldHandOffSelection = confirm.origin === 'selection'
    // Protected entries are skips, so deleteItems only tracks attempted work.
    const deleteItems: BulkDeleteItemResult[] = [
      ...staleDeleteErrors,
      ...orphanErrors,
    ]

    const cleanupReadyOrphanNames = orphanRecords.map(
      (record) => record.skillName,
    )
    const orphanCleanupNames = new Set([
      ...cleanupReadyOrphanNames,
      ...orphanErrors.map((item) => item.skillName),
    ])

    if (deleteTargets.length > 0) {
      const action = await dispatch(deleteSelectedSkills(deleteTargets))
      if (deleteSelectedSkills.fulfilled.match(action)) {
        deleteItems.push(...action.payload.items)
      } else {
        handOffRejectedDeleteSelection(
          deleteTargets.map((target) => target.skillName),
          cleanupReadyOrphanNames,
          shouldHandOffSelection,
        )
        toast.error('Bulk delete failed', {
          description: errorToastDescription(action),
        })
        refreshAllData(dispatch)
        return
      }
    }

    if (orphanRecords.length > 0) {
      const action = await dispatch(clearSelectedOrphanSymlinks(orphanRecords))
      if (clearSelectedOrphanSymlinks.fulfilled.match(action)) {
        deleteItems.push(...action.payload.items)
      } else {
        const message = errorToastDescription(action)
        if (deleteItems.length === 0) {
          handOffRejectedDeleteSelection(
            [],
            cleanupReadyOrphanNames,
            shouldHandOffSelection,
          )
          toast.error('Bulk delete failed', { description: message })
          refreshAllData(dispatch)
          return
        }
        deleteItems.push(
          ...orphanRecords.map((record): BulkDeleteItemResult => ({
            skillName: record.skillName,
            outcome: 'error',
            error: { message },
          })),
        )
      }
    }

    if (deleteItems.length === 0) return
    const tombstoneIds = deleteItems
      .filter(
        (item): item is Extract<BulkDeleteItemResult, { outcome: 'deleted' }> =>
          item.outcome === 'deleted',
      )
      .map((item) => item.tombstoneId)
    const { rescanRequiredNames } = reconcileDeleteSelection(
      deleteItems,
      orphanCleanupNames,
      shouldHandOffSelection,
    )
    refreshAllData(dispatch)
    const summary = appendDeleteRescanSummary(
      formatCascadeSummary({ items: deleteItems }),
      staleDeleteErrors.length,
      rescanRequiredNames.length,
    )

    if (tombstoneIds.length === 0) {
      const anySuccess = deleteItems.some(
        (item) =>
          item.outcome === 'deleted' || item.outcome === 'orphan-cleared',
      )
      if (anySuccess) toast.success(summary)
      else toast.error('Bulk delete failed', { description: summary })
      return
    }

    const deletedNames = deleteItems
      .filter((item) => item.outcome === 'deleted')
      .map((item) => item.skillName)
    const expiresAt: IsoTimestamp = toIsoTimestamp(
      new Date(Date.now() + UNDO_WINDOW_MS).toISOString(),
    )
    const toastId: ToastId = `bulk-delete-${Date.now()}`
    const handleToastDismissed = (): void => {
      dispatch(clearUndoToastIfCurrent(toastId))
    }
    toast(
      <UndoToast
        skillNames={deletedNames}
        tombstoneIds={tombstoneIds}
        expiresAt={expiresAt}
        summary={summary}
        onUndo={handleUndoDelete}
        toastId={toastId}
      />,

      {
        id: toastId,
        duration: UNDO_WINDOW_MS,
        closeButton: true,
        onDismiss: handleToastDismissed,
        onAutoClose: handleToastDismissed,
      },
    )
    dispatch(
      setUndoToast({
        id: toastId,
        kind: 'delete',
        skillNames: deletedNames,
        tombstoneIds,
        expiresAt,
        summary,
      }),
    )
  }
}

interface BulkConfirmActions {
  handleConfirmBulk: () => Promise<void>
  handleCancelBulkConfirm: () => void
}

/**
 * Wires the active bulk confirmation snapshot to delete/unlink executors.
 * @param bulkConfirm - Pending dialog payload from Redux, or null when closed.
 * @returns Confirm and cancel callbacks consumed by BulkConfirmDialog.
 * @example
 * const { handleConfirmBulk } = useBulkConfirmActions(bulkConfirm)
 */
function useBulkConfirmActions(
  bulkConfirm: BulkConfirmState | null,
): BulkConfirmActions {
  const dispatch = useAppDispatch()
  const handleUndoDelete = useUndoDeleteHandler()
  const { handOffRejectedDeleteSelection, reconcileDeleteSelection } =
    useDeleteSelectionHandoff()
  const confirmBulkUnlink = useConfirmBulkUnlink()
  const confirmBulkDelete = useConfirmBulkDelete({
    handleUndoDelete,
    reconcileDeleteSelection,
    handOffRejectedDeleteSelection,
  })

  const handleConfirmBulk = async (): Promise<void> => {
    /* v8 ignore next -- the Confirm button only mounts while bulkConfirm is set. */
    if (!bulkConfirm) return
    const confirm = bulkConfirm
    dispatch(clearBulkConfirm())
    if (confirm.kind === 'unlink') {
      await confirmBulkUnlink(confirm)
      return
    }
    await confirmBulkDelete(confirm)
  }

  const handleCancelBulkConfirm = (): void => {
    dispatch(clearBulkConfirm())
  }

  return { handleConfirmBulk, handleCancelBulkConfirm }
}

interface MainContentEventHandlerOptions {
  repoFacetOptions: RepoFacetOption[]
}

interface MainContentEventHandlers {
  handleClearFilter: () => void
  handleClearSourceFilter: () => void
  handleTabChange: (value: ActiveTab) => void
  handleSkillTypeFilterChange: (value: SkillTypeFilter) => void
  handleToggleSource: (source: RepositoryId) => void
  handleSelectShowAllRepos: (event: Event) => void
  handleSelectAllRepos: (event: Event) => void
  excludedSkillTypeToggleHandlers: ExcludedSkillTypeToggleHandlers
  handleKeepDropdownOpen: (event: Event) => void
  handleSelectClearExcludedSkillTypeFilters: (event: Event) => void
  handleCopyAction: () => void
}

/**
 * Builds stable event callbacks for MainContent toolbar, tab, and copy controls.
 * @param options - Source facet rows for the repo menu's select-all behavior.
 * @returns Event handlers that dispatch UI slice actions for MainContent children.
 * @example
 * const handlers = useMainContentEventHandlers({ repoFacetOptions: [] })
 */
function useMainContentEventHandlers({
  repoFacetOptions,
}: MainContentEventHandlerOptions): MainContentEventHandlers {
  const dispatch = useAppDispatch()

  const handleClearFilter = (): void => {
    dispatch(selectAgent(null))
  }

  const handleClearSourceFilter = (): void => {
    dispatch(clearSelectedSources())
  }

  const handleTabChange = (value: ActiveTab): void => {
    dispatch(setActiveTab(value))
    dispatch(setPreviewSkill(null))
  }

  const handleSkillTypeFilterChange = (value: SkillTypeFilter): void => {
    dispatch(setSkillTypeFilter(value))
  }

  const handleToggleSource = (source: RepositoryId): void => {
    dispatch(toggleSource(source))
  }

  const handleSelectShowAllRepos = (event: Event): void => {
    event.preventDefault()
    dispatch(clearSelectedSources())
  }

  const handleSelectAllRepos = (event: Event): void => {
    event.preventDefault()
    dispatch(
      setSelectedSources(repoFacetOptions.map((option) => option.source)),
    )
  }

  const handleToggleExcludedSkillTypeFilter = (
    value: ExcludableSkillTypeFilter,
  ): void => {
    dispatch(toggleExcludedSkillTypeFilter(value))
  }

  const excludedSkillTypeToggleHandlers = {
    symlinked: (): void => {
      handleToggleExcludedSkillTypeFilter('symlinked')
    },
    local: (): void => {
      handleToggleExcludedSkillTypeFilter('local')
    },
    gstack: (): void => {
      handleToggleExcludedSkillTypeFilter('gstack')
    },
    orphan: (): void => {
      handleToggleExcludedSkillTypeFilter('orphan')
    },
    unique: (): void => {
      handleToggleExcludedSkillTypeFilter('unique')
    },
  }

  const handleClearExcludedSkillTypeFilters = (): void => {
    dispatch(clearExcludedSkillTypeFilters())
  }

  const handleKeepDropdownOpen = (event: Event): void => {
    event.preventDefault()
  }

  const handleSelectClearExcludedSkillTypeFilters = (event: Event): void => {
    event.preventDefault()
    handleClearExcludedSkillTypeFilters()
  }

  const handleCopyAction = (): void => {
    dispatch(setBulkCopyModalOpen(true))
  }

  return {
    handleClearFilter,
    handleClearSourceFilter,
    handleTabChange,
    handleSkillTypeFilterChange,
    handleToggleSource,
    handleSelectShowAllRepos,
    handleSelectAllRepos,
    excludedSkillTypeToggleHandlers,
    handleKeepDropdownOpen,
    handleSelectClearExcludedSkillTypeFilters,
    handleCopyAction,
  }
}

interface InstalledTabLabelProps {
  count: number
  countText: string
  display: Settings['installedSearchCountDisplay']
}

/**
 * Installed tab label with the optional current visible-count badge.
 * @param props - Count text and placement setting read by MainContent.
 * @returns TabsTrigger for the Installed tab.
 * @example
 * <InstalledTabLabel count={24} countText="24 skills" display="tab" />
 */
const InstalledTabLabel = function InstalledTabLabel({
  count,
  countText,
  display,
}: InstalledTabLabelProps): React.ReactElement {
  const shouldShowCount = display === 'tab'
  const accessibleText = `${countText} visible`

  return (
    <TabsTrigger
      value="installed"
      className="group flex-1 gap-2"
      aria-label={shouldShowCount ? `Installed, ${accessibleText}` : undefined}
    >
      Installed
      {/* react-doctor-disable-next-line react-doctor/rendering-conditional-render -- shouldShowCount is a boolean (display === 'tab'), not a number, so there is no stray-0 leak risk. */}
      {shouldShowCount && (
        <span
          aria-hidden="true"
          className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-[11px] font-semibold tabular-nums text-muted-foreground transition-colors group-data-[state=active]:bg-primary/10 group-data-[state=active]:text-primary"
        >
          {count}
        </span>
      )}
    </TabsTrigger>
  )
}

/**
 * Build bulk-delete targets only for delete confirms so MainContent stays branch-light.
 * @param bulkConfirm - Pending bulk confirm dialog state.
 * @returns Partitioned delete targets, or null for unlink/no dialog.
 * @example
 * getBulkDeleteTargetSummary(confirmState)
 */
function getBulkDeleteTargetSummary(
  bulkConfirm: BulkConfirmState | null,
): PartitionedGlobalDeleteTargets | null {
  if (!bulkConfirm || bulkConfirm.kind !== 'delete') return null
  return {
    deleteTargets: bulkConfirm.deleteTargets,
    orphanRecords: bulkConfirm.orphanRecords,
    staleDeleteErrors: bulkConfirm.staleDeleteErrors,
    orphanErrors: bulkConfirm.orphanErrors,
    protectedErrors: bulkConfirm.protectedErrors,
  }
}

/**
 * Extract the protected-skill count from a nullable bulk-delete summary.
 * Module-scope keeps the `??` branch out of MainContent's complexity budget.
 * @param summary - Partitioned delete targets, or null when no delete is pending.
 * @returns Count of protected skills that will be skipped in this batch.
 * @example
 * getProtectedSkippedCount(null) // => 0
 */
function getProtectedSkippedCount(
  summary: PartitionedGlobalDeleteTargets | null,
): number {
  return summary?.protectedErrors.length ?? 0
}

/**
 * Pick the bulk-confirm dialog's warning-icon tint: red for the irreversible
 * delete, amber for the lighter unlink. Module-scope (taking the whole state,
 * so the call site needs no optional chain) keeps this branch out of
 * MainContent's complexity budget.
 * @param bulkConfirm - Pending bulk confirm dialog state, or null when closed.
 * @returns Tailwind text-color class for the AlertTriangle glyph.
 * @example
 * bulkConfirmIconColorClass({ kind: 'delete', ... }) // => 'text-destructive'
 * bulkConfirmIconColorClass({ kind: 'unlink', ... }) // => 'text-amber-500'
 */
function bulkConfirmIconColorClass(
  bulkConfirm: BulkConfirmState | null,
): string {
  return bulkConfirm?.kind === 'delete' ? 'text-destructive' : 'text-amber-500'
}

/**
 * Disable destructive confirm when every reviewed row is stale and no cleanup can run.
 * @param bulkConfirm - Pending bulk confirm dialog state.
 * @param summary - Partitioned delete targets for the dialog.
 * @returns True when the primary button would be a no-op.
 * @example
 * isBulkDeleteConfirmPrimaryDisabled(confirmState, summary)
 */
function isBulkDeleteConfirmPrimaryDisabled(
  bulkConfirm: BulkConfirmState | null,
  summary: PartitionedGlobalDeleteTargets | null,
): boolean {
  if (bulkConfirm?.kind !== 'delete' || summary === null) return false
  // Disable when nothing can actually be deleted (all protected, all stale, or empty).
  return (
    summary.deleteTargets.length === 0 && summary.orphanRecords.length === 0
  )
}

/**
 * Detects orphan cleanup errors that need a fresh scan, not a direct retry.
 * @param item - Bulk delete item result from source delete or orphan cleanup.
 * @param orphanCleanupNames - Names known to come from orphan cleanup/preflight.
 * @returns True when selecting the row again would repeat the same stale failure.
 * @example
 * isRescanRequiredDeleteError(item, new Set(['abandoned']))
 */
function isRescanRequiredDeleteError(
  item: BulkDeleteItemResult,
  orphanCleanupNames: ReadonlySet<Skill['name']>,
): boolean {
  return (
    item.outcome === 'error' &&
    orphanCleanupNames.has(item.skillName) &&
    (item.error.code === 'ESTALE' ||
      item.error.message.includes('Rescan before cleanup'))
  )
}

/**
 * Appends stale-row guidance to bulk delete summaries when cleanup cannot run yet.
 * @param summary - Existing formatted delete/orphan summary.
 * @param staleDeleteCount - Number of source/local rows needing a fresh scan.
 * @param orphanRescanCount - Number of stale orphan rows excluded from retry.
 * @returns Summary with explicit rescan guidance when needed.
 * @example
 * appendDeleteRescanSummary('Deleted 1 of 3 skills.', 1, 1)
 */
function appendDeleteRescanSummary(
  summary: string,
  staleDeleteCount: number,
  orphanRescanCount: number,
): string {
  const guidance: string[] = []
  if (staleDeleteCount > 0) {
    guidance.push(
      `${staleDeleteCount} selected ${pluralize(staleDeleteCount, 'skill')} ${pluralize(staleDeleteCount, 'needs', 'need')} a rescan before delete.`,
    )
  }
  if (orphanRescanCount > 0) {
    guidance.push(
      `${orphanRescanCount} orphan ${pluralize(orphanRescanCount, 'skill')} ${pluralize(orphanRescanCount, 'needs', 'need')} a rescan before cleanup.`,
    )
  }
  if (guidance.length === 0) return summary
  const suffix = guidance.join(' ')
  return summary.length > 0 ? `${summary} ${suffix}` : suffix
}

/**
 * Main content area (flexible width).
 * Owns the Installed / Marketplace tabs, the Installed list header, and the
 * global keyboard shortcuts that back the bulk-delete flow (Cmd/Ctrl+A, Esc).
 */
export const MainContent = function MainContent(): React.ReactElement {
  const dispatch = useAppDispatch()
  // Subscribe to install progress here (always-mounted host) rather than in
  // SkillsMarketplace — the marketplace tab unmounts when "installed" is
  // active, but bookmark installs fire from the always-visible sidebar.
  useMarketplaceProgress()
  const selectedAgentId = useAppSelector((state) => state.ui.selectedAgentId)
  const skillTypeFilter = useAppSelector((state) => state.ui.skillTypeFilter)
  const { items: agents } = useAppSelector((state) => state.agents)
  const activeTab = useAppSelector((state) => state.ui.activeTab)
  const visibleNames = useAppSelector(selectBulkSelectableVisibleSkillNames)
  const selectedVisibleNames = useAppSelector(selectSelectedVisibleNames)
  const selectedAllNames = useAppSelector(selectSelectedSkillNames)
  const skills = useAppSelector(selectSkillsItems)
  const bulkConfirm = useAppSelector(selectBulkConfirm)
  const isBulkOpBusy = useAppSelector(selectIsBulkOpBusy)
  const sourceFilter = useAppSelector(selectSourceFilterViewModel)
  const repoFacetOptions = useAppSelector(selectRepoFacetOptions)
  const filteredSkillCount = useAppSelector(selectFilteredSkillCount)
  const installedSearchCountDisplay = useAppSelector(
    (state) => state.settings.installedSearchCountDisplay,
  )
  const excludedSkillTypeFilters = useAppSelector(
    selectExcludedSkillTypeFilters,
  )
  const protectedNamesSet = useAppSelector(selectProtectedNamesSet)

  const installedSearchCountText =
    formatInstalledSearchCount(filteredSkillCount)

  const selectedAgent = agents.find((a) => a.id === selectedAgentId)
  const bulkDeleteTargetSummary = getBulkDeleteTargetSummary(bulkConfirm)

  const isBulkConfirmPrimaryDisabled = isBulkDeleteConfirmPrimaryDisabled(
    bulkConfirm,
    bulkDeleteTargetSummary,
  )
  const selectedSkillTypeLabel =
    SKILL_TYPE_FILTER_OPTIONS.find((option) => option.value === skillTypeFilter)
      ?.label ?? 'All'
  const availableExcludeTypes = getAvailableExcludeTypes(skillTypeFilter)
  const skillTypeTriggerLabel =
    excludedSkillTypeFilters.length === 0
      ? selectedSkillTypeLabel
      : `${selectedSkillTypeLabel} · ${excludedSkillTypeFilters.length} excluded`
  useInstalledBulkKeyboardShortcuts({
    activeTab,
    selectedCount: selectedAllNames.length,
    visibleNames,
    isBulkOpBusy,
  })
  const {
    handleClearFilter,
    handleClearSourceFilter,
    handleTabChange,
    handleSkillTypeFilterChange,
    handleToggleSource,
    handleSelectShowAllRepos,
    handleSelectAllRepos,
    excludedSkillTypeToggleHandlers,
    handleKeepDropdownOpen,
    handleSelectClearExcludedSkillTypeFilters,
    handleCopyAction,
  } = useMainContentEventHandlers({ repoFacetOptions })

  // Wire the main-process `skills:deleteProgress` event into Redux. Fires
  // only for batches large enough to warrant a counter (see main handler).
  useInitialEffect(() => {
    const unsubscribe = window.electron.skills.onDeleteProgress((payload) => {
      dispatch(setBulkProgress(payload))
    })
    return unsubscribe
  })

  const handlePrimaryAction = usePrimaryBulkAction({
    selectedVisibleNames,
    selectedAgentId,
    selectedAgentName: selectedAgent?.name ?? null,
    sourceFilter,
    skills,
    protectedNamesSet,
  })
  const { handleConfirmBulk, handleCancelBulkConfirm } =
    useBulkConfirmActions(bulkConfirm)

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="h-full flex flex-col overflow-hidden outline-none"
    >
      <Tabs
        value={activeTab}
        // Radix types `onValueChange` as `(value: string) => void`, so under
        // `strictFunctionTypes` the narrower handler cannot be passed directly.
        // The assertion holds by construction rather than by luck: `Tabs` is
        // controlled, and its only Triggers are `installed` (InstalledTabLabel)
        // and `marketplace` below, so Radix has no other value to echo back.
        onValueChange={(value) => handleTabChange(value as ActiveTab)}
        className="h-full flex flex-col"
      >
        <div className="p-4 border-b border-border">
          <TabsList className="w-full">
            <InstalledTabLabel
              count={filteredSkillCount}
              countText={installedSearchCountText}
              display={installedSearchCountDisplay}
            />

            <TabsTrigger value="marketplace" className="flex-1">
              Marketplace
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent
          value="installed"
          className="flex-1 m-0 data-[state=active]:flex data-[state=active]:flex-col min-h-0 overflow-hidden"
        >
          <InstalledToolbar
            sourceFilter={sourceFilter}
            selectedAgentId={selectedAgentId}
            selectedSkillTypeLabel={selectedSkillTypeLabel}
            skillTypeFilter={skillTypeFilter}
            excludedSkillTypeFilters={excludedSkillTypeFilters}
            availableExcludeTypes={availableExcludeTypes}
            skillTypeTriggerLabel={skillTypeTriggerLabel}
            excludedSkillTypeToggleHandlers={excludedSkillTypeToggleHandlers}
            onSelectShowAllRepos={handleSelectShowAllRepos}
            onSelectAllRepos={handleSelectAllRepos}
            onToggleSource={handleToggleSource}
            onKeepDropdownOpen={handleKeepDropdownOpen}
            onSkillTypeFilterChange={handleSkillTypeFilterChange}
            onSelectClearExcludedSkillTypeFilters={
              handleSelectClearExcludedSkillTypeFilters
            }
          />

          <InstalledFilterPills
            selectedAgent={selectedAgent}
            sourceFilter={sourceFilter}
            onClearAgent={handleClearFilter}
            onClearSourceFilter={handleClearSourceFilter}
            onToggleSource={handleToggleSource}
          />

          {/* The header sits outside the list's scroller, so it never scrolls away. */}
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col pt-3 pb-4 pl-4 pr-[5px]">
            <InstalledListHeader
              onPrimaryAction={handlePrimaryAction}
              onCopyAction={handleCopyAction}
              agentDisplayName={selectedAgent?.name}
            />
            <div className="flex-1 min-h-0 pt-3">
              <SkillsList />
            </div>
          </div>
        </TabsContent>

        <TabsContent
          value="marketplace"
          className="flex-1 m-0 data-[state=active]:flex data-[state=active]:flex-col min-h-0 overflow-hidden"
        >
          <SkillsMarketplace />
        </TabsContent>
      </Tabs>

      {/*
         Shared install dialog — mounted here (always-rendered sibling of the
         tabs) so BOTH marketplace rows and sidebar bookmarks open the exact
         same agent-target picker. Redux-driven via marketplace.selectedSkill.
        */}
      <InstallModal />
      <UnlinkDialog />
      <AddSymlinkModal />
      <CopyToAgentsModal />
      <BulkCopyToAgentsModal />
      <SyncConfirmDialog />
      <SyncConflictDialog />
      <SyncResultDialog />
      <CleanupAgentDialog />
      <SymlinkCleanupDialog />
      <LockPruneDialog />

      {/*
         Bulk delete / unlink confirmation. Copy is driven by
         the kind flag so the dispatch site stays a single handler.
        */}
      <BulkConfirmDialog
        bulkConfirm={bulkConfirm}
        bulkDeleteTargetSummary={bulkDeleteTargetSummary}
        isPrimaryDisabled={isBulkConfirmPrimaryDisabled}
        onCancel={handleCancelBulkConfirm}
        onConfirm={handleConfirmBulk}
      />
    </main>
  )
}

interface InstalledToolbarProps {
  sourceFilter: SourceFilterViewModel
  selectedAgentId: Agent['id'] | null
  selectedSkillTypeLabel: string
  skillTypeFilter: SkillTypeFilter
  excludedSkillTypeFilters: ExcludableSkillTypeFilter[]
  availableExcludeTypes: ExcludableSkillTypeFilter[]
  skillTypeTriggerLabel: string
  excludedSkillTypeToggleHandlers: ExcludedSkillTypeToggleHandlers
  onSelectShowAllRepos: (event: Event) => void
  onSelectAllRepos: (event: Event) => void
  onToggleSource: (source: RepositoryId) => void
  onKeepDropdownOpen: (event: Event) => void
  onSkillTypeFilterChange: (value: SkillTypeFilter) => void
  onSelectClearExcludedSkillTypeFilters: (event: Event) => void
}

/**
 * Renders the Installed tab controls after MainContent wires their Redux handlers.
 * Sort and the inline count live in {@link InstalledListHeader}, above the list.
 * @param props - Filter state and event handlers from MainContent.
 * @returns Search, source, and (agent view) skill type filter controls.
 * @example
 * <InstalledToolbar sourceFilter={sourceFilter} selectedAgentId={null} {...handlers} />
 */
const InstalledToolbar = function InstalledToolbar({
  sourceFilter,
  selectedAgentId,
  selectedSkillTypeLabel,
  skillTypeFilter,
  excludedSkillTypeFilters,
  availableExcludeTypes,
  skillTypeTriggerLabel,
  excludedSkillTypeToggleHandlers,
  onSelectShowAllRepos,
  onSelectAllRepos,
  onToggleSource,
  onKeepDropdownOpen,
  onSkillTypeFilterChange,
  onSelectClearExcludedSkillTypeFilters,
}: InstalledToolbarProps): React.ReactElement {
  return (
    <div className="p-4 border-b border-border shrink-0 flex flex-wrap items-center gap-2">
      <div className="min-w-64 flex-[1_1_20rem]">
        <SearchBox />
      </div>

      <SourceRepositoryFilterMenu
        sourceFilter={sourceFilter}
        onSelectShowAllRepos={onSelectShowAllRepos}
        onSelectAllRepos={onSelectAllRepos}
        onToggleSource={onToggleSource}
        onKeepDropdownOpen={onKeepDropdownOpen}
      />

      {selectedAgentId ? (
        <SkillTypeFilterMenu
          selectedSkillTypeLabel={selectedSkillTypeLabel}
          skillTypeFilter={skillTypeFilter}
          excludedSkillTypeFilters={excludedSkillTypeFilters}
          availableExcludeTypes={availableExcludeTypes}
          skillTypeTriggerLabel={skillTypeTriggerLabel}
          excludedSkillTypeToggleHandlers={excludedSkillTypeToggleHandlers}
          onSkillTypeFilterChange={onSkillTypeFilterChange}
          onKeepDropdownOpen={onKeepDropdownOpen}
          onSelectClearExcludedSkillTypeFilters={
            onSelectClearExcludedSkillTypeFilters
          }
        />
      ) : null}
    </div>
  )
}

interface SourceRepositoryFilterMenuProps {
  sourceFilter: SourceFilterViewModel
  onSelectShowAllRepos: (event: Event) => void
  onSelectAllRepos: (event: Event) => void
  onToggleSource: (source: RepositoryId) => void
  onKeepDropdownOpen: (event: Event) => void
}

/**
 * Hosts the source repository include-filter menu used by the Installed toolbar.
 * @param props - Source view model plus menu item handlers from MainContent.
 * @returns Dropdown menu for showing all repos, selecting all, or toggling one repo.
 * @example
 * <SourceRepositoryFilterMenu sourceFilter={sourceFilter} onToggleSource={toggleSource} />
 */
const SourceRepositoryFilterMenu = function SourceRepositoryFilterMenu({
  sourceFilter,
  onSelectShowAllRepos,
  onSelectAllRepos,
  onToggleSource,
  onKeepDropdownOpen,
}: SourceRepositoryFilterMenuProps): React.ReactElement {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={sourceFilter.triggerAriaLabel}
          className={cn(
            'shrink-0 gap-1.5 max-w-44',
            sourceFilter.selectedSources.length > 0
              ? 'text-primary'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <GitBranch className="h-4 w-4" />
          <span className="max-w-32 truncate">{sourceFilter.triggerLabel}</span>
          <ChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Source repository</DropdownMenuLabel>
        {sourceFilter.hasNoRepositories ? (
          <DropdownMenuItem disabled>No source repositories</DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuItem
              disabled={sourceFilter.selectedSources.length === 0}
              onSelect={onSelectShowAllRepos}
            >
              Show all repos
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={sourceFilter.isSelectAllDisabled}
              onSelect={onSelectAllRepos}
            >
              Select all repos
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {/* Each repository row consumes the menu handlers here, avoiding a relay-only component. */}
            {sourceFilter.dropdownRows.map((row) => (
              <DropdownMenuCheckboxItem
                key={row.source}
                checked={row.checked}
                onCheckedChange={() => onToggleSource(row.source)}
                onSelect={onKeepDropdownOpen}
                aria-label={`${row.source}, ${row.count} ${pluralize(row.count, 'skill')}`}
                className="gap-2"
              >
                <span className="min-w-0 flex-1 truncate">{row.source}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {row.count}
                </span>
              </DropdownMenuCheckboxItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

interface SkillTypeFilterMenuProps {
  selectedSkillTypeLabel: string
  skillTypeFilter: SkillTypeFilter
  excludedSkillTypeFilters: ExcludableSkillTypeFilter[]
  availableExcludeTypes: ExcludableSkillTypeFilter[]
  skillTypeTriggerLabel: string
  excludedSkillTypeToggleHandlers: ExcludedSkillTypeToggleHandlers
  onSkillTypeFilterChange: (value: SkillTypeFilter) => void
  onKeepDropdownOpen: (event: Event) => void
  onSelectClearExcludedSkillTypeFilters: (event: Event) => void
}

/**
 * Renders the agent-view skill type include/exclude menu for Installed filters.
 * @param props - Active include/exclude filters and callbacks from MainContent.
 * @returns Dropdown menu that controls positive and negative skill type filters.
 * @example
 * <SkillTypeFilterMenu skillTypeFilter="all" excludedSkillTypeFilters={[]} />
 */
const SkillTypeFilterMenu = function SkillTypeFilterMenu({
  selectedSkillTypeLabel,
  skillTypeFilter,
  excludedSkillTypeFilters,
  availableExcludeTypes,
  skillTypeTriggerLabel,
  excludedSkillTypeToggleHandlers,
  onSkillTypeFilterChange,
  onKeepDropdownOpen,
  onSelectClearExcludedSkillTypeFilters,
}: SkillTypeFilterMenuProps): React.ReactElement {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={
            excludedSkillTypeFilters.length === 0
              ? `Skill type filter: ${selectedSkillTypeLabel}`
              : `Skill type filter: ${selectedSkillTypeLabel}, excluding ${excludedSkillTypeFilters.length} types`
          }
          className={cn(
            'shrink-0 gap-1.5 max-w-48',
            skillTypeFilter !== 'all' || excludedSkillTypeFilters.length > 0
              ? 'text-primary'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <span className="max-w-36 truncate">{skillTypeTriggerLabel}</span>
          <ChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>Include</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={skillTypeFilter}
          // Same Radix `(value: string) => void` seam as the tab bar. Sound
          // because every RadioItem below draws its value from
          // {@link SKILL_TYPE_FILTER_OPTIONS}, typed
          // {@link SkillTypeFilterOption}[] -- Radix only echoes an item's own
          // value, so nothing outside the union can arrive here.
          onValueChange={(value) =>
            onSkillTypeFilterChange(value as SkillTypeFilter)
          }
        >
          {SKILL_TYPE_FILTER_OPTIONS.map((option) => (
            <DropdownMenuRadioItem
              key={option.value}
              value={option.value}
              title={option.hint}
              className="gap-2"
            >
              {option.dotClass ? (
                <span className={`h-2 w-2 rounded-full ${option.dotClass}`} />
              ) : (
                <span className="h-2 w-2" />
              )}
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Exclude</DropdownMenuLabel>
        {EXCLUDABLE_SKILL_TYPE_FILTER_OPTIONS.map((option) => {
          const isAvailable = availableExcludeTypes.includes(option.value)
          const unavailableReason = getUnavailableExcludeReason(
            skillTypeFilter,
            option.value,
          )
          return (
            <DropdownMenuCheckboxItem
              key={option.value}
              checked={excludedSkillTypeFilters.includes(option.value)}
              disabled={!isAvailable}
              onCheckedChange={excludedSkillTypeToggleHandlers[option.value]}
              onSelect={onKeepDropdownOpen}
              aria-label={
                unavailableReason
                  ? `${option.label}, unavailable: ${unavailableReason}`
                  : option.label
              }
              className="gap-2"
            >
              {option.dotClass ? (
                <span className={`h-2 w-2 rounded-full ${option.dotClass}`} />
              ) : null}
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {unavailableReason ? (
                <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                  {unavailableReason}
                </span>
              ) : null}
            </DropdownMenuCheckboxItem>
          )
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={excludedSkillTypeFilters.length === 0}
          onSelect={onSelectClearExcludedSkillTypeFilters}
        >
          Clear excludes
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

interface InstalledFilterPillsProps {
  selectedAgent: Agent | undefined
  sourceFilter: SourceFilterViewModel
  onClearAgent: () => void
  onClearSourceFilter: () => void
  onToggleSource: (source: RepositoryId) => void
}

/**
 * Shows active Installed filters below the toolbar after selectors compute state.
 * @param props - Active agent/source filters and clear/toggle callbacks.
 * @returns Filter pills plus hidden-local helper text when repo filters hide locals.
 * @example
 * <InstalledFilterPills selectedAgent={agent} sourceFilter={sourceFilter} />
 */
const InstalledFilterPills = function InstalledFilterPills({
  selectedAgent,
  sourceFilter,
  onClearAgent,
  onClearSourceFilter,
  onToggleSource,
}: InstalledFilterPillsProps): React.ReactElement {
  return (
    <>
      {selectedAgent ? (
        <FilterPill
          label={
            <>
              for <strong className="text-primary">{selectedAgent.name}</strong>
            </>
          }
          onClear={onClearAgent}
          testId="agent-filter-pill"
        />
      ) : null}

      {sourceFilter.selectedSources.length > SOURCE_FILTER_MAX_VISIBLE_REPOS ? (
        <FilterPill
          label={
            <>
              from{' '}
              <strong className="text-primary">
                {sourceFilter.selectedSources.length} repos
              </strong>
            </>
          }
          onClear={onClearSourceFilter}
          testId="source-filter-pill"
        />
      ) : (
        sourceFilter.selectedSources.map((source) => (
          <SourceFilterPill
            key={source}
            source={source}
            onClear={onToggleSource}
          />
        ))
      )}

      {sourceFilter.localHiddenCount > 0 ? (
        <p className="px-4 py-2 border-b border-border text-xs text-muted-foreground shrink-0">
          {sourceFilter.localHiddenCount}{' '}
          {pluralize(sourceFilter.localHiddenCount, 'local skill')} hidden
        </p>
      ) : null}
    </>
  )
}

interface BulkConfirmDialogProps {
  bulkConfirm: BulkConfirmState | null
  bulkDeleteTargetSummary: PartitionedGlobalDeleteTargets | null
  isPrimaryDisabled: boolean
  onCancel: () => void
  onConfirm: () => void
}

/**
 * Presents reviewed bulk delete/unlink confirmation after MainContent stages it.
 * @param props - Confirm snapshot, derived delete summary, and dialog callbacks.
 * @returns Radix dialog matching the active bulk operation kind.
 * @example
 * <BulkConfirmDialog bulkConfirm={confirm} bulkDeleteTargetSummary={summary} />
 */
const BulkConfirmDialog = function BulkConfirmDialog({
  bulkConfirm,
  bulkDeleteTargetSummary,
  isPrimaryDisabled,
  onCancel,
  onConfirm,
}: BulkConfirmDialogProps): React.ReactElement {
  const skillCount = bulkConfirm?.skillNames.length ?? 0

  return (
    <Dialog open={bulkConfirm !== null} onOpenChange={onCancel}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle
              className={`h-5 w-5 ${bulkConfirmIconColorClass(bulkConfirm)}`}
            />

            <DialogTitle>
              {bulkConfirm?.kind === 'delete'
                ? `Delete ${skillCount} ${pluralize(skillCount, 'skill')}?`
                : `Unlink ${skillCount} ${pluralize(skillCount, 'skill')} from ${bulkConfirm?.agentName ?? 'agent'}?`}
            </DialogTitle>
          </div>
          <DialogDescription>
            {bulkConfirm?.kind === 'delete'
              ? renderBulkDeleteDescription({
                  totalCount: skillCount,
                  trashCount:
                    bulkDeleteTargetSummary?.deleteTargets.length ?? skillCount,
                  orphanCleanupCount:
                    bulkDeleteTargetSummary?.orphanRecords.length ?? 0,
                  staleDeleteCount:
                    bulkDeleteTargetSummary?.staleDeleteErrors.length ?? 0,
                  orphanRescanCount:
                    bulkDeleteTargetSummary?.orphanErrors.length ?? 0,
                  protectedCount: getProtectedSkippedCount(
                    bulkDeleteTargetSummary,
                  ),
                  sourceSummary: bulkConfirm.sourceSummary,
                })
              : `This removes the symlinks in ${bulkConfirm?.agentName ?? 'this agent'}. The underlying skill files stay in your source directory.`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant={bulkConfirm?.kind === 'delete' ? 'destructive' : 'default'}
            disabled={isPrimaryDisabled}
            onClick={onConfirm}
          >
            {bulkConfirm?.kind === 'delete' ? 'Delete' : 'Unlink'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * One clearable "from <repo>" pill (shown when ≤ SOURCE_FILTER_MAX_VISIBLE_REPOS
 * repos selected) — hoists the clear handler so `FilterPill` doesn't receive a
 * fresh inline arrow each render.
 * @param source - The repository id this pill represents and clears.
 * @param onClear - Removes `source` from the include filter (toggle off).
 * @returns A FilterPill labelled `from <source>` wired to single-repo clear.
 * @example
 * <SourceFilterPill source={source} onClear={handleToggleSource} />
 */
const SourceFilterPill = function SourceFilterPill({
  source,
  onClear,
}: {
  source: RepositoryId
  onClear: (source: RepositoryId) => void
}): React.ReactElement {
  // Stable clear — toggles this exact repo off the include filter.
  const handleClear = (): void => {
    onClear(source)
  }

  return (
    <FilterPill
      label={
        <>
          from <strong className="text-primary">{source}</strong>
        </>
      }
      onClear={handleClear}
      testId="source-filter-pill"
    />
  )
}
