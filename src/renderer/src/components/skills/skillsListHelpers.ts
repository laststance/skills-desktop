import { match } from 'ts-pattern'

import type { AgentId, RepositoryId } from '../../../../shared/types'
import type { SkillTypeFilter } from '../../redux/slices/uiSlice'

interface EmptyMessageContext {
  searchQuery: string
  selectedSource: RepositoryId | null
  selectedAgentId: AgentId | null
  skillTypeFilter: SkillTypeFilter
}

/**
 * Compute the empty-state message for SkillsList based on which filters are
 * currently narrowing the result. The skills list participates in four
 * orthogonal filters (search query, source-repo pill, selected agent,
 * skill-type pill). When the intersection produces zero rows, the user
 * needs a message that names the *last action* they took, not a catch-all
 * "no skills match your filter."
 *
 * Priority order — search > source > (agent + type) > agent > fallback —
 * mirrors the user's mental model: "I just typed in the search box → the
 * search is what hid my rows." Source pill takes precedence over the agent
 * card because clicking a repo link from a skill card is a more recent,
 * more specific action than the persistent agent-tab selection.
 *
 * Why ts-pattern: the `match().with().otherwise()` chain forces the priority
 * order to be data-shaped (top-down), not nesting-shaped (deeply ternaried).
 * Adding a new filter axis means inserting one `.with(...)` line in the
 * right slot, not unfurling an N+1 deep ternary.
 *
 * @param ctx - Snapshot of the active filter values from Redux.
 * @returns
 * - When `searchQuery` is non-empty: `"No skills match your search"`
 * - When only `selectedSource` is set: `"No skills from <repo>"`
 * - When `selectedAgentId` is set AND `skillTypeFilter !== 'all'`:
 *   `"No <symlinked|local> skills for this agent"`
 * - When only `selectedAgentId` is set: `"No skills installed for this agent"`
 * - Otherwise: `"No skills match your filter"`
 *
 * @example
 * getEmptyListMessage({
 *   searchQuery: '',
 *   selectedSource: repositoryId('vercel-labs/skills'),
 *   selectedAgentId: null,
 *   skillTypeFilter: 'all',
 * })
 * // => "No skills from vercel-labs/skills"
 *
 * @example
 * getEmptyListMessage({
 *   searchQuery: '',
 *   selectedSource: null,
 *   selectedAgentId: 'cursor',
 *   skillTypeFilter: 'local',
 * })
 * // => "No local skills for this agent"
 */
export function getEmptyListMessage(ctx: EmptyMessageContext): string {
  return match({
    hasSearchQuery: ctx.searchQuery.length > 0,
    hasSelectedSource: ctx.selectedSource !== null,
    hasSelectedAgent: ctx.selectedAgentId !== null,
    hasTypeNarrow: ctx.skillTypeFilter !== 'all',
  })
    .with({ hasSearchQuery: true }, () => 'No skills match your search')
    .with(
      { hasSelectedSource: true },
      () => `No skills from ${ctx.selectedSource}`,
    )
    .with(
      { hasSelectedAgent: true, hasTypeNarrow: true },
      () => `No ${ctx.skillTypeFilter} skills for this agent`,
    )
    .with(
      { hasSelectedAgent: true },
      () => 'No skills installed for this agent',
    )
    .otherwise(() => 'No skills match your filter')
}
