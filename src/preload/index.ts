import { contextBridge } from 'electron'

import { IPC_CHANNELS } from '../shared/ipc-channels'
import type {
  AbsolutePath,
  CopyToAgentsOptions,
  CreateSymlinksOptions,
  DeleteProgressPayload,
  DeleteSkillOptions,
  DeleteSkillsOptions,
  DownloadProgress,
  HttpUrl,
  InstallOptions,
  InstallProgress,
  RankingFilter,
  RemoveAllFromAgentOptions,
  RestoreDeletedSkillOptions,
  SearchQuery,
  SyncExecuteOptions,
  UnlinkFromAgentOptions,
  UnlinkManyFromAgentOptions,
  UpdateInfo,
} from '../shared/types'

import { createIpcListener } from './ipcListener'
import { recordedIpcEvents } from './ipcRecorder'
import { typedInvoke } from './typedInvoke'

// Expose protected methods to renderer process
contextBridge.exposeInMainWorld('electron', {
  // Shell API (external links).
  // Must go through IPC: the `shell` module is unavailable in sandboxed
  // preload scripts and is only callable from the main process.
  // URL shape (http/https only) is enforced by the Zod schema at the handler.
  shell: {
    openExternal: async (url: HttpUrl) =>
      typedInvoke('shell:openExternal', url),
  },
  // Skills API
  skills: {
    getAll: async () => typedInvoke('skills:getAll'),
    unlinkFromAgent: async (options: UnlinkFromAgentOptions) =>
      typedInvoke('skills:unlinkFromAgent', options),
    removeAllFromAgent: async (options: RemoveAllFromAgentOptions) =>
      typedInvoke('skills:removeAllFromAgent', options),
    deleteSkill: async (options: DeleteSkillOptions) =>
      typedInvoke('skills:deleteSkill', options),
    createSymlinks: async (options: CreateSymlinksOptions) =>
      typedInvoke('skills:createSymlinks', options),
    copyToAgents: async (options: CopyToAgentsOptions) =>
      typedInvoke('skills:copyToAgents', options),
    // Bulk delete + undo (Section E of the bulk-delete plan).
    // deleteSkills runs serially in main; batches of >=10 emit progress events.
    deleteSkills: async (options: DeleteSkillsOptions) =>
      typedInvoke('skills:deleteSkills', options),
    unlinkManyFromAgent: async (options: UnlinkManyFromAgentOptions) =>
      typedInvoke('skills:unlinkManyFromAgent', options),
    restoreDeletedSkill: async (options: RestoreDeletedSkillOptions) =>
      typedInvoke('skills:restoreDeletedSkill', options),
    onDeleteProgress: createIpcListener<DeleteProgressPayload>(
      IPC_CHANNELS.SKILLS_DELETE_PROGRESS,
    ),
  },
  // Agents API
  agents: {
    getAll: async () => typedInvoke('agents:getAll'),
  },
  // Source API
  source: {
    getStats: async () => typedInvoke('source:getStats'),
  },
  // Files API
  files: {
    list: async (skillPath: AbsolutePath) =>
      typedInvoke('files:list', skillPath),
    read: async (filePath: AbsolutePath) => typedInvoke('files:read', filePath),
    readBinary: async (filePath: AbsolutePath) =>
      typedInvoke('files:readBinary', filePath),
  },
  // Update API
  update: {
    // Event listeners
    onChecking: createIpcListener<void>(IPC_CHANNELS.UPDATE_CHECKING),
    onAvailable: createIpcListener<UpdateInfo>(IPC_CHANNELS.UPDATE_AVAILABLE),
    onNotAvailable: createIpcListener<void>(IPC_CHANNELS.UPDATE_NOT_AVAILABLE),
    onProgress: createIpcListener<DownloadProgress>(
      IPC_CHANNELS.UPDATE_PROGRESS,
    ),
    onDownloaded: createIpcListener<UpdateInfo>(IPC_CHANNELS.UPDATE_DOWNLOADED),
    onError: createIpcListener<{ message: string }>(IPC_CHANNELS.UPDATE_ERROR),
    // Actions
    download: async () => typedInvoke('update:download'),
    install: async () => typedInvoke('update:install'),
    check: async () => typedInvoke('update:check'),
  },
  // Skills CLI API (Marketplace)
  skillsCli: {
    search: async (query: SearchQuery) =>
      typedInvoke('skills:cli:search', query),
    install: async (options: InstallOptions) =>
      typedInvoke('skills:cli:install', options),
    cancel: async () => typedInvoke('skills:cli:cancel'),
    onProgress: createIpcListener<InstallProgress>(
      IPC_CHANNELS.SKILLS_CLI_PROGRESS,
    ),
  },
  // Marketplace Leaderboard
  marketplace: {
    leaderboard: async (options: { filter: RankingFilter }) =>
      typedInvoke('marketplace:leaderboard', options),
  },
  // Sync API
  sync: {
    preview: async () => typedInvoke('sync:preview'),
    execute: async (options: SyncExecuteOptions) =>
      typedInvoke('sync:execute', options),
  },
})

// E2E-only escape hatch from the typed `electron.*` IPC contract above.
//
// Why this lives outside the contract: Phase-2 specs need to assert on raw
// IPC traffic (e.g. "SKILLS_DELETE_PROGRESS fired exactly 10 times for the
// bulk-delete batch at the threshold"). Routing those assertions through the
// typed surface would force every channel to ship an `events()` accessor in
// production code purely to support tests — leaking test concerns into the
// production preload API.
//
// Why this is safe:
//   1. `__E2E_BUILD__` is a Vite `define` build-time constant. In production
//      builds the constant resolves to `false`, so this `if` block becomes
//      `if (false) { ... }` and the `contextBridge.exposeInMainWorld` call —
//      including the entire `recordedIpcEvents` import chain — is removed by
//      tree-shaking. Verify with `pnpm build && grep -r __ipcEvents__ out/`
//      (expected: zero matches).
//   2. The recorder only mirrors channels we already invoke from the renderer;
//      it cannot be used to invoke new channels or escalate privilege.
//
// If you find yourself reaching for this bridge from production code paths,
// stop and add the channel to the typed `electron.*` surface instead.
if (__E2E_BUILD__) {
  contextBridge.exposeInMainWorld('__ipcEvents__', {
    list: () => recordedIpcEvents.slice(),
    clear: () => {
      recordedIpcEvents.length = 0
    },
    count: (channel: string) =>
      recordedIpcEvents.filter((event) => event.channel === channel).length,
  })
}
