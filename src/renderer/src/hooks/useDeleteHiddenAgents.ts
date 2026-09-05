import { useRef, useTransition } from 'react'
import { toast } from 'sonner'

import {
  useAppDispatch,
  useAppSelector,
  useAppStore,
} from '@/renderer/src/redux/hooks'
import {
  collectProtectedAgentSlotPaths,
  removeAllSymlinksFromAgent,
} from '@/renderer/src/redux/slices/agentsSlice'
import { selectHiddenAgentIds } from '@/renderer/src/redux/slices/settingsSlice'
import {
  clearHiddenAgentsDeleteReview,
  selectHiddenAgentsDeleteReview,
  setHiddenAgentsDeleteReview,
} from '@/renderer/src/redux/slices/uiSlice'
import { refreshAllData } from '@/renderer/src/redux/thunks'
import { getDeletableHiddenAgents } from '@/renderer/src/utils/getDeletableHiddenAgents'
import { pluralize } from '@/renderer/src/utils/pluralize'
import type { Agent } from '@/shared/types'

/**
 * Owns the reviewed folder snapshot and serial deletion when HiddenAgentsMenu opens or confirms its dialog.
 * @param agents - Currently installed hidden agents shown by the sidebar.
 * @returns Review state, protected count, pending status, and review/close/delete actions.
 * @example const deletion = useDeleteHiddenAgents(hiddenInstalled)
 */
export function useDeleteHiddenAgents(agents: Agent[]) {
  const dispatch = useAppDispatch()
  const store = useAppStore()
  const review = useAppSelector(selectHiddenAgentsDeleteReview)
  const [isDeleting, startDeletion] = useTransition()
  const deletingRef = useRef(false)
  const eligibleAgents = getDeletableHiddenAgents(agents)
  const protectedCount = useAppSelector((state) =>
    (review?.agents ?? []).reduce(
      (count, agent) =>
        count + collectProtectedAgentSlotPaths(state, agent).length,
      0,
    ),
  )

  /**
   * Captures only eligible folders when the menu's delete item is selected.
   * @returns Nothing; opens the confirmation when at least one folder is eligible.
   * @example deletion.openReview()
   */
  const openReview = (): void => {
    // Keep the reviewed filesystem identities stable until confirmation.
    if (eligibleAgents.length === 0 || deletingRef.current) return
    dispatch(
      setHiddenAgentsDeleteReview({
        agents: eligibleAgents,
        skippedCount: agents.length - eligibleAgents.length,
      }),
    )
  }

  /**
   * Dismisses the confirmation from Cancel, Escape, or the backdrop while idle.
   * @returns Nothing; active deletion keeps its dialog open.
   * @example deletion.closeReview()
   */
  const closeReview = (): void => {
    if (!deletingRef.current) dispatch(clearHiddenAgentsDeleteReview())
  }

  /**
   * Runs the confirmed folders through the existing guarded deletion thunk and reports partial outcomes.
   * @returns Nothing; the transition stays pending until every reviewed folder is attempted.
   * @example deletion.deleteAction()
   */
  const deleteAction = (): void => {
    // A synchronous guard prevents repeated activation before React repaints.
    if (!review || deletingRef.current) return
    deletingRef.current = true
    startDeletion(async () => {
      let completedCount = 0
      let deletedFromAgentCount = 0
      let removedCount = 0
      let preservedCount = 0
      const failures: string[] = []

      try {
        // Preserve review order and continue so one inaccessible folder cannot block the rest.
        for (const agent of review.agents) {
          // Settings can change visibility while the previous folder is awaiting IPC.
          if (!selectHiddenAgentIds(store.getState()).includes(agent.id)) {
            failures.push(`${agent.name}: no longer hidden; skipped`)
            continue
          }
          const result = await dispatch(removeAllSymlinksFromAgent(agent))
          if (removeAllSymlinksFromAgent.fulfilled.match(result)) {
            completedCount += 1
            // A successful protected-only review must not claim that any skills were deleted.
            if (result.payload.removedCount > 0) deletedFromAgentCount += 1
            removedCount += result.payload.removedCount
            preservedCount += result.payload.preservedCount
          } else {
            failures.push(`${agent.name}: ${result.error.message}`)
          }
        }

        if (completedCount > 0) {
          toast.success(
            deletedFromAgentCount > 0
              ? `Deleted skills from ${deletedFromAgentCount} hidden ${pluralize(deletedFromAgentCount, 'agent')}`
              : 'Hidden agent cleanup complete',
            {
              description: `Removed ${removedCount} items; kept ${preservedCount} protected`,
            },
          )
        }
        if (failures.length > 0) {
          toast.error('Some skills folders could not be deleted', {
            description: failures.join('; '),
          })
        }
      } finally {
        deletingRef.current = false
        dispatch(clearHiddenAgentsDeleteReview())
        // Even a rejected folder operation can have removed some unprotected children.
        refreshAllData(dispatch)
      }
    })
  }

  return {
    review,
    protectedCount,
    isDeleting,
    canDelete: eligibleAgents.length > 0,
    openReview,
    closeReview,
    deleteAction,
  }
}
