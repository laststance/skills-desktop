import { Copy, Loader2 } from 'lucide-react'
import React, { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/renderer/src/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/renderer/src/components/ui/dialog'
import { useAppDispatch, useAppSelector } from '@/renderer/src/redux/hooks'
import { selectSelectedVisibleSkillObjects } from '@/renderer/src/redux/selectors'
import {
  bulkCopyToAgents,
  selectBulkCopying,
  selectBulkCopyModalOpen,
  setBulkCopyModalOpen,
} from '@/renderer/src/redux/slices/skillsSlice'
import { refreshAllData } from '@/renderer/src/redux/thunks'
import { summarizeBulkCopyResult } from '@/renderer/src/utils/summarizeBulkCopyResult'
import type { AgentId } from '@/shared/types'

import { getTargetAgentsForSelection } from './agentSelectionHelpers'
import { AgentSelectionOption } from './AgentSelectionOption'

/**
 * Modal for copying every currently-selected skill to a chosen set of agents.
 *
 * The bulk analogue of `CopyToAgentsModal`: instead of one `skillToCopy`, it
 * reads the visible list selection (`selectSelectedVisibleSkillObjects`) and fans the
 * `copyToAgents` IPC out across it via the `bulkCopyToAgents` thunk. Global
 * view only — each skill's source is its own `skill.path` (mirrors the
 * AddSymlinkModal "copy files" path). Non-destructive, so the selection is left
 * intact after a successful copy. Open state lives in Redux
 * (`bulkCopyModalOpen`) like the sibling modals; the checked target agents are
 * local because they are ephemeral to one modal session.
 *
 * @example
 * <BulkCopyToAgentsModal />
 */
export const BulkCopyToAgentsModal = React.memo(
  function BulkCopyToAgentsModal(): React.ReactElement {
    const dispatch = useAppDispatch()
    const open = useAppSelector(selectBulkCopyModalOpen)
    const selectedSkills = useAppSelector(selectSelectedVisibleSkillObjects)
    const { items: agents } = useAppSelector((state) => state.agents)
    const bulkCopying = useAppSelector(selectBulkCopying)

    // Checked target agents — ephemeral to this modal session, so local state.
    const [checkedAgentIds, setCheckedAgentIds] = useState<AgentId[]>([])

    // Global view copies to any agent; the source skill has no "self" to exclude.
    const targetAgents = useMemo(
      () => getTargetAgentsForSelection(agents, { excludeAgentId: null }),
      [agents],
    )

    const handleAgentToggle = useCallback((agentId: AgentId): void => {
      setCheckedAgentIds((current) =>
        current.includes(agentId)
          ? current.filter((id) => id !== agentId)
          : [...current, agentId],
      )
    }, [])

    // Dismiss path (Cancel / Esc / overlay). Blocked mid-copy so a half-finished
    // batch is never abandoned; resets checks so the next open starts clean.
    const handleDismiss = useCallback((): void => {
      if (bulkCopying) return
      setCheckedAgentIds([])
      dispatch(setBulkCopyModalOpen(false))
    }, [bulkCopying, dispatch])

    const handleDialogOpenChange = useCallback(
      (next: boolean): void => {
        if (!next) handleDismiss()
      },
      [handleDismiss],
    )

    const handleCopy = useCallback(async (): Promise<void> => {
      // Re-entrancy guard: the button is disabled while `bulkCopying`, but a
      // fast double-click can fire two handlers before React re-renders the
      // disabled state. Bail here so a single click never dispatches twice and
      // races itself in main (lstat-then-write would see its own half-write).
      if (bulkCopying) return
      if (selectedSkills.length === 0 || checkedAgentIds.length === 0) return
      const items = selectedSkills.map((skill) => ({
        skillName: skill.name,
        sourcePath: skill.path,
      }))
      const result = await dispatch(
        bulkCopyToAgents({ items, agentIds: checkedAgentIds }),
      )
      if (bulkCopyToAgents.fulfilled.match(result)) {
        const content = summarizeBulkCopyResult(
          result.payload.perSkill,
          checkedAgentIds.length,
        )
        toast[content.tone](content.title, { description: content.description })
      } else {
        toast.error('Failed to copy skills', {
          description: result.error?.message || 'An unexpected error occurred',
        })
      }
      // refreshAllData on success pulls the new symlinks; on failure it clears
      // any stale skills error so the list does not stay stuck on the error view.
      refreshAllData(dispatch)
      // Selection is preserved (non-destructive); only the local checks reset.
      setCheckedAgentIds([])
      dispatch(setBulkCopyModalOpen(false))
    }, [dispatch, selectedSkills, checkedAgentIds, bulkCopying])

    const skillCount = selectedSkills.length
    const skillWord = skillCount === 1 ? 'skill' : 'skills'
    const canCopy = skillCount > 0 && checkedAgentIds.length > 0 && !bulkCopying

    return (
      <Dialog open={open} onOpenChange={handleDialogOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Copy className="h-4 w-4" />
              Copy to Agents
            </DialogTitle>
            <DialogDescription>
              Copy{' '}
              <strong>
                {skillCount} selected {skillWord}
              </strong>{' '}
              to the chosen agents. The originals are left untouched.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-64 overflow-y-auto space-y-2 py-2">
            {targetAgents.map((agent) => (
              <AgentSelectionOption
                key={agent.id}
                agentId={agent.id}
                checkboxId={`bulk-copy-agent-${agent.id}`}
                name={agent.name}
                checked={checkedAgentIds.includes(agent.id)}
                disabled={bulkCopying}
                hoverClassName="hover:bg-accent transition-colors"
                onToggle={handleAgentToggle}
              />
            ))}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={handleDismiss}
              disabled={bulkCopying}
            >
              Cancel
            </Button>
            <Button onClick={handleCopy} disabled={!canCopy}>
              {bulkCopying && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {bulkCopying
                ? 'Copying...'
                : `Copy ${skillCount} ${skillWord} to ${checkedAgentIds.length} agent(s)`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  },
)
