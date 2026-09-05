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
  clearAgentFoldersDeleteReview,
  selectAgentFoldersDeleteReview,
  setAgentFoldersDeleteReview,
  type AgentFolderGroup,
} from '@/renderer/src/redux/slices/uiSlice'
import { refreshAllData } from '@/renderer/src/redux/thunks'
import { getDeletableAgentFolders } from '@/renderer/src/utils/getDeletableAgentFolders'
import { pluralize } from '@/renderer/src/utils/pluralize'
import type { Agent } from '@/shared/types'

/**
 * Owns the reviewed folder snapshot and serial deletion when AgentFoldersMenu opens or confirms its dialog.
 * @param agents - Current agents in the sidebar group.
 * @param group - Hidden skills folders or not-installed agents' empty parent folders.
 * @returns Review state, protected count, pending status, and review/close/delete actions.
 * @example const deletion = useDeleteAgentFolders(hiddenInstalled, 'hidden')
 */
export function useDeleteAgentFolders(
  agents: Agent[],
  group: AgentFolderGroup,
) {
  const dispatch = useAppDispatch()
  const store = useAppStore()
  const activeReview = useAppSelector(selectAgentFoldersDeleteReview)
  const review = activeReview?.group === group ? activeReview : null
  const [isDeleting, startDeletion] = useTransition()
  const deletingRef = useRef(false)
  const eligibleAgents = getDeletableAgentFolders(agents, group)
  const protectedCount = useAppSelector((state) =>
    (group === 'hidden' ? (review?.agents ?? []) : []).reduce(
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
      setAgentFoldersDeleteReview({
        group,
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
    if (!deletingRef.current) dispatch(clearAgentFoldersDeleteReview())
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
          // Empty-parent cleanup has its own IPC guard; installing skills makes the folder ineligible.
          if (group === 'unused') {
            try {
              const currentAgent = store
                .getState()
                .agents.items.find((candidate) => candidate.id === agent.id)
              if (currentAgent?.exists || !agent.emptyParentFolder) {
                failures.push(`${agent.name}: no longer eligible; skipped`)
                continue
              }
              const result = await window.electron.agents.removeEmptyFolder({
                agentId: agent.id,
                ...agent.emptyParentFolder,
              })
              if (result.success) {
                completedCount += 1
                removedCount += Number(result.deleted)
              } else {
                failures.push(`${agent.name}: ${result.error}`)
              }
            } catch (error) {
              failures.push(
                `${agent.name}: ${error instanceof Error ? error.message : 'Folder deletion failed'}`,
              )
            }
            continue
          }
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
            group === 'unused'
              ? `Deleted ${removedCount} empty agent ${pluralize(removedCount, 'folder')}`
              : deletedFromAgentCount > 0
                ? `Deleted skills from ${deletedFromAgentCount} hidden ${pluralize(deletedFromAgentCount, 'agent')}`
                : 'Hidden agent cleanup complete',
            {
              description:
                group === 'unused'
                  ? 'Folders containing files, settings, history, or skills were kept.'
                  : `Removed ${removedCount} items; kept ${preservedCount} protected`,
            },
          )
        }
        if (failures.length > 0) {
          toast.error(
            group === 'unused'
              ? 'Some empty agent folders could not be deleted'
              : 'Some skills folders could not be deleted',
            {
              description: failures.join('; '),
            },
          )
        }
      } finally {
        deletingRef.current = false
        dispatch(clearAgentFoldersDeleteReview())
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
