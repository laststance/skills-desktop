import {
  ArrowDownAZ,
  ArrowUpAZ,
  CheckSquare,
  ChevronDown,
  ExternalLink,
  X,
} from 'lucide-react'
import React, { useCallback, useEffect, useRef } from 'react'
import { toast } from 'sonner'

import { UNDO_WINDOW_MS } from '../../../../shared/constants'
import { FEATURE_FLAGS } from '../../../../shared/featureFlags'
import type {
  BulkDeleteItemResult,
  IsoTimestamp,
  SkillName,
  TombstoneId,
} from '../../../../shared/types'
import { cn } from '../../lib/utils'
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
  clearBulkConfirm,
  clearUndoToast,
  enterBulkSelectMode,
  exitBulkSelectMode,
  selectAgent,
  selectBulkConfirm,
  selectBulkSelectMode,
  setActiveTab,
  setBulkConfirm,
  setSkillTypeFilter,
  setUndoToast,
  toggleSortOrder,
} from '../../redux/slices/uiSlice'
import { refreshAllData } from '../../redux/thunks'
import { errorToastDescription } from '../../utils/errorToastDescription'
import { isEditableTarget } from '../../utils/isEditableTarget'
import { pluralize } from '../../utils/pluralize'
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
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

    // Stash the frequently-churning inputs in refs so the keydown listener
    // effect below only re-subscribes when the tab itself changes. Without
    // this, every skills-slice update (visibleNames is a fresh array
    // reference per render) tears down and re-attaches the `document`
    // listener — functionally correct but wasteful during active use.
    const visibleNamesRef = useRef(visibleNames)
    const selectedCountRef = useRef(selectedAllNames.length)
    const bulkSelectModeRef = useRef(bulkSelectMode)
    useEffect(() => {
      visibleNamesRef.current = visibleNames
    }, [visibleNames])
    useEffect(() => {
      selectedCountRef.current = selectedAllNames.length
    }, [selectedAllNames.length])
    useEffect(() => {
      bulkSelectModeRef.current = bulkSelectMode
    }, [bulkSelectMode])

    // Scoped to the Installed tab — Marketplace has its own selection context.
    // Shortcuts are further gated on `bulkSelectMode` so a user outside of
    // selection mode doesn't silently accumulate ticks they can't see (the
    // "hidden selection" anti-pattern).
    useEffect(() => {
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

      // Global view — bulk delete (tombstoned, undo toast).
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
          Date.now() + UNDO_WINDOW_MS,
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
          { duration: UNDO_WINDOW_MS },
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
    }, [bulkConfirm, dispatch, flashFailedRows, handleUndoDelete])

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
                onClick={() => {
                  if (bulkSelectMode) {
                    dispatch(exitBulkSelectMode())
                    dispatch(clearSelection())
                  } else {
                    dispatch(enterBulkSelectMode())
                  }
                }}
                className={cn(
                  'shrink-0 gap-1.5 min-h-[44px]',
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

        {/*
          Bulk delete / unlink confirmation. Replaces the old `window.confirm`
          call in handlePrimaryAction (blocks the event loop in Electron, and
          CodeRabbit flagged it as discouraged renderer API). Copy is driven by
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
                  ? 'This moves the skills to the app trash and removes every symlink pointing to them. You can restore within 15 seconds from the notification.'
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
