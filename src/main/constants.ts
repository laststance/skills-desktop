import { homedir } from 'os'
import { join } from 'path'

import { AGENT_DEFINITIONS } from '../shared/constants'

/**
 * Source directory for all skills
 */
export const SOURCE_DIR = join(homedir(), '.agents', 'skills')

/**
 * Supported AI agents with their full skills directory paths
 */
export const AGENTS = AGENT_DEFINITIONS.map((agent) => ({
  id: agent.id,
  name: agent.name,
  path: join(homedir(), agent.dir, 'skills'),
}))

/**
 * Look up an agent by its internal ID.
 * Used by IPC handlers that receive an agentId from the renderer.
 * @param agentId - The agent's internal identifier
 * @returns The matching agent or undefined if not found
 * @example
 * findAgentById('claude')  // => { id: 'claude', name: 'Claude Code', path: '...' }
 * findAgentById('unknown') // => undefined
 */
export function findAgentById(
  agentId: string,
): (typeof AGENTS)[number] | undefined {
  return AGENTS.find((a) => a.id === agentId)
}
