import {
  ArrowDownAZ,
  ArrowUpAZ,
  ChevronDown,
  ExternalLink,
  X,
} from 'lucide-react'
import React, { useCallback, useEffect } from 'react'
import { toast } from 'sonner'

import { FEATURE_FLAGS } from '../../../../shared/featureFlags'
import type {
  BulkDeleteItemResult,
  IsoTimestamp,
  SkillName,
  TombstoneId,
} from '../../../../shared/types'
import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import {
  selectSelectedVisibleNames,
  selectVisibleSkillNames,
} from '../../redux/selectors'
import { setPreviewSkill } from '../../redux/slices/marketplaceSlice'
import {
  clearSelection,
  deleteSelectedSkills,
  selectAll,
  selectSelectedSkillNames,
  setBulkProgress,
  undoLastBulkDelete,
  unlinkSelectedFromAgent,
} from '../../redux/slices/skillsSlice'
import type { ActiveTab, SkillTypeFilter } from '../../redux/slices/uiSlice'
import {
  clearUndoToast,
  selectAgent,
  setActiveTab,
  setSkillTypeFilter,
  setUndoToast,
  toggleSortOrder,
} from '../../redux/slices/uiSlice'
import { refreshAllData } from '../../redux/thunks'
import { isEditableTarget } from '../../utils/isEditableTarget'
import { SkillsMarketplace } from '../marketplace'
import { SyncConfirmDialog } from '../sidebar/SyncConfirmDialog'
import { SyncConflictDialog } from '../sidebar/SyncConflictDialog'
import { SyncResultDialog } from '../sidebar/SyncResultDialog'
import { AddSymlinkModal } from '../skills/AddSymlinkModal'
import {
  formatCascadeSummary,
  formatUnlinkSummary,
} from '../skills/bulkDeleteHelpers'
import { CopyToAgentsModal } from '../skills/CopyToAgentsModal'
import { SearchBox } from '../skills/SearchBox'
import { SelectionToolbar } from '../skills/SelectionToolbar'
import { SkillsList } from '../skills/SkillsList'
import { UndoToast } from '../skills/UndoToast'
import { UnlinkDialog } from '../skills/UnlinkDialog'
import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'

const SKILL_TYPE_FILTER_OPTIONS: {
  value: SkillTypeFilter
  label: string
  /** Colored dot class to match skill type visual indicators */
  dotClass?: string
}[] = [
  { value: 'all', label: 'All' },
  { value: 'symlinked', label: 'Symlinked', dotClass: 'bg-cyan-400' },
  { value: 'local', label: 'Local', dotClass: 'bg-emerald-400' },
]

const SKILLS_SH_URL = 'https://skills.sh'
/** Undo window duration (ms) — matches trashService TTL */
const UNDO_TTL_MS = 15_000

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

    const selectedAgent = agents.find((a) => a.id === selectedAgentId)

    const handleClearFilter = (): void => {
      dispatch(selectAgent(null))
    }

    const handleTabChange = (value: string): void => {
      dispatch(setActiveTab(value as ActiveTab))
      dispatch(setPreviewSkill(null))
    }

    const handleOpenMarketplace = (): void => {
      window.electron.shell.openExternal(SKILLS_SH_URL)
    }

    // Scoped to the Installed tab — Marketplace has its own selection context.
    useEffect(() => {
      if (activeTab !== 'installed') return
      const handleKey = (event: KeyboardEvent): void => {
        if (isEditableTarget(document.activeElement)) return
        // Cmd/Ctrl+A: select all visible
        if (
          (event.metaKey || event.ctrlKey) &&
          event.key.toLowerCase() === 'a'
        ) {
          event.preventDefault()
          dispatch(selectAll(visibleNames))
          return
        }
        // Esc: clear selection (only when selection is non-empty)
        if (event.key === 'Escape' && selectedAllNames.length > 0) {
          event.preventDefault()
          dispatch(clearSelection())
          return
        }
      }
      document.addEventListener('keydown', handleKey)
      return () => {
        document.removeEventListener('keydown', handleKey)
      }
    }, [dispatch, activeTab, visibleNames, selectedAllNames.length])

    // Wire the main-process `skills:deleteProgress` event into Redux. Fires
    // only for batches large enough to warrant a counter (see main handler).
    useEffect(() => {
      const unsubscribe = window.electron.skills.onDeleteProgress((payload) => {
        dispatch(setBulkProgress(payload))
      })
      return unsubscribe
    }, [dispatch])

    /**
     * Emit per-item failure flash for rows that errored out of a bulk op.
     * SkillItem rows listen for `skills:bulkItemFailed` and flash a red left
     * edge for 3s. Keeping this imperative avoids piping per-row failure state
     * through Redux for a transient visual.
     */
    const flashFailedRows = useCallback((failedNames: SkillName[]) => {
      for (const skillName of failedNames) {
        window.dispatchEvent(
          new CustomEvent<{ skillName: SkillName }>('skills:bulkItemFailed', {
            detail: { skillName },
          }),
        )
      }
    }, [])

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
              `Restored ${restoredCount} skill${restoredCount === 1 ? '' : 's'}.`,
            )
          } else {
            toast.info(
              `Restored ${restoredCount} of ${totalCount} ${totalCount === 1 ? 'skill' : 'skills'}.`,
            )
          }
        } else {
          toast.error('Restore failed', {
            description: action.error?.message ?? 'Unexpected error',
          })
        }
        refreshAllData(dispatch)
        dispatch(clearUndoToast())
      },
      [dispatch],
    )

    /**
     * Primary bulk action — behaves as Delete (global view) or Unlink
     * (agent view). Kicks off the thunk, shows an undo toast (deletes only),
     * and handles partial failures via a flash on the survivor rows.
     */
    const handlePrimaryAction = useCallback(async (): Promise<void> => {
      if (selectedVisibleNames.length === 0) return
      if (selectedAgentId) {
        // Agent view — bulk unlink (not tombstoned, no undo toast).
        const confirmed = window.confirm(
          `Unlink ${selectedVisibleNames.length} skill${selectedVisibleNames.length === 1 ? '' : 's'} from ${selectedAgent?.name ?? 'this agent'}?`,
        )
        if (!confirmed) return

        const action = await dispatch(
          unlinkSelectedFromAgent({
            agentId: selectedAgentId,
            selectedNames: selectedVisibleNames,
          }),
        )
        if (unlinkSelectedFromAgent.fulfilled.match(action)) {
          const failedNames = action.payload.items
            .filter((item) => item.outcome === 'error')
            .map((item) => item.skillName)
          flashFailedRows(failedNames)
          toast.success(
            formatUnlinkSummary(action.payload, selectedAgent?.name ?? 'agent'),
          )
        } else {
          toast.error('Bulk unlink failed', {
            description: action.error?.message ?? 'Unexpected error',
          })
        }
        refreshAllData(dispatch)
        return
      }

      // Global view — bulk delete (tombstoned, undo toast).
      const confirmed = window.confirm(
        `Delete ${selectedVisibleNames.length} skill${selectedVisibleNames.length === 1 ? '' : 's'} permanently? You will have 15 seconds to undo.`,
      )
      if (!confirmed) return

      const action = await dispatch(deleteSelectedSkills(selectedVisibleNames))
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
          // Every item errored — show a plain error toast, no undo possible.
          toast.error('Bulk delete failed', {
            description: formatCascadeSummary(action.payload),
          })
          return
        }

        // Render the sonner custom toast. The `onUndo` callback gives the
        // UndoToast access to the restore thunk without importing redux
        // hooks (it stays purely presentational).
        const expiresAt: IsoTimestamp = new Date(
          Date.now() + UNDO_TTL_MS,
        ).toISOString()
        const summary = formatCascadeSummary(action.payload)
        const toastId = toast.custom(
          (id) => (
            <UndoToast
              toastId={id}
              skillNames={deletedNames}
              tombstoneIds={tombstoneIds}
              expiresAt={expiresAt}
              summary={summary}
              onUndo={handleUndoDelete}
              onDismiss={() => {
                toast.dismiss(id)
                dispatch(clearUndoToast())
              }}
            />
          ),
          { duration: UNDO_TTL_MS },
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
          description: action.error?.message ?? 'Unexpected error',
        })
      }
    }, [
      dispatch,
      selectedAgentId,
      selectedAgent,
      selectedVisibleNames,
      flashFailedRows,
      handleUndoDelete,
    ])

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
            <div className="p-4 border-b border-border shrink-0 flex items-center gap-2">
              <div className="flex-1 min-w-0">
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
                onClick={() => dispatch(toggleSortOrder())}
                className="shrink-0 text-muted-foreground hover:text-foreground min-h-[44px] min-w-[44px]"
              >
                {sortOrder === 'asc' ? (
                  <ArrowDownAZ className="h-4 w-4" />
                ) : (
                  <ArrowUpAZ className="h-4 w-4" />
                )}
              </Button>

              {/* Skill type filter — agent view only */}
              {selectedAgentId && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={`shrink-0 gap-1.5 min-h-[44px] ${
                        skillTypeFilter !== 'all'
                          ? 'text-primary'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {
                        SKILL_TYPE_FILTER_OPTIONS.find(
                          (o) => o.value === skillTypeFilter,
                        )!.label
                      }
                      <ChevronDown className="h-3 w-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuRadioGroup
                      value={skillTypeFilter}
                      onValueChange={(v) =>
                        dispatch(setSkillTypeFilter(v as SkillTypeFilter))
                      }
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
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>

            {/* Agent filter indicator */}
            {selectedAgent && (
              <div className="px-4 py-2 border-b border-border bg-primary/5 flex items-center justify-between shrink-0">
                <span className="text-sm">
                  Showing skills for{' '}
                  <strong className="text-primary">{selectedAgent.name}</strong>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClearFilter}
                  className="min-h-[44px] px-3"
                >
                  <X className="h-3 w-3 mr-1" />
                  Clear
                </Button>
              </div>
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
      </main>
    )
  },
)
