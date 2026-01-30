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
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]
