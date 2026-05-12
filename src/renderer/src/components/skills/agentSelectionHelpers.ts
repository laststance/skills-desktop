import type { Agent, AgentId, SymlinkInfo } from '@/shared/types'

/**
 * Why an agent row is unavailable as a destination in Add/Copy flows.
 * - `linked`: a valid symlink already exists
 * - `local`: a real directory already exists in the agent's skills dir
 * - `broken`: a broken symlink occupies the destination path
 */
export type OccupiedAgentReason = 'linked' | 'local' | 'broken'

export interface CopyAgentOptionViewModel {
  agentId: AgentId
  name: Agent['name']
  checked: boolean
  disabled: boolean
  secondaryLabel?: string
}

const OCCUPIED_AGENT_REASON_LABELS: Record<OccupiedAgentReason, string> = {
  linked: 'linked',
  local: 'local',
  broken: 'broken link',
}

/**
 * Returns target-agent candidates for Add/Copy modals.
 * Installed agents are listed first for quick access, then not-installed
 * agents so users can still prepare skills directories ahead of installation.
 *
 * @param agents - Full agent list from Redux state.
 * @param options - Optional filtering options.
 * @returns
 * - Agents eligible for selection, ordered as installed -> not installed.
 *
 * @example
 * getTargetAgentsForSelection(
 *   [
 *     { id: 'cursor', exists: true } as Agent,
 *     { id: 'amp', exists: false } as Agent,
 *   ],
 * )
 * // => [cursor, amp]
 *
 * @example
 * getTargetAgentsForSelection(agents, { excludeAgentId: 'claude-code' })
 * // => all except claude-code
 */
export function getTargetAgentsForSelection(
  agents: Agent[],
  options: { excludeAgentId?: AgentId | null } = {},
): Agent[] {
  const { excludeAgentId = null } = options
  const filteredAgents =
    excludeAgentId === null
      ? agents
      : agents.filter((agent) => agent.id !== excludeAgentId)
  const installedAgents = filteredAgents.filter((agent) => agent.exists)
  const notInstalledAgents = filteredAgents.filter((agent) => !agent.exists)

  return [...installedAgents, ...notInstalledAgents]
}

/**
 * Collapse per-agent skill state into one occupancy reason map for selection UIs.
 * Any existing destination entry should block Add/Copy because the main-process
 * filesystem operations would otherwise fail with `EEXIST`.
 *
 * @param symlinks - Per-agent skill state from the scanned Skill model.
 * @returns AgentId -> occupied reason for every blocked destination.
 * @example
 * getOccupiedAgentReasonById([
 *   { agentId: 'cursor', status: 'valid', isLocal: false } as SymlinkInfo,
 *   { agentId: 'codex', status: 'broken', isLocal: false } as SymlinkInfo,
 * ])
 * // => Map { 'cursor' => 'linked', 'codex' => 'broken' }
 */
export function getOccupiedAgentReasonById(
  symlinks: SymlinkInfo[],
): Map<AgentId, OccupiedAgentReason> {
  const occupiedAgentReasonById = new Map<AgentId, OccupiedAgentReason>()

  for (const symlink of symlinks) {
    const occupiedReason = getOccupiedAgentReason(symlink)
    if (occupiedReason) {
      occupiedAgentReasonById.set(symlink.agentId, occupiedReason)
    }
  }

  return occupiedAgentReasonById
}

/**
 * Convert an occupied-agent reason into the UI label shown beside the agent name.
 * @param occupiedReason - Reason the destination is unavailable.
 * @returns Human-readable status text for the modal row.
 * @example
 * getOccupiedAgentReasonLabel('linked') // => "linked"
 */
function getOccupiedAgentReasonLabel(
  occupiedReason: OccupiedAgentReason,
): string {
  return OCCUPIED_AGENT_REASON_LABELS[occupiedReason]
}

/**
 * Pick the secondary label shown beside an Add modal agent row.
 * Occupancy outranks the "not installed" hint because it explains why the
 * destination cannot be selected.
 *
 * @param params.occupiedReason - Existing destination state, if any.
 * @param params.exists - Whether the agent's skills directory exists.
 * @returns Human-readable status text, or undefined for a selectable row.
 * @example
 * getAddAgentSecondaryLabel({ occupiedReason: 'broken', exists: true }) // => "broken link"
 */
export function getAddAgentSecondaryLabel(params: {
  occupiedReason: OccupiedAgentReason | undefined
  exists: boolean
}): string | undefined {
  const { occupiedReason, exists } = params

  if (occupiedReason !== undefined) {
    return getOccupiedAgentReasonLabel(occupiedReason)
  }

  if (!exists) {
    return 'not installed'
  }

  return undefined
}

/**
 * Build the presentational row props for CopyToAgentsModal.
 * This keeps occupancy, disabled, and secondary-label branching outside JSX so
 * the modal remains mostly markup and this decision table stays unit-testable.
 *
 * @param agent - Target agent row candidate.
 * @param options.occupiedAgentReasonById - Destination occupancy lookup.
 * @param options.selectedAgentIds - Agent ids currently checked in Redux.
 * @param options.copying - Whether a copy IPC round-trip is in flight.
 * @param options.isSourceUnavailable - Whether the selected source path is valid.
 * @returns Render-ready props for CopyToAgentOption.
 * @example
 * buildCopyAgentOptionViewModel(agent, {
 *   occupiedAgentReasonById: new Map(),
 *   selectedAgentIds: ['codex'],
 *   copying: false,
 *   isSourceUnavailable: false,
 * })
 */
export function buildCopyAgentOptionViewModel(
  agent: Agent,
  options: {
    occupiedAgentReasonById: ReadonlyMap<AgentId, OccupiedAgentReason>
    selectedAgentIds: readonly AgentId[]
    copying: boolean
    isSourceUnavailable: boolean
  },
): CopyAgentOptionViewModel {
  const occupiedReason = options.occupiedAgentReasonById.get(agent.id)
  const isOccupied = occupiedReason !== undefined
  return {
    agentId: agent.id,
    name: agent.name,
    checked: isOccupied || options.selectedAgentIds.includes(agent.id),
    disabled: isOccupied || options.copying || options.isSourceUnavailable,
    secondaryLabel: getCopyAgentOptionSecondaryLabel(agent, occupiedReason),
  }
}

/**
 * Determine whether a single symlink row means the destination path is occupied.
 * @param symlink - One agent's relationship to the current skill.
 * @returns
 * - `linked`: valid symlink already present
 * - `local`: local skill directory already present
 * - `broken`: broken symlink still occupies the destination path
 * - `null`: destination is free (`missing`)
 * @example
 * getOccupiedAgentReason({ status: 'broken', isLocal: false } as SymlinkInfo)
 * // => "broken"
 */
function getOccupiedAgentReason(
  symlink: SymlinkInfo,
): OccupiedAgentReason | null {
  if (symlink.isLocal) {
    return 'local'
  }

  if (symlink.status === 'valid') {
    return 'linked'
  }

  if (symlink.status === 'broken') {
    return 'broken'
  }

  return null
}

/**
 * Pick the single secondary label shown beside a Copy modal agent row.
 * Occupied destinations outrank the "not installed" hint because they explain
 * why the destination cannot be selected.
 */
function getCopyAgentOptionSecondaryLabel(
  agent: Agent,
  occupiedReason: OccupiedAgentReason | undefined,
): string | undefined {
  if (occupiedReason !== undefined) {
    return getOccupiedAgentReasonLabel(occupiedReason)
  }

  if (!agent.exists) {
    return 'not installed'
  }

  return undefined
}
