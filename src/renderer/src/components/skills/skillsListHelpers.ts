import { match } from 'ts-pattern'

import type {
  ExcludableSkillTypeFilter,
  SkillTypeFilter,
} from '@/renderer/src/redux/slices/uiSlice'
import type { AgentId, RepositoryId } from '@/shared/types'

interface EmptyMessageContext {
  searchQuery: string
  selectedSources: RepositoryId[]
  selectedAgentId: AgentId | null
  skillTypeFilter: SkillTypeFilter
  excludedSkillTypeFilters?: ExcludableSkillTypeFilter[]
}

const SKILL_TYPE_FILTER_LABELS = {
  all: 'all',
  symlinked: 'symlinked',
  local: 'local',
  gstack: 'G-Stack',
  orphan: 'orphan',
} as const satisfies Record<SkillTypeFilter, string>

const EXCLUDED_SKILL_TYPE_FILTER_LABELS = {
  symlinked: 'symlinked',
  local: 'local',
  gstack: 'G-Stack',
  orphan: 'orphan',
} as const satisfies Record<ExcludableSkillTypeFilter, string>

/**
 * Join active exclude labels in compact English for empty-state copy.
 * @param excludedSkillTypeFilters - Excluded type filters in UI state order.
 * @returns Human-readable label list, e.g. `"local and G-Stack"`.
 * @example
 * formatExcludedSkillTypeFilters(['local', 'gstack'])
 * // => "local and G-Stack"
 */
function formatExcludedSkillTypeFilters(
  excludedSkillTypeFilters: ExcludableSkillTypeFilter[],
): string {
  const labels = excludedSkillTypeFilters.map(
    (filter) => EXCLUDED_SKILL_TYPE_FILTER_LABELS[filter],
  )
  if (labels.length <= 1) return labels[0] ?? ''
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`
  return `${labels.slice(0, -1).join(', ')}, and ${labels.at(-1)}`
}

/**
 * Add exclude context to an empty-state sentence only when an exclude is active.
 * @param message - Base empty-state sentence chosen by the priority ladder.
 * @param excludedSkillTypeFilters - Active exclude filters.
 * @returns Sentence with optional `" while excluding ..."` suffix.
 * @example
 * withExcludeContext('No skills installed for this agent', ['local'])
 * // => "No skills installed for this agent while excluding local"
 */
function withExcludeContext(
  message: string,
  excludedSkillTypeFilters: ExcludableSkillTypeFilter[],
): string {
  if (excludedSkillTypeFilters.length === 0) return message
  return `${message} while excluding ${formatExcludedSkillTypeFilters(
    excludedSkillTypeFilters,
  )}`
}

/**
 * Render the repo phrase for empty-state copy from the active include-filter.
 * @param selectedSources - Active repository include-filter (non-empty when called).
 * @returns
 * - exactly 1 repo → the repo id, e.g. `"vercel-labs/skills"`
 * - ≥2 repos → `"the selected repositories"`
 * @example
 * formatSelectedSourcesPhrase([repositoryId('vercel-labs/skills')])
 * // => "vercel-labs/skills"
 */
function formatSelectedSourcesPhrase(selectedSources: RepositoryId[]): string {
  if (selectedSources.length === 1) return selectedSources[0]
  return 'the selected repositories'
}

/**
 * Compute the empty-state message for SkillsList based on which filters are
 * currently narrowing the result. The skills list participates in four
 * orthogonal filters (search query, source-repo include filter, selected
 * agent, skill-type pill). When the intersection produces zero rows, the
 * user needs a message that names the *last action* they took, not a
 * catch-all "no skills match your filter."
 *
 * Priority order — search > source > (agent + type) > agent > fallback —
 * mirrors the user's mental model: "I just typed in the search box → the
 * search is what hid my rows." The source filter takes precedence over the
 * agent card because narrowing to specific repositories is a more recent,
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
 * - When `selectedSources` is non-empty: `"No skills from <repo>"` (or
 *   `"the selected repositories"` when more than one repo is selected)
 * - When `selectedAgentId` is set AND `skillTypeFilter !== 'all'`:
 *   `"No <symlinked|local|G-Stack|orphan> skills for this agent"`
 * - When only `selectedAgentId` is set: `"No skills installed for this agent"`
 * - Otherwise: `"No skills match your filter"`
 * Active excludes append `" while excluding <types>"` to whichever branch wins.
 *
 * @example
 * getEmptyListMessage({
 *   searchQuery: '',
 *   selectedSources: [repositoryId('vercel-labs/skills')],
 *   selectedAgentId: null,
 *   skillTypeFilter: 'all',
 *   excludedSkillTypeFilters: [],
 * })
 * // => "No skills from vercel-labs/skills"
 *
 * @example
 * getEmptyListMessage({
 *   searchQuery: '',
 *   selectedSources: [],
 *   selectedAgentId: 'cursor',
 *   skillTypeFilter: 'local',
 *   excludedSkillTypeFilters: ['gstack'],
 * })
 * // => "No local skills for this agent while excluding G-Stack"
 */
export function getEmptyListMessage(ctx: EmptyMessageContext): string {
  const baseMessage = match({
    hasSearchQuery: ctx.searchQuery.length > 0,
    hasSelectedSource: ctx.selectedSources.length > 0,
    hasSelectedAgent: ctx.selectedAgentId !== null,
    hasTypeNarrow: ctx.skillTypeFilter !== 'all',
  })
    .with(
      { hasSearchQuery: true, hasSelectedSource: true },
      () =>
        `No skills match your search in ${formatSelectedSourcesPhrase(
          ctx.selectedSources,
        )}`,
    )
    .with({ hasSearchQuery: true }, () => 'No skills match your search')
    .with(
      { hasSelectedSource: true },
      () =>
        `No skills from ${formatSelectedSourcesPhrase(ctx.selectedSources)}`,
    )
    .with(
      { hasSelectedAgent: true, hasTypeNarrow: true },
      () =>
        `No ${SKILL_TYPE_FILTER_LABELS[ctx.skillTypeFilter]} skills for this agent`,
    )
    .with(
      { hasSelectedAgent: true },
      () => 'No skills installed for this agent',
    )
    .otherwise(() => 'No skills match your filter')

  return withExcludeContext(baseMessage, ctx.excludedSkillTypeFilters ?? [])
}
