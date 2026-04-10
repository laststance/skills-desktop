import { contextBridge } from 'electron'

import { IPC_CHANNELS } from '../shared/ipc-channels'
import type {
  DownloadProgress,
  InstallProgress,
  UpdateInfo,
} from '../shared/types'

import { createIpcListener } from './ipcListener'
import { typedInvoke } from './typedInvoke'

// Expose protected methods to renderer process
contextBridge.exposeInMainWorld('electron', {
  // Shell API (external links).
  // Must go through IPC: the `shell` module is unavailable in sandboxed
  // preload scripts and is only callable from the main process.
  // URL shape (http/https only) is enforced by the Zod schema at the handler.
  shell: {
    openExternal: async (url: string) => typedInvoke('shell:openExternal', url),
  },
  // Skills API
  skills: {
    getAll: async () => typedInvoke('skills:getAll'),
    unlinkFromAgent: async (
      options: Parameters<typeof typedInvoke<'skills:unlinkFromAgent'>>[1],
    ) => typedInvoke('skills:unlinkFromAgent', options),
    removeAllFromAgent: async (
      options: Parameters<typeof typedInvoke<'skills:removeAllFromAgent'>>[1],
    ) => typedInvoke('skills:removeAllFromAgent', options),
    deleteSkill: async (
      options: Parameters<typeof typedInvoke<'skills:deleteSkill'>>[1],
    ) => typedInvoke('skills:deleteSkill', options),
    createSymlinks: async (
      options: Parameters<typeof typedInvoke<'skills:createSymlinks'>>[1],
    ) => typedInvoke('skills:createSymlinks', options),
    copyToAgents: async (
      options: Parameters<typeof typedInvoke<'skills:copyToAgents'>>[1],
    ) => typedInvoke('skills:copyToAgents', options),
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
    list: async (skillPath: string) => typedInvoke('files:list', skillPath),
    read: async (filePath: string) => typedInvoke('files:read', filePath),
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
    search: async (query: string) => typedInvoke('skills:cli:search', query),
    install: async (
      options: Parameters<typeof typedInvoke<'skills:cli:install'>>[1],
    ) => typedInvoke('skills:cli:install', options),
    remove: async (skillName: string) =>
      typedInvoke('skills:cli:remove', skillName),
    cancel: async () => typedInvoke('skills:cli:cancel'),
    onProgress: createIpcListener<InstallProgress>(
      IPC_CHANNELS.SKILLS_CLI_PROGRESS,
    ),
  },
  // Sync API
  sync: {
    preview: async () => typedInvoke('sync:preview'),
    execute: async (
      options: Parameters<typeof typedInvoke<'sync:execute'>>[1],
    ) => typedInvoke('sync:execute', options),
  },
})
