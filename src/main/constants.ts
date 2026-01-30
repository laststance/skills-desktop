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
