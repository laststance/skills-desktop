import type { Agent, AgentId, SymlinkInfo } from '../../../../shared/types'

/**
 * Why an agent row is unavailable as a destination in Add/Copy flows.
 * - `linked`: a valid symlink already exists
 * - `local`: a real directory already exists in the agent's skills dir
 * - `broken`: a broken symlink occupies the destination path
 * - `already-exists`: some other occupied entry exists
 */
export type OccupiedAgentReason =
  | 'linked'
  | 'local'
  | 'broken'
  | 'already-exists'

const OCCUPIED_AGENT_REASON_LABELS: Record<OccupiedAgentReason, string> = {
  linked: 'linked',
  local: 'local',
  broken: 'broken link',
  'already-exists': 'already exists',
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
 * @example
 * getOccupiedAgentReasonLabel('already-exists') // => "already exists"
 */
export function getOccupiedAgentReasonLabel(
  occupiedReason: OccupiedAgentReason,
): string {
  return OCCUPIED_AGENT_REASON_LABELS[occupiedReason]
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
