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
  selectRepoFacetOptions,
  selectSelectedVisibleNames,
  selectVisibleSkillNames,
} from '@/renderer/src/redux/selectors'
import { setPreviewSkill } from '@/renderer/src/redux/slices/marketplaceSlice'
import {
  clearSelection,
  deleteSelectedSkills,
  selectAll,
  selectSelectedSkillNames,
  setBulkProgress,
  undoLastBulkDelete,
  unlinkSelectedFromAgent,
} from '@/renderer/src/redux/slices/skillsSlice'
import {
  clearBulkConfirm,
  clearExcludedSkillTypeFilters,
  clearSelectedSource,
  clearUndoToast,
  enterBulkSelectMode,
  exitBulkSelectMode,
  getAvailableExcludeTypes,
  selectAgent,
  selectBulkConfirm,
  selectBulkSelectMode,
  selectExcludedSkillTypeFilters,
  selectSelectedSource,
  setActiveTab,
  setBulkConfirm,
  setSelectedSource,
  setSkillTypeFilter,
  setUndoToast,
  toggleExcludedSkillTypeFilter,
  toggleSortOrder,
} from '@/renderer/src/redux/slices/uiSlice'
import type {
  ActiveTab,
  ExcludableSkillTypeFilter,
  SkillTypeFilter,
} from '@/renderer/src/redux/slices/uiSlice'
import { refreshAllData } from '@/renderer/src/redux/thunks'
import { flashFailedRows } from '@/renderer/src/utils/bulkOpVisuals'
import { errorToastDescription } from '@/renderer/src/utils/errorToastDescription'
import { isEditableTarget } from '@/renderer/src/utils/isEditableTarget'
import { pluralize } from '@/renderer/src/utils/pluralize'
import { UNDO_WINDOW_MS } from '@/shared/constants'
import { FEATURE_FLAGS } from '@/shared/featureFlags'
import type {
  BulkDeleteItemResult,
  IsoTimestamp,
  RepositoryId,
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
 * Compress long repository slugs for toolbar triggers while preserving both
 * owner and repo clues. The full value remains in aria-labels and filter pills.
 * @param source - Repository slug, usually `owner/repo`.
 * @returns Short label safe for compact toolbar buttons.
 * @example
 * formatRepositoryFacetLabel('very-long-owner-name/extremely-long-repository')
 * // => "very-long-ow...ng-repository"
 */
function formatRepositoryFacetLabel(source: RepositoryId): string {
  if (source.length <= 28) return source
  return `${source.slice(0, 12)}...${source.slice(-13)}`
}

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
    const visibleNames = useAppSelector(selectVisibleSkillNames)
    const selectedVisibleNames = useAppSelector(selectSelectedVisibleNames)
    const selectedAllNames = useAppSelector(selectSelectedSkillNames)
    const bulkConfirm = useAppSelector(selectBulkConfirm)
    const bulkSelectMode = useAppSelector(selectBulkSelectMode)
    const selectedSource = useAppSelector(selectSelectedSource)
    const repoFacetOptions = useAppSelector(selectRepoFacetOptions)
    const excludedSkillTypeFilters = useAppSelector(
      selectExcludedSkillTypeFilters,
    )

    const selectedAgent = agents.find((a) => a.id === selectedAgentId)
    const selectedSkillTypeLabel = SKILL_TYPE_FILTER_OPTIONS.find(
      (option) => option.value === skillTypeFilter,
    )!.label
    const availableExcludeTypes = getAvailableExcludeTypes(skillTypeFilter)
    const skillTypeTriggerLabel =
      excludedSkillTypeFilters.length === 0
        ? selectedSkillTypeLabel
        : `${selectedSkillTypeLabel} · ${excludedSkillTypeFilters.length} excluded`
    const selectedSourceLabel = selectedSource
      ? formatRepositoryFacetLabel(selectedSource)
      : 'Source'

    const handleClearFilter = useCallback((): void => {
      dispatch(selectAgent(null))
    }, [dispatch])

    const handleClearSourceFilter = useCallback((): void => {
      dispatch(clearSelectedSource())
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

    const handleRepoFacetChange = useCallback(
      (value: string): void => {
        if (value === 'all') {
          dispatch(clearSelectedSource())
          return
        }
        dispatch(setSelectedSource(value as RepositoryId))
      },
      [dispatch],
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
      dispatch(
        setBulkConfirm({
          kind: selectedAgentId ? 'unlink' : 'delete',
          skillNames: selectedVisibleNames,
          agentId: selectedAgentId,
          agentName: selectedAgent?.name ?? null,
        }),
      )
    }, [dispatch, selectedAgentId, selectedAgent?.name, selectedVisibleNames])

    /**
     * Invoked by the BulkConfirmDialog's primary button. Reads the pending
     * payload from Redux, clears the dialog, then runs the existing thunk +
     * post-action logic (toast, refresh, undo toast for deletes).
     */
    const handleConfirmBulk = useCallback(async (): Promise<void> => {
      if (!bulkConfirm) return
      const { kind, skillNames, agentId, agentName } = bulkConfirm
      // Clear FIRST so the dialog unmounts before the thunk suspends; the
      // thunk's `.pending` reducer also clears, but the explicit clear removes
      // the "frozen dialog while request is in flight" race on slow disks.
      dispatch(clearBulkConfirm())

      if (kind === 'unlink' && agentId) {
        // Agent view — bulk unlink (not tombstoned, no undo toast).
        const action = await dispatch(
          unlinkSelectedFromAgent({
            agentId,
            selectedNames: skillNames,
          }),
        )
        if (unlinkSelectedFromAgent.fulfilled.match(action)) {
          const failedNames = action.payload.items
            .filter((item) => item.outcome === 'error')
            .map((item) => item.skillName)
          const unlinkedCount = action.payload.items.length - failedNames.length
          flashFailedRows(failedNames)
          if (unlinkedCount === 0) {
            // Every item failed — a success toast would lie to the user.
            // Match the delete-all-errored path: surface a failure toast with
            // the same per-item summary we'd show on partial success.
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
        return
      }

      // Global view — bulk delete. Every skill (including ones tracked in
      // `~/.agents/.skill-lock.json`) flows through the trash + UndoToast
      // pipeline. The CLI removal path was retired because `npx skills remove`
      // spawns were unreliable; stale lock-file entries are an acceptable
      // trade-off for a deterministic delete that supports undo.
      const action = await dispatch(deleteSelectedSkills(skillNames))
      if (deleteSelectedSkills.fulfilled.match(action)) {
        const tombstoneIds = action.payload.items
          .filter(
            (
              item,
            ): item is Extract<BulkDeleteItemResult, { outcome: 'deleted' }> =>
              item.outcome === 'deleted',
          )
          .map((item) => item.tombstoneId)
        const deletedNames = action.payload.items
          .filter((item) => item.outcome === 'deleted')
          .map((item) => item.skillName)
        const failedNames = action.payload.items
          .filter((item) => item.outcome === 'error')
          .map((item) => item.skillName)

        flashFailedRows(failedNames)
        refreshAllData(dispatch)

        if (tombstoneIds.length === 0) {
          // No tombstones, but the rows still might have succeeded as
          // `orphan-cleared` (broken-symlink sweeps that have no undo path).
          // Distinguish all-errored from any-cleared so we don't slap an
          // "error" title on a row that the user actually wanted swept.
          const anySuccess = action.payload.items.some(
            (item) =>
              item.outcome === 'deleted' || item.outcome === 'orphan-cleared',
          )
          if (anySuccess) {
            toast.success(formatCascadeSummary(action.payload))
          } else {
            toast.error('Bulk delete failed', {
              description: formatCascadeSummary(action.payload),
            })
          }
          return
        }

        // Render via sonner's default-styled wrapper (NOT `toast.custom`) so
        // the per-toast `closeButton: true` opt-in injects sonner's built-in ×
        // — sonner only renders the close affordance on styled toasts, and
        // `toast.custom` opts out of that styling.
        //
        // `onUndoComplete` reads `toastId` through the closure at click time,
        // so it resolves after the surrounding const has been assigned.
        const expiresAt: IsoTimestamp = new Date(
          Date.now() + UNDO_WINDOW_MS,
        ).toISOString()
        const summary = formatCascadeSummary(action.payload)
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
      } else {
        toast.error('Bulk delete failed', {
          description: errorToastDescription(action),
        })
      }
    }, [bulkConfirm, dispatch, handleUndoDelete])

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

              {/* Repo facet: exact source filter with counts from the current
                  agent/type population, independent of the text query. */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={
                      selectedSource
                        ? `Filtering by source repository ${selectedSource}`
                        : 'Filter by source repository'
                    }
                    className={cn(
                      'shrink-0 gap-1.5 min-h-11 max-w-44',
                      selectedSource
                        ? 'text-primary'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <GitBranch className="h-4 w-4" />
                    <span className="max-w-32 truncate">
                      {selectedSourceLabel}
                    </span>
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72">
                  <DropdownMenuLabel>Source repository</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={selectedSource ?? 'all'}
                    onValueChange={handleRepoFacetChange}
                  >
                    <DropdownMenuRadioItem value="all">
                      <span className="min-w-0 flex-1">All repos</span>
                    </DropdownMenuRadioItem>
                    {repoFacetOptions.map((option) => (
                      <DropdownMenuRadioItem
                        key={option.source}
                        value={option.source}
                        aria-label={`${option.source}, ${option.count} ${pluralize(
                          option.count,
                          'skill',
                        )}`}
                        className="gap-2"
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {option.source}
                        </span>
                        <span className="ml-auto text-xs text-muted-foreground">
                          {option.count}
                        </span>
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
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
                Agent pill — the user can narrow by agent AND by repo at the
                same time without one resetting the other. */}
            {selectedSource && (
              <FilterPill
                label={
                  <>
                    from{' '}
                    <strong className="text-primary">{selectedSource}</strong>
                  </>
                }
                onClear={handleClearSourceFilter}
                testId="source-filter-pill"
              />
            )}

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
