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
  FILES_READ_BINARY: 'files:readBinary',

  // Skills CLI (Marketplace)
  SKILLS_CLI_SEARCH: 'skills:cli:search',
  SKILLS_CLI_INSTALL: 'skills:cli:install',
  SKILLS_CLI_CANCEL: 'skills:cli:cancel',
  SKILLS_CLI_PROGRESS: 'skills:cli:progress',

  // Marketplace Leaderboard
  MARKETPLACE_LEADERBOARD: 'marketplace:leaderboard',

  // Skills management
  SKILLS_UNLINK_FROM_AGENT: 'skills:unlinkFromAgent',
  SKILLS_REMOVE_ALL_FROM_AGENT: 'skills:removeAllFromAgent',
  SKILLS_DELETE: 'skills:deleteSkill',
  SKILLS_CREATE_SYMLINKS: 'skills:createSymlinks',
  SKILLS_COPY_TO_AGENTS: 'skills:copyToAgents',
  // Skills bulk delete + undo
  SKILLS_DELETE_BATCH: 'skills:deleteSkills',
  SKILLS_UNLINK_MANY_FROM_AGENT: 'skills:unlinkManyFromAgent',
  SKILLS_RESTORE_DELETED: 'skills:restoreDeletedSkill',
  SKILLS_DELETE_PROGRESS: 'skills:deleteProgress',

  // Sync
  SYNC_PREVIEW: 'sync:preview',
  SYNC_EXECUTE: 'sync:execute',

  // Shell (main-process-only APIs exposed via IPC)
  SHELL_OPEN_EXTERNAL: 'shell:openExternal',

  // Update
  UPDATE_DOWNLOAD: 'update:download',
  UPDATE_INSTALL: 'update:install',
  UPDATE_CHECK: 'update:check',
  UPDATE_CHECKING: 'update:checking',
  UPDATE_AVAILABLE: 'update:available',
  UPDATE_NOT_AVAILABLE: 'update:not-available',
  UPDATE_PROGRESS: 'update:progress',
  UPDATE_DOWNLOADED: 'update:downloaded',
  UPDATE_ERROR: 'update:error',
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]
