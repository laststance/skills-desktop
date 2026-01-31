/**
 * IPC channel names for main <-> renderer communication
 */
export const IPC_CHANNELS = {
  // Skills
  SKILLS_GET_ALL: 'skills:getAll',

  // Agents
  AGENTS_GET_ALL: 'agents:getAll',

  // Source
  SOURCE_GET_STATS: 'source:getStats',

  // Files
  FILES_LIST: 'files:list',
  FILES_READ: 'files:read',

  // Skills CLI (Marketplace)
  SKILLS_CLI_SEARCH: 'skills:cli:search',
  SKILLS_CLI_INSTALL: 'skills:cli:install',
  SKILLS_CLI_REMOVE: 'skills:cli:remove',
  SKILLS_CLI_CANCEL: 'skills:cli:cancel',
  SKILLS_CLI_PROGRESS: 'skills:cli:progress',
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]
