import { toast } from 'sonner'

import { copyToAgents } from '@/renderer/src/redux/slices/skillsSlice'
import type { AppDispatch } from '@/renderer/src/redux/store'
import { refreshAllData } from '@/renderer/src/redux/thunks'
import type { AbsolutePath, AgentId, Skill } from '@/shared/types'

/**
 * Dispatch the `copyToAgents` thunk and surface its outcome via Sonner toasts.
 *
 * Shared between `AddSymlinkModal` (the file-copy alternative to symlinking)
 * and `CopyToAgentsModal` (the primary copy entry point). Both modals
 * previously inlined an identical `dispatch → match-fulfilled → 3-branch
 * toast → refreshAllData` block; centralising it here keeps the success /
 * partial-failure / error wording in lock-step with the thunk contract.
 *
 * `refreshAllData` always runs on exit:
 * - on success it pulls the updated skills list,
 * - on failure it clears any stale `state.skills.error` (via the
 *   `fetchSkills.pending` reducer) so `SkillsList` does not stay stuck on
 *   the error view.
 *
 * @param dispatch - store dispatch from `useAppDispatch()`
 * @param args.skill - skill being copied (used for the success description)
 * @param args.sourcePath - absolute path of the source skill on disk
 * @param args.agentIds - target agent ids (must be non-empty; caller guards)
 *
 * @example
 * await copyToAgentsWithToast(dispatch, {
 *   skill: skillToCopy,
 *   sourcePath: skillToCopy.path,
 *   agentIds: ['claude', 'codex'],
 * })
 */
export async function copyToAgentsWithToast(
  dispatch: AppDispatch,
  args: {
    skill: Skill
    sourcePath: AbsolutePath
    agentIds: readonly AgentId[]
  },
): Promise<void> {
  const result = await dispatch(
    copyToAgents({
      skill: args.skill,
      sourcePath: args.sourcePath,
      agentIds: [...args.agentIds],
    }),
  )

  if (copyToAgents.fulfilled.match(result)) {
    if (result.payload.failures.length > 0) {
      toast.warning(
        `Copied to ${result.payload.copied} agent(s), ${result.payload.failures.length} failed`,
        {
          description: result.payload.failures
            .map((failure) => `${failure.agentId}: ${failure.error}`)
            .join(', '),
        },
      )
    } else {
      toast.success(`Copied to ${result.payload.copied} agent(s)`, {
        description: `${args.skill.name} copied successfully`,
      })
    }
  } else {
    toast.error('Failed to copy skill', {
      description: result.error?.message || 'An unexpected error occurred',
    })
  }

  refreshAllData(dispatch)
}
