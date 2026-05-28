import {
  ArrowDownAZ,
  ArrowUpAZ,
  CheckSquare,
  ChevronDown,
  ExternalLink,
  GitBranch,
  X,
} from 'lucide-react'
import React, { useCallback, useMemo, useRef } from 'react'
import { toast } from 'sonner'

import { SymlinkCleanupDialog } from '@/renderer/src/components/dashboard/SymlinkCleanupDialog'
import { SkillsMarketplace } from '@/renderer/src/components/marketplace'
import { CleanupAgentDialog } from '@/renderer/src/components/sidebar/CleanupAgentDialog'
import { SyncConfirmDialog } from '@/renderer/src/components/sidebar/SyncConfirmDialog'
import { SyncConflictDialog } from '@/renderer/src/components/sidebar/SyncConflictDialog'
import { SyncResultDialog } from '@/renderer/src/components/sidebar/SyncResultDialog'
import { AddSymlinkModal } from '@/renderer/src/components/skills/AddSymlinkModal'
import { renderBulkDeleteDescription } from '@/renderer/src/components/skills/bulkDeleteCopy'
import {
  formatCascadeSummary,
  formatUnlinkSummary,
} from '@/renderer/src/components/skills/bulkDeleteHelpers'
import { CopyToAgentsModal } from '@/renderer/src/components/skills/CopyToAgentsModal'
import {
  buildAgentUnlinkTargets,
  type PartitionedGlobalDeleteTargets,
  partitionGlobalDeleteTargets,
} from '@/renderer/src/components/skills/reviewedDestructiveTargets'
import { SearchBox } from '@/renderer/src/components/skills/SearchBox'
import { SelectionToolbar } from '@/renderer/src/components/skills/SelectionToolbar'
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
import { FilterPill } from '@/renderer/src/components/ui/FilterPill'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/renderer/src/components/ui/tabs'
import { useCycleEffect } from '@/renderer/src/hooks/useCycleEffect'
import { useInitialEffect } from '@/renderer/src/hooks/useInitialEffect'
import { useRenderEffect } from '@/renderer/src/hooks/useRenderEffect'
import { cn } from '@/renderer/src/lib/utils'
import { useAppDispatch, useAppSelector } from '@/renderer/src/redux/hooks'
import {
  selectBulkSelectableVisibleSkillNames,
  selectRepoFacetOptions,
  selectSelectedVisibleNames,
  selectSourceFilterViewModel,
} from '@/renderer/src/redux/selectors'
import type { SourceFilterRow } from '@/renderer/src/redux/selectors'
import { setPreviewSkill } from '@/renderer/src/redux/slices/marketplaceSlice'
import {
  clearSelection,
  clearSelectedOrphanSymlinks,
  deleteSelectedSkills,
  selectAll,
  selectSelectedSkillNames,
  selectSkillsItems,
  setBulkProgress,
  undoLastBulkDelete,
  unlinkSelectedFromAgent,
} from '@/renderer/src/redux/slices/skillsSlice'
import {
  clearBulkConfirm,
  clearExcludedSkillTypeFilters,
  clearSelectedSources,
  clearUndoToast,
  enterBulkSelectMode,
  exitBulkSelectMode,
  getAvailableExcludeTypes,
  selectAgent,
  selectBulkConfirm,
  selectBulkSelectMode,
  selectExcludedSkillTypeFilters,
  setActiveTab,
  setBulkConfirm,
  setSelectedSources,
  setSkillTypeFilter,
  setUndoToast,
  toggleExcludedSkillTypeFilter,
  toggleSortOrder,
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
import { isEditableTarget } from '@/renderer/src/utils/isEditableTarget'
import { pluralize } from '@/renderer/src/utils/pluralize'
import {
  SOURCE_FILTER_MAX_VISIBLE_REPOS,
  UNDO_WINDOW_MS,
} from '@/shared/constants'
import { FEATURE_FLAGS } from '@/shared/featureFlags'
import type {
  BulkDeleteItemResult,
  IsoTimestamp,
  RepositoryId,
  Skill,
  ToastId,
  TombstoneId,
} from '@/shared/types'

const SKILL_TYPE_FILTER_OPTIONS: {
  value: SkillTypeFilter
  label: string
  /** Colored dot class to match skill type visual indicators */
  dotClass?: string
}[] = [
  { value: 'all', label: 'All' },
  { value: 'symlinked', label: 'Symlinked', dotClass: 'bg-success' },
  { value: 'local', label: 'Local', dotClass: 'bg-emerald-400' },
  { value: 'gstack', label: 'G-Stack', dotClass: 'bg-gstack' },
  { value: 'orphan', label: 'Orphan', dotClass: 'bg-destructive' },
]

const EXCLUDABLE_SKILL_TYPE_FILTER_OPTIONS = SKILL_TYPE_FILTER_OPTIONS.filter(
  (
    option,
  ): option is {
    value: ExcludableSkillTypeFilter
    label: string
    dotClass?: string
  } => option.value !== 'all',
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

const SKILLS_SH_URL = 'https://skills.sh'

/**
 * Build bulk-delete targets only for delete confirms so MainContent stays branch-light.
 * @param bulkConfirm - Pending bulk confirm dialog state.
 * @param skills - Current skill inventory used to resolve orphan rows.
 * @returns Partitioned delete targets, or null for unlink/no dialog.
 * @example
 * getBulkDeleteTargetSummary(confirmState, skills)
 */
function getBulkDeleteTargetSummary(
  bulkConfirm: BulkConfirmState | null,
  skills: readonly Skill[],
): PartitionedGlobalDeleteTargets | null {
  if (!bulkConfirm || bulkConfirm.kind !== 'delete') return null
  if (
    bulkConfirm.deleteTargets ||
    bulkConfirm.orphanRecords ||
    bulkConfirm.orphanErrors
  ) {
    return {
      deleteTargets: bulkConfirm.deleteTargets ?? [],
      orphanRecords: bulkConfirm.orphanRecords ?? [],
      orphanErrors: bulkConfirm.orphanErrors ?? [],
    }
  }
  return partitionGlobalDeleteTargets(skills, bulkConfirm.skillNames)
}

/**
 * Disable destructive confirm when selected orphan rows require rescan and no cleanup can run.
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
 * Appends stale-orphan guidance to bulk delete summaries when cleanup cannot run yet.
 * @param summary - Existing formatted delete/orphan summary.
 * @param rescanRequiredCount - Number of stale orphan rows excluded from retry.
 * @returns Summary with explicit rescan guidance when needed.
 * @example
 * appendRescanRequiredSummary('Deleted 1 of 2 skills.', 1)
 */
function appendRescanRequiredSummary(
  summary: string,
  rescanRequiredCount: number,
): string {
  if (rescanRequiredCount === 0) return summary
  const guidance = `${rescanRequiredCount} orphan ${pluralize(rescanRequiredCount, 'skill')} ${pluralize(rescanRequiredCount, 'needs', 'need')} a rescan before cleanup.`
  return summary.length > 0 ? `${summary} ${guidance}` : guidance
}

/**
 * Main content area (flexible width).
 * Owns the Installed / Marketplace tabs, the bulk selection toolbar, and the
 * global keyboard shortcuts that back the bulk-delete flow (Cmd/Ctrl+A, Esc).
 */
export const MainContent = React.memo(
  function MainContent(): React.ReactElement {
    const dispatch = useAppDispatch()
    const selectedAgentId = useAppSelector((state) => state.ui.selectedAgentId)
    const sortOrder = useAppSelector((state) => state.ui.sortOrder)
    const skillTypeFilter = useAppSelector((state) => state.ui.skillTypeFilter)
    const { items: agents } = useAppSelector((state) => state.agents)
    const activeTab = useAppSelector((state) => state.ui.activeTab)
    const visibleNames = useAppSelector(selectBulkSelectableVisibleSkillNames)
    const selectedVisibleNames = useAppSelector(selectSelectedVisibleNames)
    const selectedAllNames = useAppSelector(selectSelectedSkillNames)
    const skills = useAppSelector(selectSkillsItems)
    const bulkConfirm = useAppSelector(selectBulkConfirm)
    const bulkSelectMode = useAppSelector(selectBulkSelectMode)
    const sourceFilter = useAppSelector(selectSourceFilterViewModel)
    const repoFacetOptions = useAppSelector(selectRepoFacetOptions)
    const excludedSkillTypeFilters = useAppSelector(
      selectExcludedSkillTypeFilters,
    )

    const selectedAgent = agents.find((a) => a.id === selectedAgentId)
    const bulkDeleteTargetSummary = useMemo(() => {
      return getBulkDeleteTargetSummary(bulkConfirm, skills)
    }, [bulkConfirm, skills])
    const isBulkConfirmPrimaryDisabled = isBulkDeleteConfirmPrimaryDisabled(
      bulkConfirm,
      bulkDeleteTargetSummary,
    )
    const selectedSkillTypeLabel =
      SKILL_TYPE_FILTER_OPTIONS.find(
        (option) => option.value === skillTypeFilter,
      )?.label ?? 'All'
    const availableExcludeTypes = getAvailableExcludeTypes(skillTypeFilter)
    const skillTypeTriggerLabel =
      excludedSkillTypeFilters.length === 0
        ? selectedSkillTypeLabel
        : `${selectedSkillTypeLabel} · ${excludedSkillTypeFilters.length} excluded`
    const handleClearFilter = useCallback((): void => {
      dispatch(selectAgent(null))
    }, [dispatch])

    const handleClearSourceFilter = useCallback((): void => {
      dispatch(clearSelectedSources())
    }, [dispatch])

    const handleTabChange = useCallback(
      (value: string): void => {
        dispatch(setActiveTab(value as ActiveTab))
        dispatch(setPreviewSkill(null))
      },
      [dispatch],
    )

    const handleOpenMarketplace = (): void => {
      window.electron.shell.openExternal(SKILLS_SH_URL)
    }

    // Stash the frequently-churning inputs in refs so the keydown listener
    // effect below only re-subscribes when the tab itself changes. Without
    // this, every skills-slice update (visibleNames is a fresh array
    // reference per render) tears down and re-attaches the `document`
    // listener — functionally correct but wasteful during active use.
    const visibleNamesRef = useRef(visibleNames)
    const selectedCountRef = useRef(selectedAllNames.length)
    const bulkSelectModeRef = useRef(bulkSelectMode)
    useRenderEffect(() => {
      visibleNamesRef.current = visibleNames
    }, [visibleNames])
    useRenderEffect(() => {
      selectedCountRef.current = selectedAllNames.length
    }, [selectedAllNames.length])
    useRenderEffect(() => {
      bulkSelectModeRef.current = bulkSelectMode
    }, [bulkSelectMode])

    // Scoped to the Installed tab — Marketplace has its own selection context.
    // Shortcuts are further gated on `bulkSelectMode` so a user outside of
    // selection mode doesn't silently accumulate ticks they can't see (the
    // "hidden selection" anti-pattern).
    useCycleEffect(() => {
      if (activeTab !== 'installed') return
      const handleKey = (event: KeyboardEvent): void => {
        if (isEditableTarget(document.activeElement)) return
        if (!bulkSelectModeRef.current) return

        // Cmd/Ctrl+A: select all visible
        if (
          (event.metaKey || event.ctrlKey) &&
          event.key.toLowerCase() === 'a'
        ) {
          event.preventDefault()
          dispatch(selectAll(visibleNamesRef.current))
          return
        }
        // Esc is 2-step: first press clears accumulated selection (protects
        // against fat-finger mode exit mid-batch); a second Esc with empty
        // selection then exits mode. Matches Gmail's multi-select pattern.
        if (event.key === 'Escape') {
          event.preventDefault()
          if (selectedCountRef.current > 0) {
            dispatch(clearSelection())
          } else {
            dispatch(exitBulkSelectMode())
          }
          return
        }
      }
      document.addEventListener('keydown', handleKey)
      return () => {
        document.removeEventListener('keydown', handleKey)
      }
    }, [dispatch, activeTab])

    // Wire the main-process `skills:deleteProgress` event into Redux. Fires
    // only for batches large enough to warrant a counter (see main handler).
    useInitialEffect(() => {
      const unsubscribe = window.electron.skills.onDeleteProgress((payload) => {
        dispatch(setBulkProgress(payload))
      })
      return unsubscribe
    })

    const handleToggleSortOrder = useCallback((): void => {
      dispatch(toggleSortOrder())
    }, [dispatch])

    const handleToggleBulkSelectMode = useCallback((): void => {
      if (bulkSelectMode) {
        // Order matters: clear selection first so no subscriber can observe
        // `mode=false` with stale `selectedSkillNames` between dispatches.
        dispatch(clearSelection())
        dispatch(exitBulkSelectMode())
        return
      }
      dispatch(enterBulkSelectMode())
    }, [bulkSelectMode, dispatch])

    const handleSkillTypeFilterChange = useCallback(
      (value: string): void => {
        dispatch(setSkillTypeFilter(value as SkillTypeFilter))
      },
      [dispatch],
    )

    /**
     * Tick/untick one repo in the source include-filter. Wired to each
     * checkbox row in the repo facet dropdown; the menu stays open (via
     * `handleKeepDropdownOpen`) so a multi-repo selection builds in one pass.
     */
    const handleToggleSource = useCallback(
      (source: RepositoryId): void => {
        dispatch(toggleSource(source))
      },
      [dispatch],
    )

    // "Show all repos" header item → clear the include-filter (show everything).
    const handleSelectShowAllRepos = useCallback(
      (event: Event): void => {
        event.preventDefault()
        dispatch(clearSelectedSources())
      },
      [dispatch],
    )

    // "Select all repos" header item → tick every repo in the current facet.
    const handleSelectAllRepos = useCallback(
      (event: Event): void => {
        event.preventDefault()
        dispatch(
          setSelectedSources(repoFacetOptions.map((option) => option.source)),
        )
      },
      [dispatch, repoFacetOptions],
    )

    const handleToggleExcludedSkillTypeFilter = useCallback(
      (value: ExcludableSkillTypeFilter): void => {
        dispatch(toggleExcludedSkillTypeFilter(value))
      },
      [dispatch],
    )
    const excludedSkillTypeToggleHandlers = useMemo(
      () => ({
        symlinked: () => {
          handleToggleExcludedSkillTypeFilter('symlinked')
        },
        local: () => {
          handleToggleExcludedSkillTypeFilter('local')
        },
        gstack: () => {
          handleToggleExcludedSkillTypeFilter('gstack')
        },
        orphan: () => {
          handleToggleExcludedSkillTypeFilter('orphan')
        },
      }),
      [handleToggleExcludedSkillTypeFilter],
    )

    const handleClearExcludedSkillTypeFilters = useCallback((): void => {
      dispatch(clearExcludedSkillTypeFilters())
    }, [dispatch])
    const handleKeepDropdownOpen = useCallback((event: Event): void => {
      event.preventDefault()
    }, [])
    const handleSelectClearExcludedSkillTypeFilters = useCallback(
      (event: Event): void => {
        event.preventDefault()
        handleClearExcludedSkillTypeFilters()
      },
      [handleClearExcludedSkillTypeFilters],
    )

    /**
     * Handle the restore callback from inside the UndoToast. Dispatches the
     * serial restore thunk, then fires a sonner toast with the outcome summary.
     */
    const handleUndoDelete = useCallback(
      async (tombstoneIds: TombstoneId[]): Promise<void> => {
        const action = await dispatch(undoLastBulkDelete(tombstoneIds))
        if (undoLastBulkDelete.fulfilled.match(action)) {
          const restoredCount = action.payload.filter(
            (o) => o.result.outcome === 'restored',
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
      },
      [dispatch],
    )

    /**
     * Open the bulk confirm dialog with the pending payload. The actual thunk
     * dispatch happens in `handleConfirmBulk` below — that split lets us keep
     * the prompt in a Radix `<Dialog>` (matches SyncConfirmDialog and satisfies
     * the "no window.confirm in renderer" review rule) without leaking the
     * thunk wiring into Redux state.
     */
    const handlePrimaryAction = useCallback((): void => {
      if (selectedVisibleNames.length === 0) return
      // Snapshot the active repo-filter scope so the confirm dialog can state
      // what the user is acting within, even if they change the filter before
      // clicking confirm. Null when no repo is in scope and nothing is hidden
      // — keeps the dialog copy unchanged in the common (unfiltered) case.
      const sourceSummary =
        sourceFilter.validRepoIds.length > 0 ||
        sourceFilter.localHiddenCount > 0
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
          flashFailedRows(staleNames)
          toast.error('Bulk unlink failed', {
            description: 'Selection changed. Rescan before unlinking.',
          })
          refreshAllData(dispatch)
          return
        }
        dispatch(
          setBulkConfirm({
            kind: 'unlink',
            skillNames: targets.map((target) => target.skillName),
            agentId: selectedAgentId,
            agentName: selectedAgent?.name ?? null,
            sourceSummary,
            unlinkTargets: targets,
          }),
        )
        return
      }
      const { deleteTargets, orphanRecords, orphanErrors } =
        partitionGlobalDeleteTargets(skills, selectedVisibleNames)
      dispatch(
        setBulkConfirm({
          kind: 'delete',
          skillNames: selectedVisibleNames,
          agentId: null,
          agentName: null,
          sourceSummary,
          deleteTargets,
          orphanRecords,
          orphanErrors,
        }),
      )
    }, [
      dispatch,
      selectedAgentId,
      selectedAgent?.name,
      selectedVisibleNames,
      skills,
      sourceFilter.validRepoIds,
      sourceFilter.localHiddenCount,
    ])

    /**
     * Reselect unresolved rows when source deletion rejects before orphan cleanup can run.
     * @param deleteNames - Source-backed names whose delete thunk rejected.
     * @param cleanupReadyOrphanNames - Orphan rows whose cleanup IPC never ran.
     * @returns void after bulk selection is restored for retry.
     * @example
     * restoreUnresolvedMixedDeleteSelection(['task'], ['orphan'])
     */
    const restoreUnresolvedMixedDeleteSelection = useCallback(
      (
        deleteNames: readonly Skill['name'][],
        cleanupReadyOrphanNames: readonly Skill['name'][],
      ): void => {
        const unresolvedNames = Array.from(
          new Set([...deleteNames, ...cleanupReadyOrphanNames]),
        )
        flashFailedRows(unresolvedNames)
        if (unresolvedNames.length === 0) return
        dispatch(enterBulkSelectMode())
        dispatch(selectAll(unresolvedNames))
      },
      [dispatch],
    )

    /**
     * Keeps retryable failures selected while dropping rescan-required orphan failures.
     * @param deleteItems - Combined source-delete and orphan-cleanup results.
     * @param hasOrphanCleanupRows - Whether this batch needed manual orphan reconciliation.
     * @param orphanCleanupNames - Names that belong to reviewed orphan cleanup rows.
     * @returns Rescan-required orphan names for toast summary copy.
     * @example
     * reconcileMixedDeleteSelection([orphanError], true, new Set(['orphan']))
     */
    const reconcileMixedDeleteSelection = useCallback(
      (
        deleteItems: readonly BulkDeleteItemResult[],
        hasOrphanCleanupRows: boolean,
        orphanCleanupNames: ReadonlySet<Skill['name']>,
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
        if (!hasOrphanCleanupRows) return { rescanRequiredNames }
        // Mixed source+orphan cleanup needs combined reconciliation after all
        // paths settle: retryable rows stay selected, all-success batches
        // leave bulk mode like source-delete success.
        if (retryableFailedNames.length > 0) {
          dispatch(enterBulkSelectMode())
          dispatch(selectAll(retryableFailedNames))
        } else {
          dispatch(clearSelection())
          dispatch(exitBulkSelectMode())
        }
        return { rescanRequiredNames }
      },
      [dispatch],
    )

    /**
     * Execute reviewed agent-view unlink confirmation after the dialog closes.
     * @param confirm - Snapshot captured when the confirmation dialog opened.
     * @returns void after thunk, toast, and refresh side effects finish.
     * @example await confirmBulkUnlink(bulkConfirm)
     */
    const confirmBulkUnlink = useCallback(
      async (confirm: BulkConfirmState): Promise<void> => {
        const { skillNames, agentId, agentName } = confirm
        if (!agentId) return
        const { targets: unlinkTargets, staleNames } = confirm.unlinkTargets
          ? { targets: confirm.unlinkTargets, staleNames: [] }
          : buildAgentUnlinkTargets(skills, skillNames, agentId)
        if (staleNames.length > 0) {
          flashFailedRows(staleNames)
          toast.error('Bulk unlink failed', {
            description: 'Selection changed. Rescan before unlinking.',
          })
          refreshAllData(dispatch)
          return
        }

        const action = await dispatch(
          unlinkSelectedFromAgent({ agentId, selectedNames: unlinkTargets }),
        )
        if (unlinkSelectedFromAgent.fulfilled.match(action)) {
          const failedNames = action.payload.items
            .filter((item) => item.outcome === 'error')
            .map((item) => item.skillName)
          const unlinkedCount = action.payload.items.length - failedNames.length
          flashFailedRows(failedNames)
          if (unlinkedCount === 0) {
            toast.error('Bulk unlink failed', {
              description: formatUnlinkSummary(
                action.payload,
                agentName ?? 'agent',
              ),
            })
          } else {
            toast.success(
              formatUnlinkSummary(action.payload, agentName ?? 'agent'),
            )
          }
        } else {
          toast.error('Bulk unlink failed', {
            description: errorToastDescription(action),
          })
        }
        refreshAllData(dispatch)
      },
      [dispatch, skills],
    )

    /**
     * Execute reviewed global delete confirmation, including orphan cleanup rows.
     * @param confirm - Snapshot captured when the confirmation dialog opened.
     * @returns void after delete/cleanup thunks, toast, undo, and refresh.
     * @example await confirmBulkDelete(bulkConfirm)
     */
    const confirmBulkDelete = useCallback(
      async (confirm: BulkConfirmState): Promise<void> => {
        const { skillNames } = confirm
        const { deleteTargets, orphanRecords, orphanErrors } =
          confirm.deleteTargets || confirm.orphanRecords || confirm.orphanErrors
            ? {
                deleteTargets: confirm.deleteTargets ?? [],
                orphanRecords: confirm.orphanRecords ?? [],
                orphanErrors: confirm.orphanErrors ?? [],
              }
            : partitionGlobalDeleteTargets(skills, skillNames)
        const deleteItems: BulkDeleteItemResult[] = [...orphanErrors]
        const hasOrphanCleanupRows =
          orphanRecords.length > 0 || orphanErrors.length > 0
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
            if (hasOrphanCleanupRows) {
              restoreUnresolvedMixedDeleteSelection(
                deleteTargets.map((target) => target.skillName),
                cleanupReadyOrphanNames,
              )
            }
            toast.error('Bulk delete failed', {
              description: errorToastDescription(action),
            })
            refreshAllData(dispatch)
            return
          }
        }

        if (orphanRecords.length > 0) {
          const action = await dispatch(
            clearSelectedOrphanSymlinks(orphanRecords),
          )
          if (clearSelectedOrphanSymlinks.fulfilled.match(action)) {
            deleteItems.push(...action.payload.items)
          } else {
            const message = errorToastDescription(action)
            if (deleteItems.length === 0) {
              restoreUnresolvedMixedDeleteSelection([], cleanupReadyOrphanNames)
              toast.error('Bulk delete failed', { description: message })
              refreshAllData(dispatch)
              return
            }
            deleteItems.push(
              ...orphanRecords.map(
                (record): BulkDeleteItemResult => ({
                  skillName: record.skillName,
                  outcome: 'error',
                  error: { message },
                }),
              ),
            )
          }
        }

        if (deleteItems.length === 0) return
        const tombstoneIds = deleteItems
          .filter(
            (
              item,
            ): item is Extract<BulkDeleteItemResult, { outcome: 'deleted' }> =>
              item.outcome === 'deleted',
          )
          .map((item) => item.tombstoneId)
        const { rescanRequiredNames } = reconcileMixedDeleteSelection(
          deleteItems,
          hasOrphanCleanupRows,
          orphanCleanupNames,
        )
        refreshAllData(dispatch)
        const summary = appendRescanRequiredSummary(
          formatCascadeSummary({ items: deleteItems }),
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
        const expiresAt: IsoTimestamp = new Date(
          Date.now() + UNDO_WINDOW_MS,
        ).toISOString()
        const handleToastDismissed = (): void => {
          dispatch(clearUndoToast())
        }
        const toastId: ToastId = `bulk-delete-${Date.now()}`
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
      },
      [
        dispatch,
        handleUndoDelete,
        reconcileMixedDeleteSelection,
        restoreUnresolvedMixedDeleteSelection,
        skills,
      ],
    )

    /**
     * Route the active bulk confirmation to the reviewed unlink or delete executor.
     * @returns void after the selected executor completes.
     * @example await handleConfirmBulk()
     */
    const handleConfirmBulk = useCallback(async (): Promise<void> => {
      if (!bulkConfirm) return
      const confirm = bulkConfirm
      dispatch(clearBulkConfirm())
      if (confirm.kind === 'unlink' && confirm.agentId) {
        await confirmBulkUnlink(confirm)
        return
      }
      await confirmBulkDelete(confirm)
    }, [bulkConfirm, confirmBulkDelete, confirmBulkUnlink, dispatch])

    const handleCancelBulkConfirm = useCallback((): void => {
      dispatch(clearBulkConfirm())
    }, [dispatch])

    return (
      <main
        id="main-content"
        tabIndex={-1}
        className="h-full flex flex-col overflow-hidden outline-none"
      >
        <Tabs
          value={activeTab}
          onValueChange={handleTabChange}
          className="h-full flex flex-col"
        >
          <div className="p-4 border-b border-border">
            <TabsList className="w-full">
              <TabsTrigger value="installed" className="flex-1">
                Installed
              </TabsTrigger>
              {FEATURE_FLAGS.ENABLE_MARKETPLACE_UI ? (
                <TabsTrigger value="marketplace" className="flex-1">
                  Marketplace
                </TabsTrigger>
              ) : (
                <button
                  type="button"
                  onClick={handleOpenMarketplace}
                  className="inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 flex-1 gap-1.5 text-muted-foreground hover:text-foreground"
                >
                  Marketplace
                  <ExternalLink className="h-3 w-3" />
                </button>
              )}
            </TabsList>
          </div>

          <TabsContent
            value="installed"
            className="flex-1 m-0 data-[state=active]:flex data-[state=active]:flex-col min-h-0 overflow-hidden"
          >
            <div className="p-4 border-b border-border shrink-0 flex flex-wrap items-center gap-2">
              <div className="min-w-64 flex-[1_1_20rem]">
                <SearchBox />
              </div>

              {/* Sort toggle: A→Z ⟷ Z→A */}
              <Button
                variant="ghost"
                size="icon"
                aria-label={
                  sortOrder === 'asc'
                    ? 'Sorted A to Z, click to reverse'
                    : 'Sorted Z to A, click to reverse'
                }
                onClick={handleToggleSortOrder}
                className="shrink-0 text-muted-foreground hover:text-foreground min-h-11 min-w-11"
              >
                {sortOrder === 'asc' ? (
                  <ArrowDownAZ className="h-4 w-4" />
                ) : (
                  <ArrowUpAZ className="h-4 w-4" />
                )}
              </Button>

              {/* Repo facet: multi-select source include-filter with counts
                  from the current agent/type population, independent of the
                  text query. Empty selection shows all repos (and local
                  skills); ticking repos narrows to those sources. */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={sourceFilter.triggerAriaLabel}
                    className={cn(
                      'shrink-0 gap-1.5 min-h-11 max-w-44',
                      sourceFilter.selectedSources.length > 0
                        ? 'text-primary'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <GitBranch className="h-4 w-4" />
                    <span className="max-w-32 truncate">
                      {sourceFilter.triggerLabel}
                    </span>
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72">
                  <DropdownMenuLabel>Source repository</DropdownMenuLabel>
                  {sourceFilter.hasNoRepositories ? (
                    <DropdownMenuItem disabled>
                      No source repositories
                    </DropdownMenuItem>
                  ) : (
                    <>
                      {/* Bulk shortcuts mirror the multi-select pattern: clear
                          the whole set, or tick every facet repo at once. */}
                      <DropdownMenuItem
                        disabled={sourceFilter.selectedSources.length === 0}
                        onSelect={handleSelectShowAllRepos}
                      >
                        Show all repos
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={sourceFilter.isSelectAllDisabled}
                        onSelect={handleSelectAllRepos}
                      >
                        Select all repos
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {sourceFilter.dropdownRows.map((row) => (
                        <SourceFacetCheckboxRow
                          key={row.source}
                          row={row}
                          onToggle={handleToggleSource}
                          onKeepOpen={handleKeepDropdownOpen}
                        />
                      ))}
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Bulk-select toggle — reveals checkboxes on skill cards and
                  activates Cmd/Ctrl+A + Esc shortcuts. Exiting clears any
                  accumulated selection so hidden state can't leak. */}
              <Button
                variant="ghost"
                size="sm"
                aria-pressed={bulkSelectMode}
                aria-label={
                  bulkSelectMode
                    ? 'Exit bulk select mode'
                    : 'Enter bulk select mode'
                }
                onClick={handleToggleBulkSelectMode}
                className={cn(
                  'shrink-0 gap-1.5 min-h-11',
                  bulkSelectMode
                    ? 'text-primary'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {bulkSelectMode ? (
                  <X className="h-4 w-4" />
                ) : (
                  <CheckSquare className="h-4 w-4" />
                )}
                {bulkSelectMode ? 'Cancel' : 'Select'}
              </Button>

              {/* Skill type filter — agent view only */}
              {selectedAgentId && (
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
                        'shrink-0 gap-1.5 min-h-11 max-w-48',
                        skillTypeFilter !== 'all' ||
                          excludedSkillTypeFilters.length > 0
                          ? 'text-primary'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      <span className="max-w-36 truncate">
                        {skillTypeTriggerLabel}
                      </span>
                      <ChevronDown className="h-3 w-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-60">
                    <DropdownMenuLabel>Include</DropdownMenuLabel>
                    <DropdownMenuRadioGroup
                      value={skillTypeFilter}
                      onValueChange={handleSkillTypeFilterChange}
                    >
                      {SKILL_TYPE_FILTER_OPTIONS.map((option) => (
                        <DropdownMenuRadioItem
                          key={option.value}
                          value={option.value}
                          className="gap-2"
                        >
                          {option.dotClass ? (
                            <span
                              className={`h-2 w-2 rounded-full ${option.dotClass}`}
                            />
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
                      const isAvailable = availableExcludeTypes.includes(
                        option.value,
                      )
                      const unavailableReason = getUnavailableExcludeReason(
                        skillTypeFilter,
                        option.value,
                      )
                      return (
                        <DropdownMenuCheckboxItem
                          key={option.value}
                          checked={excludedSkillTypeFilters.includes(
                            option.value,
                          )}
                          disabled={!isAvailable}
                          onCheckedChange={
                            excludedSkillTypeToggleHandlers[option.value]
                          }
                          onSelect={handleKeepDropdownOpen}
                          aria-label={
                            unavailableReason
                              ? `${option.label}, unavailable: ${unavailableReason}`
                              : option.label
                          }
                          className="gap-2"
                        >
                          {option.dotClass ? (
                            <span
                              className={`h-2 w-2 rounded-full ${option.dotClass}`}
                            />
                          ) : null}
                          <span className="min-w-0 flex-1 truncate">
                            {option.label}
                          </span>
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
                      onSelect={handleSelectClearExcludedSkillTypeFilters}
                    >
                      Clear excludes
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>

            {/* Agent filter indicator */}
            {selectedAgent && (
              <FilterPill
                label={
                  <>
                    for{' '}
                    <strong className="text-primary">
                      {selectedAgent.name}
                    </strong>
                  </>
                }
                onClear={handleClearFilter}
                testId="agent-filter-pill"
              />
            )}

            {/* Source-repo filter indicator. Stacks orthogonally with the
                Agent pill — agent AND repo filters can be active at once. Up to
                SOURCE_FILTER_MAX_VISIBLE_REPOS repos render as individual
                clearable pills; beyond that a single collapsed pill clears the
                whole set (DESIGN.md: avoid pill overload). The else branch maps
                an empty array to nothing, covering the no-filter case too. */}
            {sourceFilter.selectedSources.length >
            SOURCE_FILTER_MAX_VISIBLE_REPOS ? (
              <FilterPill
                label={
                  <>
                    from{' '}
                    <strong className="text-primary">
                      {sourceFilter.selectedSources.length} repos
                    </strong>
                  </>
                }
                onClear={handleClearSourceFilter}
                testId="source-filter-pill"
              />
            ) : (
              sourceFilter.selectedSources.map((source) => (
                <SourceFilterPill
                  key={source}
                  source={source}
                  onClear={handleToggleSource}
                />
              ))
            )}

            {/* Local-skills-hidden caveat — only while the repo filter is
                actively suppressing source-less local skills. Plain metadata,
                not a pill, so it reads as subordinate to the filter pills. */}
            {sourceFilter.localHiddenCount > 0 ? (
              <p className="px-4 py-2 border-b border-border text-xs text-muted-foreground shrink-0">
                {sourceFilter.localHiddenCount}{' '}
                {pluralize(sourceFilter.localHiddenCount, 'local skill')} hidden
              </p>
            ) : null}

            {/* Renders only when at least one skill is ticked. */}
            <SelectionToolbar
              onPrimaryAction={handlePrimaryAction}
              agentDisplayName={selectedAgent?.name}
            />

            <div className="flex-1 min-h-0 overflow-auto p-4">
              <SkillsList />
            </div>
          </TabsContent>

          <TabsContent
            value="marketplace"
            className="flex-1 m-0 data-[state=active]:flex data-[state=active]:flex-col min-h-0 overflow-hidden"
          >
            <SkillsMarketplace />
          </TabsContent>
        </Tabs>

        <UnlinkDialog />
        <AddSymlinkModal />
        <CopyToAgentsModal />
        <SyncConfirmDialog />
        <SyncConflictDialog />
        <SyncResultDialog />
        <CleanupAgentDialog />
        <SymlinkCleanupDialog />

        {/*
          Bulk delete / unlink confirmation. Copy is driven by
          the kind flag so the dispatch site stays a single handler.
        */}
        <Dialog
          open={bulkConfirm !== null}
          onOpenChange={handleCancelBulkConfirm}
        >
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                {bulkConfirm?.kind === 'delete'
                  ? `Delete ${bulkConfirm.skillNames.length} ${pluralize(bulkConfirm.skillNames.length, 'skill')}?`
                  : `Unlink ${bulkConfirm?.skillNames.length ?? 0} ${pluralize(bulkConfirm?.skillNames.length ?? 0, 'skill')} from ${bulkConfirm?.agentName ?? 'agent'}?`}
              </DialogTitle>
              <DialogDescription>
                {bulkConfirm?.kind === 'delete'
                  ? renderBulkDeleteDescription({
                      totalCount: bulkConfirm.skillNames.length,
                      trashCount:
                        bulkDeleteTargetSummary?.deleteTargets.length ??
                        bulkConfirm.skillNames.length,
                      orphanCleanupCount:
                        bulkDeleteTargetSummary?.orphanRecords.length ?? 0,
                      orphanRescanCount:
                        bulkDeleteTargetSummary?.orphanErrors.length ?? 0,
                      sourceSummary: bulkConfirm.sourceSummary,
                    })
                  : `This removes the symlinks in ${bulkConfirm?.agentName ?? 'this agent'}. The underlying skill files stay in your source directory.`}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={handleCancelBulkConfirm}>
                Cancel
              </Button>
              <Button
                variant={
                  bulkConfirm?.kind === 'delete' ? 'destructive' : 'default'
                }
                disabled={isBulkConfirmPrimaryDisabled}
                onClick={handleConfirmBulk}
              >
                {bulkConfirm?.kind === 'delete' ? 'Delete' : 'Unlink'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    )
  },
)

/**
 * One repo row in the source-filter dropdown — wraps `DropdownMenuCheckboxItem`
 * with a `useCallback` toggle so the memoized item isn't defeated by an inline
 * arrow (which also trips `prefer-usecallback-might-work`). Mapped by MainContent.
 * @param row - Facet row: repo id, visible-skill count, and ticked state.
 * @param onToggle - Adds/removes this repo from the include filter.
 * @param onKeepOpen - `onSelect` handler that keeps the menu open on activation.
 * @returns A checkbox menu item labelling the repo id and its skill count.
 * @example
 * <SourceFacetCheckboxRow row={row} onToggle={handleToggleSource} onKeepOpen={handleKeepDropdownOpen} />
 */
const SourceFacetCheckboxRow = React.memo(function SourceFacetCheckboxRow({
  row,
  onToggle,
  onKeepOpen,
}: {
  row: SourceFilterRow
  onToggle: (source: RepositoryId) => void
  onKeepOpen: (event: Event) => void
}): React.ReactElement {
  // Stable per-row toggle — re-created only when the row id or handler changes.
  const handleCheckedChange = useCallback((): void => {
    onToggle(row.source)
  }, [onToggle, row.source])

  return (
    <DropdownMenuCheckboxItem
      checked={row.checked}
      onCheckedChange={handleCheckedChange}
      onSelect={onKeepOpen}
      aria-label={`${row.source}, ${row.count} ${pluralize(row.count, 'skill')}`}
      className="gap-2"
    >
      <span className="min-w-0 flex-1 truncate">{row.source}</span>
      <span className="ml-auto text-xs text-muted-foreground">{row.count}</span>
    </DropdownMenuCheckboxItem>
  )
})

/**
 * One clearable "from <repo>" pill (shown when ≤ SOURCE_FILTER_MAX_VISIBLE_REPOS
 * repos selected) — wraps the memoized `FilterPill` with a `useCallback` clear so
 * an inline arrow doesn't re-render it / trip `prefer-usecallback-might-work`.
 * @param source - The repository id this pill represents and clears.
 * @param onClear - Removes `source` from the include filter (toggle off).
 * @returns A FilterPill labelled `from <source>` wired to single-repo clear.
 * @example
 * <SourceFilterPill source={source} onClear={handleToggleSource} />
 */
const SourceFilterPill = React.memo(function SourceFilterPill({
  source,
  onClear,
}: {
  source: RepositoryId
  onClear: (source: RepositoryId) => void
}): React.ReactElement {
  // Stable clear — toggles this exact repo off the include filter.
  const handleClear = useCallback((): void => {
    onClear(source)
  }, [onClear, source])

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
})
