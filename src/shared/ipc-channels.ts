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
  SKILLS_CLEAR_ORPHAN_SYMLINKS: 'skills:clearOrphanSymlinks',
  SKILLS_CLEAR_BROKEN_SYMLINK_SLOTS: 'skills:clearBrokenSymlinkSlots',
  SKILLS_UNLINK_MANY_FROM_AGENT: 'skills:unlinkManyFromAgent',
  SKILLS_RESTORE_DELETED: 'skills:restoreDeletedSkill',
  SKILLS_DELETE_PROGRESS: 'skills:deleteProgress',

  // Sync
  SYNC_PREVIEW: 'sync:preview',
  SYNC_EXECUTE: 'sync:execute',

  // Shell (main-process-only APIs exposed via IPC)
  SHELL_OPEN_EXTERNAL: 'shell:openExternal',

  // App CLI command (~/.local/bin/skills-desktop)
  CLI_COMMAND_GET_STATUS: 'cliCommand:getStatus',
  CLI_COMMAND_INSTALL: 'cliCommand:install',
  CLI_COMMAND_REMOVE: 'cliCommand:remove',

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

  // Settings window
  SETTINGS_OPEN: 'settings:open',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_CHANGED: 'settings:changed',

  // Activity timeline (dashboard) — append-only event log persisted under
  // userData. `list` hydrates the widget on mount; `changed` broadcasts the
  // new log after each recorded add/remove/sync.
  ACTIVITY_LIST: 'activity:list',
  ACTIVITY_CHANGED: 'activity:changed',

  // Folder actions (Reveal in Finder, Open in Terminal)
  FOLDER_REVEAL_IN_FINDER: 'folder:revealInFinder',
  FOLDER_OPEN_IN_TERMINAL: 'folder:openInTerminal',

  // Main window introspection — used by Settings → "Use current window size"
  // to capture the live bounds before persisting them as the launch size.
  WINDOW_GET_MAIN_BOUNDS: 'window:getMainBounds',
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]
