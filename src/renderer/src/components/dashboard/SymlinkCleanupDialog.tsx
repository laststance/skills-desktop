import {
  AlertCircle,
  CheckCircle,
  Link2Off,
  Loader2,
  RefreshCcw,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import React, { useRef, useState } from 'react'
import { match } from 'ts-pattern'

import {
  buildSymlinkCleanupPlan,
  createBrokenSlotCleanupItemId,
  createOrphanCleanupItemId,
  getSymlinkCleanupPlanItems,
} from '@/renderer/src/components/dashboard/utils/buildSymlinkCleanupPlan'
import type {
  BrokenSlotsByAgent,
  BrokenSlotCleanupPlanItem,
  OrphanCleanupPlanItem,
  SymlinkCleanupItemId,
  SymlinkCleanupPlan,
  SymlinkCleanupPlanItem,
} from '@/renderer/src/components/dashboard/utils/buildSymlinkCleanupPlan'
import {
  countOrphanSymlinksRemoved,
  formatCascadeSummary,
  formatUnlinkSummary,
} from '@/renderer/src/components/skills/bulkDeleteHelpers'
import { Button } from '@/renderer/src/components/ui/button'
import { Checkbox } from '@/renderer/src/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/renderer/src/components/ui/dialog'
import { cn } from '@/renderer/src/lib/utils'
import { useAppDispatch, useAppSelector } from '@/renderer/src/redux/hooks'
import { fetchAgents } from '@/renderer/src/redux/slices/agentsSlice'
import {
  clearSelection,
  clearSelectedBrokenSymlinkSlots,
  clearSelectedOrphanSymlinks,
  fetchSkills,
} from '@/renderer/src/redux/slices/skillsSlice'
import {
  closeSymlinkCleanupDialog,
  fetchSourceStats,
  selectSymlinkCleanupDialogOpen,
} from '@/renderer/src/redux/slices/uiSlice'
import { pluralize } from '@/renderer/src/utils/pluralize'
import type {
  AgentId,
  BulkDeleteItemResult,
  BulkDeleteResult,
  BulkUnlinkItemResult,
  BulkUnlinkResult,
} from '@/shared/types'

type CleanupPhase =
  | 'idle'
  | 'scanning'
  | 'ready'
  | 'no-safe-cleanup'
  | 'stale'
  | 'cleaning'
  | 'error'
  | 'complete'

interface CleanupSummary {
  phrases: string[]
  cleanedIssues: number
  orphanSymlinksRemoved: number
  brokenLinksUnlinked: number
  failedCount: number
}

interface SymlinkCleanupDialogState {
  phase: CleanupPhase
  plan: SymlinkCleanupPlan | null
  selectedItemIds: SymlinkCleanupItemId[]
  rowErrors: Record<SymlinkCleanupItemId, string>
  summary: CleanupSummary | null
  message: string | null
  /**
   * True only when a 'stale' phase was reached *after* the cleanup mutation
   * ran (so the dashboard side data may be stale and a rescan must refresh
   * every source). False for the pre-mutation 'plan changed' stale and for
   * every non-stale phase.
   */
  staleAfterMutation: boolean
}

type SymlinkCleanupDialogAction =
  | { type: 'reset' }
  | { type: 'scanning' }
  | { type: 'ready'; plan: SymlinkCleanupPlan; message?: string | null }
  | {
      type: 'no-safe-cleanup'
      plan: SymlinkCleanupPlan
      message?: string | null
    }
  | { type: 'stale'; message: string; staleAfterMutation?: boolean }
  | { type: 'cleaning' }
  | {
      type: 'error'
      message: string
      rowErrors?: Record<SymlinkCleanupItemId, string>
      selectedItemIds?: SymlinkCleanupItemId[]
      summary?: CleanupSummary
      plan?: SymlinkCleanupPlan
    }
  | { type: 'complete'; summary: CleanupSummary }
  | { type: 'toggle-item'; itemId: SymlinkCleanupItemId }
  | {
      type: 'set-section'
      itemIds: SymlinkCleanupItemId[]
      checked: boolean
    }

const INITIAL_DIALOG_STATE: SymlinkCleanupDialogState = {
  phase: 'idle',
  plan: null,
  selectedItemIds: [],
  rowErrors: {},
  summary: null,
  message: null,
  staleAfterMutation: false,
}

const SYMLINK_CLEANUP_TRIGGER_SELECTOR = '[data-symlink-cleanup-trigger="true"]'

/**
 * Reduces SymlinkCleanupDialog state transitions while the dialog owns local scan and selection data.
 * @param state - Current dialog state.
 * @param action - State transition emitted by scan, review, or clean handlers.
 * @returns Next dialog state.
 * @example
 * symlinkCleanupDialogReducer(INITIAL_DIALOG_STATE, { type: 'scanning' }).phase // => 'scanning'
 */
function symlinkCleanupDialogReducer(
  state: SymlinkCleanupDialogState,
  action: SymlinkCleanupDialogAction,
): SymlinkCleanupDialogState {
  // Cleanup actions are a closed union; every transition must update phase, selection, and errors.
  return match(action)
    .returnType<SymlinkCleanupDialogState>()
    .with({ type: 'reset' }, () => INITIAL_DIALOG_STATE)
    .with({ type: 'scanning' }, () => ({
      ...INITIAL_DIALOG_STATE,
      phase: 'scanning',
    }))
    .with({ type: 'ready' }, ({ plan, message }) => {
      const selectedItemIds = getSymlinkCleanupPlanItems(plan).map(
        (item) => item.id,
      )
      return {
        phase: 'ready',
        plan,
        selectedItemIds,
        rowErrors: {},
        summary: null,
        message: message ?? null,
        staleAfterMutation: false,
      }
    })
    .with({ type: 'no-safe-cleanup' }, ({ plan, message }) => ({
      phase: 'no-safe-cleanup',
      plan,
      selectedItemIds: [],
      rowErrors: {},
      summary: null,
      message: message ?? null,
      staleAfterMutation: false,
    }))
    .with({ type: 'stale' }, ({ message, staleAfterMutation }) => ({
      ...state,
      phase: 'stale',
      message,
      staleAfterMutation: staleAfterMutation ?? false,
    }))
    .with({ type: 'cleaning' }, () => ({
      ...state,
      phase: 'cleaning',
      rowErrors: {},
      message: null,
    }))
    .with(
      { type: 'error' },
      ({ message, plan, rowErrors, selectedItemIds, summary }) => ({
        ...state,
        phase: 'error',
        message,
        rowErrors: rowErrors ?? state.rowErrors,
        selectedItemIds: selectedItemIds ?? state.selectedItemIds,
        summary: summary ?? state.summary,
        plan: plan ?? state.plan,
      }),
    )
    .with({ type: 'complete' }, ({ summary }) => ({
      ...state,
      phase: 'complete',
      selectedItemIds: [],
      rowErrors: {},
      summary,
      message: null,
    }))
    .with({ type: 'toggle-item' }, ({ itemId }) => {
      const selected = new Set(state.selectedItemIds)
      if (selected.has(itemId)) {
        selected.delete(itemId)
      } else {
        selected.add(itemId)
      }
      return {
        ...state,
        selectedItemIds: Array.from(selected),
      }
    })
    .with({ type: 'set-section' }, ({ checked, itemIds }) => {
      const selected = new Set(state.selectedItemIds)
      for (const itemId of itemIds) {
        if (checked) {
          selected.add(itemId)
        } else {
          selected.delete(itemId)
        }
      }
      return {
        ...state,
        selectedItemIds: Array.from(selected),
      }
    })
    .exhaustive()
}

/**
 * Converts an unknown thunk or IPC error into compact dialog copy.
 * @param error - Error thrown by `.unwrap()` or local execution code.
 * @returns Human-readable message.
 * @example
 * getErrorMessage(new Error('Denied')) // => 'Denied'
 */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message
  }
  return 'Unknown error'
}

/**
 * Narrows a cleanup row to a broken-slot row for grouped unlink execution.
 * @param item - Cleanup plan row.
 * @returns True when the row unlinks one agent-side broken symlink.
 * @example
 * isBrokenSlotItem({ kind: 'broken-slot', ...item }) // => true
 */
function isBrokenSlotItem(
  item: SymlinkCleanupPlanItem,
): item is BrokenSlotCleanupPlanItem {
  return item.kind === 'broken-slot'
}

/**
 * Returns selected cleanup rows from the current plan in stable display order.
 * @param plan - Cleanup plan currently under review.
 * @param selectedItemIds - Row ids checked by the user.
 * @returns Selected cleanup rows, or an empty array when no plan exists.
 * @example
 * getSelectedPlanItems(plan, ['orphan:task']).length // => 1
 */
function getSelectedPlanItems(
  plan: SymlinkCleanupPlan | null,
  selectedItemIds: readonly SymlinkCleanupItemId[],
): SymlinkCleanupPlanItem[] {
  if (!plan) return []
  const selected = new Set(selectedItemIds)
  return getSymlinkCleanupPlanItems(plan).filter((item) =>
    selected.has(item.id),
  )
}

/**
 * Flattens grouped broken-slot rows while preserving the cleanup plan's row-id type.
 * @param brokenSlotsByAgent - Agent-keyed broken-slot rows from the cleanup plan.
 * @returns Broken-slot rows in stable grouped order.
 * @example
 * getBrokenSlotPlanItems(plan.brokenSlotsByAgent).map((item) => item.id)
 */
function getBrokenSlotPlanItems(
  brokenSlotsByAgent: BrokenSlotsByAgent,
): BrokenSlotCleanupPlanItem[] {
  return Object.values(brokenSlotsByAgent).flatMap((items) => items ?? [])
}

/**
 * Checks whether a selected row still describes the exact cleanup target the user reviewed.
 * @param reviewedItem - Row from the visible review plan.
 * @param freshItem - Row rebuilt from a just-fetched scanner snapshot.
 * @returns True when destructive identity fields still match.
 * @example
 * doesFreshItemMatchReviewedItem(reviewedBroken, freshBroken) // => true
 */
function doesFreshItemMatchReviewedItem(
  reviewedItem: SymlinkCleanupPlanItem,
  freshItem: SymlinkCleanupPlanItem | undefined,
): boolean {
  if (!freshItem || reviewedItem.kind !== freshItem.kind) return false

  if (reviewedItem.kind === 'broken-slot') {
    return (
      freshItem.kind === 'broken-slot' &&
      reviewedItem.agentId === freshItem.agentId &&
      reviewedItem.linkName === freshItem.linkName &&
      reviewedItem.linkPath === freshItem.linkPath &&
      reviewedItem.targetPath === freshItem.targetPath &&
      reviewedItem.preservedSkillPath === freshItem.preservedSkillPath
    )
  }

  if (freshItem.kind !== 'orphan-record') return false
  const reviewedAgents = reviewedItem.agents.map(
    (agent) => `${agent.agentId}:${agent.linkPath}:${agent.targetPath}`,
  )
  const freshAgents = freshItem.agents.map(
    (agent) => `${agent.agentId}:${agent.linkPath}:${agent.targetPath}`,
  )
  return (
    reviewedItem.skillName === freshItem.skillName &&
    reviewedItem.symlinkCount === freshItem.symlinkCount &&
    reviewedAgents.length === freshAgents.length &&
    reviewedAgents.every((agentKey, index) => agentKey === freshAgents[index])
  )
}

/**
 * Returns fresh selected rows only if every reviewed row still matches before cleanup mutates disk state.
 * @param freshPlan - Plan rebuilt from a fresh `fetchSkills().unwrap()` snapshot.
 * @param reviewedItems - Selected rows from the previous review plan.
 * @returns Fresh rows to execute, or null when a stale-plan mismatch is detected.
 * @example
 * getFreshMatchingSelectedItems(plan, selectedRows)?.length // => selectedRows.length
 */
function getFreshMatchingSelectedItems(
  freshPlan: SymlinkCleanupPlan,
  reviewedItems: readonly SymlinkCleanupPlanItem[],
): SymlinkCleanupPlanItem[] | null {
  const freshItemsById = new Map(
    getSymlinkCleanupPlanItems(freshPlan).map((item) => [item.id, item]),
  )
  const freshItems: SymlinkCleanupPlanItem[] = []

  for (const reviewedItem of reviewedItems) {
    const freshItem = freshItemsById.get(reviewedItem.id)
    if (!freshItem) return null
    if (!doesFreshItemMatchReviewedItem(reviewedItem, freshItem)) return null
    freshItems.push(freshItem)
  }

  return freshItems
}

/**
 * Builds row-error state and selected failed ids from delete and unlink results.
 * @param params - Bulk delete result plus per-agent unlink results.
 * @returns Failed row ids and row messages for retry rendering.
 * @example
 * collectFailedRows({ deleteResult, unlinkResults: [] }).failedItemIds
 */
function collectFailedRows(params: {
  deleteResult: BulkDeleteResult | null
  unlinkResults: Array<{ agentId: AgentId; result: BulkUnlinkResult }>
}): {
  failedItemIds: SymlinkCleanupItemId[]
  rowErrors: Record<SymlinkCleanupItemId, string>
} {
  const failedItemIds: SymlinkCleanupItemId[] = []
  const rowErrors: Record<SymlinkCleanupItemId, string> = {}

  for (const item of params.deleteResult?.items ?? []) {
    if (item.outcome !== 'error') continue
    const itemId = createOrphanCleanupItemId(item.skillName)
    failedItemIds.push(itemId)
    rowErrors[itemId] = item.error.message
  }

  for (const { agentId, result } of params.unlinkResults) {
    for (const item of result.items) {
      if (item.outcome !== 'error') continue
      const itemId = createBrokenSlotCleanupItemId(agentId, item.skillName)
      failedItemIds.push(itemId)
      rowErrors[itemId] = item.error.message
    }
  }

  return { failedItemIds, rowErrors }
}

/**
 * Keeps only errors still visible after the post-cleanup rescan without widening branded ids to strings.
 * @param rowErrors - Errors keyed by cleanup row id from the attempted cleanup.
 * @param visibleFailedItemIds - Failed row ids still present in the refreshed plan.
 * @returns Row errors for failed rows that the retry UI can still display.
 * @example
 * pickVisibleRowErrors(errors, failedIds)
 */
function pickVisibleRowErrors(
  rowErrors: Record<SymlinkCleanupItemId, string>,
  visibleFailedItemIds: readonly SymlinkCleanupItemId[],
): Record<SymlinkCleanupItemId, string> {
  const visibleRowErrors: Record<SymlinkCleanupItemId, string> = {}
  for (const itemId of visibleFailedItemIds) {
    if (Object.prototype.hasOwnProperty.call(rowErrors, itemId)) {
      visibleRowErrors[itemId] = rowErrors[itemId]
    }
  }
  return visibleRowErrors
}

/**
 * Turns post-cleanup refresh failures into secondary copy so a successful mutation is not reported as failed.
 * @param results - Settled refresh thunk results after cleanup mutation finishes.
 * @returns Extra summary phrase, or null when every refresh thunk fulfilled.
 * @example
 * getRefreshFailureMessage([{ status: 'rejected', reason: new Error('offline') }]) // => 'Refresh failed after cleanup: offline. Rescan to update dashboard.'
 */
function getRefreshFailureMessage(
  results: readonly PromiseSettledResult<unknown>[],
): string | null {
  const failedRefresh = results.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  )
  if (!failedRefresh) return null
  return `Refresh failed after cleanup: ${getErrorMessage(failedRefresh.reason)}. Rescan to update dashboard.`
}

/**
 * Detects complete cleanup states whose dashboard refresh failed afterward.
 * @param summary - Cleanup summary stored in dialog state.
 * @returns True when the complete state should expose a direct rescan action.
 * @example
 * didCleanupRefreshFail({ phrases: ['Refresh failed after cleanup: offline.'], cleanedIssues: 1, orphanSymlinksRemoved: 0, brokenLinksUnlinked: 1, failedCount: 0 }) // => true
 */
function didCleanupRefreshFail(summary: CleanupSummary | null): boolean {
  return (
    summary?.phrases.some((phrase) =>
      phrase.startsWith('Refresh failed after cleanup:'),
    ) ?? false
  )
}

/**
 * Aggregates bulk cleanup results into the compact final summary shown in the dialog.
 * @param params - Attempted item count and mutation results.
 * @returns Count and phrase summary for complete or partial-failure states.
 * @example
 * buildCleanupSummary({ attemptedCount: 1, deleteResult: null, unlinkResults: [] }).cleanedIssues
 */
function buildCleanupSummary(params: {
  attemptedCount: number
  deleteResult: BulkDeleteResult | null
  unlinkResults: Array<{ agentName: string; result: BulkUnlinkResult }>
  refreshMessage?: string | null
}): CleanupSummary {
  const deletePhrases = params.deleteResult
    ? [formatCascadeSummary(params.deleteResult)].filter(Boolean)
    : []
  const unlinkPhrases = params.unlinkResults
    .map(({ agentName, result }) => formatUnlinkSummary(result, agentName))
    .filter(Boolean)

  const deleteItems = params.deleteResult?.items ?? []
  // Shared with the result toast (formatCascadeSummary) via one pure helper so
  // the dialog and toast can never report divergent orphan counts.
  const orphanSymlinksRemoved = params.deleteResult
    ? countOrphanSymlinksRemoved(params.deleteResult)
    : 0
  const brokenLinksUnlinked = params.unlinkResults.reduce((total, group) => {
    return (
      total +
      group.result.items.filter((item) => item.outcome === 'unlinked').length
    )
  }, 0)
  const deleteFailureCount = deleteItems.filter(
    (item): item is Extract<BulkDeleteItemResult, { outcome: 'error' }> =>
      item.outcome === 'error',
  ).length
  const unlinkFailureCount = params.unlinkResults.reduce((total, group) => {
    return (
      total +
      group.result.items.filter(
        (item): item is Extract<BulkUnlinkItemResult, { outcome: 'error' }> =>
          item.outcome === 'error',
      ).length
    )
  }, 0)
  const failedCount = deleteFailureCount + unlinkFailureCount

  return {
    phrases: [
      ...deletePhrases,
      ...unlinkPhrases,
      ...(params.refreshMessage ? [params.refreshMessage] : []),
    ],

    cleanedIssues: params.attemptedCount - failedCount,
    orphanSymlinksRemoved,
    brokenLinksUnlinked,
    failedCount,
  }
}

/**
 * Dashboard dialog for Scan -> Review -> Clean of safe broken symlink issues.
 * @returns Radix Dialog when open, otherwise null.
 * @example
 * <SymlinkCleanupDialog />
 */
export const SymlinkCleanupDialog =
  function SymlinkCleanupDialog(): React.ReactElement | null {
    const dispatch = useAppDispatch()
    const isOpen = useAppSelector(selectSymlinkCleanupDialogOpen)
    const [state, setState] = useState(INITIAL_DIALOG_STATE)
    const titleRef = useRef<HTMLHeadingElement>(null)
    const scanRequestIdRef = useRef(0)

    const selectedItemIdSet = new Set(state.selectedItemIds)

    const planItems = state.plan ? getSymlinkCleanupPlanItems(state.plan) : []

    const selectedItems = getSelectedPlanItems(
      state.plan,
      state.selectedItemIds,
    )

    const selectedCount = state.selectedItemIds.length
    const hasSelectedOrphan = selectedItems.some(
      (item) => item.kind === 'orphan-record',
    )

    const dispatchLocal = (action: SymlinkCleanupDialogAction): void => {
      setState((currentState) =>
        symlinkCleanupDialogReducer(currentState, action),
      )
    }

    const runScan = async (
      options: { refreshDashboard?: boolean } = {},
    ): Promise<void> => {
      const { refreshDashboard = false } = options
      const requestId = scanRequestIdRef.current + 1
      scanRequestIdRef.current = requestId
      dispatchLocal({ type: 'scanning' })
      try {
        let auxiliaryRefreshMessage: string | null = null
        // react-doctor-disable-next-line react-doctor/async-defer-await -- the awaited skills fetch is immediately followed by the post-await race guard `if (scanRequestIdRef.current !== requestId) return`, so the await cannot be deferred past that guard.
        const skills = refreshDashboard
          ? await (async () => {
              const [skillsResult, ...refreshResults] =
                await Promise.allSettled([
                  dispatch(fetchSkills()).unwrap(),
                  dispatch(fetchAgents()).unwrap(),
                  dispatch(fetchSourceStats()).unwrap(),
                ] as const)
              if (skillsResult.status === 'rejected') {
                throw skillsResult.reason
              }
              auxiliaryRefreshMessage = getRefreshFailureMessage(refreshResults)
              // Dashboard side panels can stay stale; the dialog only needs
              // fresh skills to decide whether cleanup remains available.
              return skillsResult.value
            })()
          : await dispatch(fetchSkills()).unwrap()
        if (scanRequestIdRef.current !== requestId) return
        const plan = buildSymlinkCleanupPlan(skills)
        if (getSymlinkCleanupPlanItems(plan).length === 0) {
          dispatchLocal({
            type: 'no-safe-cleanup',
            plan,
            message: auxiliaryRefreshMessage,
          })
          return
        }
        dispatchLocal({
          type: 'ready',
          plan,
          message: auxiliaryRefreshMessage,
        })
      } catch (error) {
        if (scanRequestIdRef.current !== requestId) return
        dispatchLocal({
          type: 'error',
          message: `Scan failed: ${getErrorMessage(error)}`,
        })
      }
    }

    const handleOpenAutoFocus = (event: Event): void => {
      event.preventDefault()
      titleRef.current?.focus()
      void runScan()
    }

    const handleCloseAutoFocus = (event: Event): void => {
      event.preventDefault()
      const trigger = document.querySelector<HTMLButtonElement>(
        SYMLINK_CLEANUP_TRIGGER_SELECTOR,
      )
      const fallback = document.querySelector<HTMLElement>('#main-content')
      const focusTarget = trigger ?? fallback
      focusTarget?.focus()
    }

    const handleClose = (nextOpen: boolean): void => {
      if (nextOpen || state.phase === 'cleaning') return
      scanRequestIdRef.current += 1
      dispatch(closeSymlinkCleanupDialog())
      dispatchLocal({ type: 'reset' })
    }

    const handleDismissClick = (): void => {
      handleClose(false)
    }

    const handleRescanClick = (): void => {
      // A rescan refreshes every dashboard source (not just the dialog's skill
      // scan) whenever the cleanup mutation already ran and may have left the
      // dashboard side data stale: a 'complete' or 'error' phase whose
      // post-cleanup refresh failed (both carry that failure in the summary),
      // a 'ready'/'no-safe-cleanup' scan that carried a refresh-failure message,
      // or a post-mutation 'stale' guard. Pre-mutation phases are excluded —
      // a 'stale' 'plan changed' (nothing mutated) and an 'error' scan failure
      // (no summary, so didCleanupRefreshFail is false) only need a skills-only
      // rescan.
      void runScan({
        refreshDashboard:
          ((state.phase === 'complete' || state.phase === 'error') &&
            didCleanupRefreshFail(state.summary)) ||
          ((state.phase === 'no-safe-cleanup' || state.phase === 'ready') &&
            state.message !== null) ||
          (state.phase === 'stale' && state.staleAfterMutation),
      })
    }

    const handlePreventDismissDuringCleaning = (event: Event): void => {
      if (state.phase === 'cleaning') event.preventDefault()
    }

    const handleToggleItem = (itemId: SymlinkCleanupItemId): void => {
      dispatchLocal({ type: 'toggle-item', itemId })
    }

    const handleSetSection = (
      itemIds: SymlinkCleanupItemId[],
      checked: boolean,
    ): void => {
      dispatchLocal({ type: 'set-section', itemIds, checked })
    }

    const handleCleanSelected = async (): Promise<void> => {
      if (!state.plan || state.selectedItemIds.length === 0) return
      const itemsToClean = getSelectedPlanItems(
        state.plan,
        state.selectedItemIds,
      )
      dispatchLocal({ type: 'cleaning' })
      // Dashboard cleanup is independent from the Installed list selection.
      // Clear stale row ticks before any fresh-scan early return can preserve them.
      dispatch(clearSelection())

      try {
        const freshSkills = await dispatch(fetchSkills()).unwrap()
        const freshPlan = buildSymlinkCleanupPlan(freshSkills)
        const freshItemsToClean = getFreshMatchingSelectedItems(
          freshPlan,
          itemsToClean,
        )
        if (!freshItemsToClean) {
          dispatchLocal({
            type: 'stale',
            message: 'Plan changed. Rescan required.',
          })
          return
        }

        const orphanRecords = freshItemsToClean
          .filter(
            (item): item is OrphanCleanupPlanItem =>
              item.kind === 'orphan-record',
          )
          .map((item) => ({
            skillName: item.skillName,
            agents: item.agents.map((agent) => ({
              agentId: agent.agentId,
              linkPath: agent.linkPath,
              targetPath: agent.targetPath,
            })),
          }))
        const deleteResult =
          orphanRecords.length > 0
            ? await dispatch(
                clearSelectedOrphanSymlinks(orphanRecords),
              ).unwrap()
            : null

        const unlinkResults: Array<{
          agentId: AgentId
          agentName: string
          result: BulkUnlinkResult
        }> = []
        const brokenItems = freshItemsToClean.filter(isBrokenSlotItem)
        if (brokenItems.length > 0) {
          const result = await dispatch(
            clearSelectedBrokenSymlinkSlots({
              items: brokenItems.map((item) => ({
                agentId: item.agentId,
                linkName: item.linkName,
                displaySkillName: item.displaySkillName,
                linkPath: item.linkPath,
                targetPath: item.targetPath,
              })),
            }),
          ).unwrap()
          const agentNamesById = new Map(
            brokenItems.map((item) => [item.agentId, item.agentName]),
          )
          for (const item of result.items) {
            const agentId = item.agentId
            const existingResult = unlinkResults.find(
              (entry) => entry.agentId === agentId,
            )
            if (existingResult) {
              existingResult.result.items.push(item)
              continue
            }
            unlinkResults.push({
              agentId,
              agentName: agentNamesById.get(agentId) ?? 'agent',
              result: { items: [item] },
            })
          }
        }

        // Refresh failures after mutation are secondary: the cleanup already
        // happened, so keep the mutation result and ask for an explicit rescan.
        const [postCleanupSkillsResult, ...refreshResults] =
          await Promise.allSettled([
            dispatch(fetchSkills()).unwrap(),
            dispatch(fetchAgents()).unwrap(),
            dispatch(fetchSourceStats()).unwrap(),
          ])
        const refreshMessage = getRefreshFailureMessage([
          postCleanupSkillsResult,
          ...refreshResults,
        ])
        const postCleanupPlan =
          postCleanupSkillsResult.status === 'fulfilled'
            ? buildSymlinkCleanupPlan(postCleanupSkillsResult.value)
            : null

        const summary = buildCleanupSummary({
          attemptedCount: freshItemsToClean.length,
          deleteResult,
          unlinkResults,
          refreshMessage,
        })
        const { failedItemIds, rowErrors } = collectFailedRows({
          deleteResult,
          unlinkResults,
        })

        if (failedItemIds.length > 0) {
          // The failed-row visibility check and the error dispatch below both
          // need a post-cleanup plan. When the refresh rejected we cannot
          // recompute it — falling back to the pre-cleanup plan would compare
          // failed rows against stale state and mis-report them — so require an
          // explicit rescan instead.
          if (!postCleanupPlan) {
            dispatchLocal({
              type: 'stale',
              message:
                'Cleanup finished with failures, but the refresh failed. Rescan required.',
              staleAfterMutation: true,
            })
            return
          }
          const postCleanupItemsById = new Map(
            getSymlinkCleanupPlanItems(postCleanupPlan).map((item) => [
              item.id,
              item,
            ]),
          )
          const failedAttemptedItems = freshItemsToClean.filter((item) =>
            failedItemIds.includes(item.id),
          )
          const visibleFailedItemIds = failedAttemptedItems
            .filter((item) =>
              doesFreshItemMatchReviewedItem(
                item,
                postCleanupItemsById.get(item.id),
              ),
            )
            .map((item) => item.id)
          if (visibleFailedItemIds.length !== failedAttemptedItems.length) {
            dispatchLocal({
              type: 'stale',
              message: 'Cleanup result changed. Rescan required.',
              staleAfterMutation: true,
            })
            return
          }
          const visibleRowErrors = pickVisibleRowErrors(
            rowErrors,
            visibleFailedItemIds,
          )
          if (
            Object.keys(visibleRowErrors).length !== visibleFailedItemIds.length
          ) {
            /* v8 ignore start -- unreachable: collectFailedRows writes failedItemIds and rowErrors in lockstep, and visibleFailedItemIds is a subset of failedItemIds, so pickVisibleRowErrors always keeps an entry per id; only a future refactor breaking that invariant would trip this guard */
            dispatchLocal({
              type: 'stale',
              message: 'Cleanup result changed. Rescan required.',
              staleAfterMutation: true,
            })
            return
            /* v8 ignore stop */
          }
          dispatchLocal({
            type: 'error',
            message: 'Cleanup finished with failures.',
            rowErrors: visibleRowErrors,
            selectedItemIds: visibleFailedItemIds,
            summary,
            plan: postCleanupPlan,
          })
          return
        }

        dispatchLocal({ type: 'complete', summary })
      } catch (error) {
        // Always attempt the same refresh on unexpected thunk/IPC errors so a
        // sticky skills error does not strand the list behind the dialog.
        await Promise.allSettled([
          dispatch(fetchSkills()).unwrap(),
          dispatch(fetchAgents()).unwrap(),
          dispatch(fetchSourceStats()).unwrap(),
        ])
        dispatchLocal({
          type: 'error',
          message: `Cleanup failed: ${getErrorMessage(error)}`,
        })
      }
      // react-doctor-disable-next-line react-doctor/exhaustive-deps -- the flagged missing dep is dispatchLocal, a stable reducer dispatch (L555-562); handleCleanSelected's changing deps (dispatch, state.plan, state.selectedItemIds) are already listed.
    }

    const handleCleanSelectedClick = (): void => {
      void handleCleanSelected()
    }

    if (!isOpen) return null

    const orphanItemIds = state.plan?.orphanRecords.map((item) => item.id) ?? []
    const brokenItemIds = Object.values(
      state.plan?.brokenSlotsByAgent ?? {},
    ).flatMap((items) => items?.map((item) => item.id) ?? [])

    const body = match(state.phase)
      .with('idle', 'scanning', 'cleaning', () => (
        <StatusBlock
          icon={state.phase === 'cleaning' ? ShieldCheck : Loader2}
          isSpinning={state.phase !== 'cleaning'}
          title={
            state.phase === 'cleaning'
              ? 'Cleaning selected issues'
              : 'Scanning agent symlinks'
          }
          description={
            state.phase === 'cleaning'
              ? 'Removing selected dangling links while preserving skill files.'
              : 'Checking broken links across agents and preparing a safe plan.'
          }
        />
      ))
      .with('no-safe-cleanup', () => (
        <StatusBlock
          icon={ShieldCheck}
          title="No safe cleanup items"
          description={
            state.message ??
            'Missing coverage and local folders are not changed here.'
          }
        />
      ))
      .with('stale', () => (
        <StatusBlock
          icon={RefreshCcw}
          title="Plan changed"
          description={state.message ?? 'Rescan required before cleanup.'}
        />
      ))
      .with('complete', () => <CompleteSummary summary={state.summary} />)
      .with('ready', 'error', () => (
        <ReviewContent
          plan={state.plan}
          selectedItemIdSet={selectedItemIdSet}
          rowErrors={state.rowErrors}
          message={state.message}
          summary={state.summary}
          onToggleItem={handleToggleItem}
          onSetSection={handleSetSection}
          orphanItemIds={orphanItemIds}
          brokenItemIds={brokenItemIds}
        />
      ))
      .exhaustive()
    const completeNeedsRescan =
      state.phase === 'complete' && didCleanupRefreshFail(state.summary)
    const noSafeNeedsRescan =
      state.phase === 'no-safe-cleanup' && state.message !== null
    const readyNeedsRescan = state.phase === 'ready' && state.message !== null

    return (
      <Dialog open={isOpen} onOpenChange={handleClose}>
        <DialogContent
          className="max-w-2xl max-h-[85vh] overflow-hidden"
          onOpenAutoFocus={handleOpenAutoFocus}
          onCloseAutoFocus={handleCloseAutoFocus}
          onEscapeKeyDown={handlePreventDismissDuringCleaning}
          onPointerDownOutside={handlePreventDismissDuringCleaning}
          hideCloseButton={state.phase === 'cleaning'}
        >
          <DialogHeader>
            <DialogTitle ref={titleRef} tabIndex={-1}>
              Symlink cleanup
            </DialogTitle>
            <DialogDescription>
              Review dangling skill links before removing them.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0">{body}</div>

          <DialogFooter className="gap-2">
            {state.phase === 'stale' ||
            state.phase === 'error' ||
            completeNeedsRescan ||
            noSafeNeedsRescan ||
            readyNeedsRescan ? (
              <Button
                type="button"
                variant="outline"
                onClick={handleRescanClick}
              >
                <RefreshCcw className="h-4 w-4" aria-hidden="true" />
                Rescan
              </Button>
            ) : null}
            {state.phase === 'complete' || state.phase === 'no-safe-cleanup' ? (
              <Button
                type="button"
                onClick={handleDismissClick}
                variant="default"
              >
                Done
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleDismissClick}
                  disabled={state.phase === 'cleaning'}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant={hasSelectedOrphan ? 'destructive' : 'default'}
                  disabled={
                    selectedCount === 0 ||
                    state.phase === 'scanning' ||
                    state.phase === 'cleaning' ||
                    state.phase === 'stale'
                  }
                  onClick={handleCleanSelectedClick}
                >
                  {state.phase === 'cleaning' ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Cleaning...
                    </>
                  ) : (
                    `Clean ${selectedCount} selected`
                  )}
                </Button>
              </>
            )}
          </DialogFooter>

          {state.phase === 'ready' && (
            <p className="sr-only" role="status" aria-atomic="true">
              Scan complete. {planItems.length} cleanup items available.
            </p>
          )}
        </DialogContent>
      </Dialog>
    )
  }

interface StatusBlockProps {
  icon: typeof Loader2
  title: string
  description: string
  isSpinning?: boolean
}

/**
 * Compact state block for scan, stale, empty, and cleaning states.
 * @param props - Icon, title, description, and optional spinner flag.
 * @returns Dialog body block for a non-review phase.
 * @example
 * <StatusBlock icon={Loader2} title="Scanning" description="Checking links" />
 */
const StatusBlock = function StatusBlock({
  icon: Icon,
  title,
  description,
  isSpinning = false,
}: StatusBlockProps): React.ReactElement {
  return (
    <div
      className="py-8 flex items-start gap-3 text-sm"
      // react-doctor-disable-next-line react-doctor/prefer-tag-over-role -- aria-live polite region announcing scan/clean/stale progress (StatusBlock), not a form-calculation result; <output> would be semantically wrong.
      role="status"
      aria-atomic="true"
    >
      <Icon
        className={cn(
          'mt-0.5 h-4 w-4 shrink-0 text-primary',
          isSpinning ? 'animate-spin' : '',
        )}
        aria-hidden="true"
      />

      <div className="space-y-1">
        <p className="font-medium text-foreground">{title}</p>
        <p className="text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}

interface CompleteSummaryProps {
  summary: CleanupSummary | null
}

/**
 * Renders final cleanup counts after all selected rows succeeded.
 * @param props - Completion summary returned by the executor.
 * @returns Compact success summary.
 * @example
 * <CompleteSummary summary={summary} />
 */
const CompleteSummary = function CompleteSummary({
  summary,
}: CompleteSummaryProps): React.ReactElement {
  const didRefreshFail = didCleanupRefreshFail(summary)
  return (
    <div
      className="py-5 space-y-3 text-sm"
      // react-doctor-disable-next-line react-doctor/prefer-tag-over-role -- aria-live polite region announcing cleanup completion (CompleteSummary), not a form-calculation output; <output> would be semantically wrong.
      role="status"
      aria-atomic="true"
    >
      <div className="flex items-start gap-3">
        <CheckCircle className="mt-0.5 h-4 w-4 text-success" aria-hidden />
        <div>
          <p className="font-medium">
            Cleaned up {summary?.cleanedIssues ?? 0}{' '}
            {pluralize(summary?.cleanedIssues ?? 0, 'symlink issue')}
          </p>
          <p className="text-muted-foreground">
            {didRefreshFail
              ? 'Cleanup succeeded. Rescan to refresh the dashboard state.'
              : 'The dashboard will reflect the refreshed scanner state.'}
          </p>
        </div>
      </div>
      <SummaryLines summary={summary} />
    </div>
  )
}

interface ReviewContentProps {
  plan: SymlinkCleanupPlan | null
  selectedItemIdSet: ReadonlySet<SymlinkCleanupItemId>
  rowErrors: Record<SymlinkCleanupItemId, string>
  message: string | null
  summary: CleanupSummary | null
  orphanItemIds: SymlinkCleanupItemId[]
  brokenItemIds: SymlinkCleanupItemId[]
  onToggleItem: (itemId: SymlinkCleanupItemId) => void
  onSetSection: (itemIds: SymlinkCleanupItemId[], checked: boolean) => void
}

/**
 * Renders grouped orphan and broken-slot rows for the review and partial-failure phases.
 * @param props - Plan, selection, row errors, and row/section callbacks.
 * @returns Scrollable review content.
 * @example
 * <ReviewContent plan={plan} selectedItemIdSet={ids} rowErrors={{}} ... />
 */
const ReviewContent = function ReviewContent({
  plan,
  selectedItemIdSet,
  rowErrors,
  message,
  summary,
  orphanItemIds,
  brokenItemIds,
  onToggleItem,
  onSetSection,
}: ReviewContentProps): React.ReactElement {
  return (
    <div className="max-h-[60vh] overflow-auto pr-1 space-y-4 text-sm">
      {message ? (
        <div
          className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive"
          role="alert"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{message}</span>
        </div>
      ) : null}
      {summary ? <SummaryLines summary={summary} /> : null}
      <CleanupSection
        title="Orphan records"
        description="Source is gone. Cleanup removes dangling symlinks only."
        itemIds={orphanItemIds}
        selectedItemIdSet={selectedItemIdSet}
        onSetSection={onSetSection}
      >
        {plan?.orphanRecords.map((item) => (
          <CleanupRow
            key={item.id}
            item={item}
            checked={selectedItemIdSet.has(item.id)}
            error={rowErrors[item.id]}
            onToggleItem={onToggleItem}
          />
        ))}
      </CleanupSection>
      <CleanupSection
        title="Broken agent links"
        description="Skill files are preserved. Cleanup unlinks this agent slot."
        itemIds={brokenItemIds}
        selectedItemIdSet={selectedItemIdSet}
        onSetSection={onSetSection}
      >
        {getBrokenSlotPlanItems(plan?.brokenSlotsByAgent ?? {}).map((item) => (
          <CleanupRow
            key={item.id}
            item={item}
            checked={selectedItemIdSet.has(item.id)}
            error={rowErrors[item.id]}
            onToggleItem={onToggleItem}
          />
        ))}
      </CleanupSection>
    </div>
  )
}

interface CleanupSectionProps {
  title: string
  description: string
  itemIds: SymlinkCleanupItemId[]
  selectedItemIdSet: ReadonlySet<SymlinkCleanupItemId>
  onSetSection: (itemIds: SymlinkCleanupItemId[], checked: boolean) => void
  children: React.ReactNode
}

/**
 * Renders one cleanup review section with a section-level checkbox.
 * @param props - Section label, item ids, selected ids, callback, and rows.
 * @returns Section wrapper with heading and rows.
 * @example
 * <CleanupSection title="Orphans" itemIds={ids}>...</CleanupSection>
 */
const CleanupSection = function CleanupSection({
  title,
  description,
  itemIds,
  selectedItemIdSet,
  onSetSection,
  children,
}: CleanupSectionProps): React.ReactElement | null {
  const checkedCount = itemIds.filter((itemId) =>
    selectedItemIdSet.has(itemId),
  ).length
  const checked = checkedCount === itemIds.length
  const isIndeterminate = checkedCount > 0 && checkedCount < itemIds.length
  const handleCheckedChange = (value: boolean | 'indeterminate'): void => {
    onSetSection(itemIds, value === true)
  }

  if (itemIds.length === 0) return null

  return (
    <section className="space-y-2">
      <div className="flex items-start justify-between gap-3 border-b border-border pb-2">
        <div>
          <h3 className="text-sm font-medium">{title}</h3>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <label className="flex min-h-6 items-center gap-2 text-xs text-muted-foreground">
          <Checkbox
            checked={isIndeterminate ? 'indeterminate' : checked}
            onCheckedChange={handleCheckedChange}
            aria-label={`Select all ${title}`}
          />
          {checkedCount}/{itemIds.length}
        </label>
      </div>
      <div className="divide-y divide-border">{children}</div>
    </section>
  )
}

interface CleanupRowProps {
  item: SymlinkCleanupPlanItem
  checked: boolean
  error?: string
  onToggleItem: (itemId: SymlinkCleanupItemId) => void
}

/**
 * Renders one cleanup row with checkbox, status icon, target identity, path details, and errors.
 * @param props - Cleanup item, checked state, optional row error, and toggle callback.
 * @returns Review row for one cleanup item.
 * @example
 * <CleanupRow item={item} checked={true} onToggleItem={toggle} />
 */
const CleanupRow = function CleanupRow({
  item,
  checked,
  error,
  onToggleItem,
}: CleanupRowProps): React.ReactElement {
  const isOrphan = item.kind === 'orphan-record'
  const label = isOrphan
    ? item.skillName
    : item.displaySkillName === item.linkName
      ? item.linkName
      : `${item.linkName} (${item.displaySkillName})`
  const agentLabel = isOrphan
    ? `${item.agents.length} ${pluralize(item.agents.length, 'agent')}`
    : item.agentName
  const issueCount = isOrphan ? item.symlinkCount : 1
  const Icon = isOrphan ? Trash2 : Link2Off
  const pathDetailsId = `${item.id}-path-details`
  const pathDetails = isOrphan
    ? item.agents.map(
        (agent) =>
          `${agent.agentName}: ${agent.linkPath} -> ${agent.targetPath}`,
      )
    : [`${item.linkPath} -> ${item.targetPath}`]
  const handleCheckedChange = (): void => {
    onToggleItem(item.id)
  }

  return (
    <div className="py-2">
      <div className="grid grid-cols-[auto_auto_minmax(0,1fr)_auto_auto] items-center gap-2">
        <Checkbox
          checked={checked}
          onCheckedChange={handleCheckedChange}
          aria-label={
            isOrphan
              ? `Clean orphan symlinks for ${label}`
              : `Clean broken link for ${label} from ${agentLabel}`
          }
          aria-describedby={pathDetailsId}
        />

        <Icon
          className={cn(
            'h-4 w-4',
            isOrphan ? 'text-destructive' : 'text-amber-400',
          )}
          aria-hidden="true"
        />

        <span className="min-w-0 truncate font-medium">{label}</span>
        <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
          {agentLabel}
        </span>
        <span className="w-4 text-right tabular-nums text-xs text-muted-foreground">
          {issueCount}
        </span>
      </div>
      <div
        id={pathDetailsId}
        data-testid="cleanup-path-evidence"
        className="ml-14 mt-2 space-y-1 rounded-md border border-border/70 bg-muted/30 px-2 py-1.5 font-mono text-xs text-foreground/75"
      >
        {pathDetails.map((pathDetail) => (
          <p
            key={pathDetail}
            className="break-all leading-5"
            title={pathDetail}
          >
            {pathDetail}
          </p>
        ))}
      </div>
      {error ? (
        <p className="ml-14 mt-1 text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

interface SummaryLinesProps {
  summary: CleanupSummary | null
}

/**
 * Renders compact count and phrase lines for complete or partial cleanup results.
 * @param props - Summary data from cleanup execution.
 * @returns Summary lines or null when no summary exists.
 * @example
 * <SummaryLines summary={summary} />
 */
const SummaryLines = function SummaryLines({
  summary,
}: SummaryLinesProps): React.ReactElement | null {
  if (!summary) return null
  return (
    <div className="space-y-1 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
      <p>
        {summary.orphanSymlinksRemoved}{' '}
        {pluralize(summary.orphanSymlinksRemoved, 'orphan symlink')} removed
      </p>
      <p>
        {summary.brokenLinksUnlinked}{' '}
        {pluralize(summary.brokenLinksUnlinked, 'broken agent link')} unlinked
      </p>
      {summary.failedCount > 0 ? (
        <p className="text-destructive">
          {summary.failedCount} {pluralize(summary.failedCount, 'issue')} failed
        </p>
      ) : null}
      {summary.phrases.length > 0 ? (
        <p className="pt-1">{summary.phrases.join(' ')}</p>
      ) : null}
    </div>
  )
}
