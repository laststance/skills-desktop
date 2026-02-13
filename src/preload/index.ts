import { contextBridge, ipcRenderer, shell } from 'electron'

import { IPC_CHANNELS } from '../shared/ipc-channels'
import type {
  DownloadProgress,
  InstallProgress,
  UpdateInfo,
} from '../shared/types'

import { typedInvoke } from './typedInvoke'

// Expose protected methods to renderer process
contextBridge.exposeInMainWorld('electron', {
  // Shell API (external links)
  shell: {
    openExternal: async (url: string) => shell.openExternal(url),
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
    onChecking: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on(IPC_CHANNELS.UPDATE_CHECKING, handler)
      return () =>
        ipcRenderer.removeListener(IPC_CHANNELS.UPDATE_CHECKING, handler)
    },
    onAvailable: (callback: (info: UpdateInfo) => void) => {
      const handler = (_: Electron.IpcRendererEvent, info: UpdateInfo) =>
        callback(info)
      ipcRenderer.on(IPC_CHANNELS.UPDATE_AVAILABLE, handler)
      return () =>
        ipcRenderer.removeListener(IPC_CHANNELS.UPDATE_AVAILABLE, handler)
    },
    onNotAvailable: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on(IPC_CHANNELS.UPDATE_NOT_AVAILABLE, handler)
      return () =>
        ipcRenderer.removeListener(IPC_CHANNELS.UPDATE_NOT_AVAILABLE, handler)
    },
    onProgress: (callback: (progress: DownloadProgress) => void) => {
      const handler = (
        _: Electron.IpcRendererEvent,
        progress: DownloadProgress,
      ) => callback(progress)
      ipcRenderer.on(IPC_CHANNELS.UPDATE_PROGRESS, handler)
      return () =>
        ipcRenderer.removeListener(IPC_CHANNELS.UPDATE_PROGRESS, handler)
    },
    onDownloaded: (callback: (info: UpdateInfo) => void) => {
      const handler = (_: Electron.IpcRendererEvent, info: UpdateInfo) =>
        callback(info)
      ipcRenderer.on(IPC_CHANNELS.UPDATE_DOWNLOADED, handler)
      return () =>
        ipcRenderer.removeListener(IPC_CHANNELS.UPDATE_DOWNLOADED, handler)
    },
    onError: (callback: (error: { message: string }) => void) => {
      const handler = (
        _: Electron.IpcRendererEvent,
        error: { message: string },
      ) => callback(error)
      ipcRenderer.on(IPC_CHANNELS.UPDATE_ERROR, handler)
      return () =>
        ipcRenderer.removeListener(IPC_CHANNELS.UPDATE_ERROR, handler)
    },
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
    onProgress: (callback: (progress: InstallProgress) => void) => {
      const handler = (
        _: Electron.IpcRendererEvent,
        progress: InstallProgress,
      ) => callback(progress)
      ipcRenderer.on(IPC_CHANNELS.SKILLS_CLI_PROGRESS, handler)
      return () =>
        ipcRenderer.removeListener(IPC_CHANNELS.SKILLS_CLI_PROGRESS, handler)
    },
  },
  // Sync API
  sync: {
    preview: async () => typedInvoke('sync:preview'),
    execute: async (
      options: Parameters<typeof typedInvoke<'sync:execute'>>[1],
    ) => typedInvoke('sync:execute', options),
  },
})
