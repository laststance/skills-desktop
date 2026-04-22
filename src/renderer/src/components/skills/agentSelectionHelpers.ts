import type { Agent, AgentId } from '../../../../shared/types'

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
