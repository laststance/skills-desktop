import { contextBridge, ipcRenderer, shell } from 'electron'

import type { UpdateInfo, DownloadProgress } from '../main/updater'
import type { InstallOptions, InstallProgress } from '../shared/types'

// Expose protected methods to renderer process
contextBridge.exposeInMainWorld('electron', {
  // Shell API (external links)
  shell: {
    openExternal: async (url: string) => shell.openExternal(url),
  },
  // Skills API
  skills: {
    getAll: async () => ipcRenderer.invoke('skills:getAll'),
  },
  // Agents API
  agents: {
    getAll: async () => ipcRenderer.invoke('agents:getAll'),
  },
  // Source API
  source: {
    getStats: async () => ipcRenderer.invoke('source:getStats'),
  },
  // Files API
  files: {
    list: async (skillPath: string) =>
      ipcRenderer.invoke('files:list', skillPath),
    read: async (filePath: string) =>
      ipcRenderer.invoke('files:read', filePath),
  },
  // Update API
  update: {
    // Event listeners
    onChecking: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on('update:checking', handler)
      return () => ipcRenderer.removeListener('update:checking', handler)
    },
    onAvailable: (callback: (info: UpdateInfo) => void) => {
      const handler = (_: Electron.IpcRendererEvent, info: UpdateInfo) =>
        callback(info)
      ipcRenderer.on('update:available', handler)
      return () => ipcRenderer.removeListener('update:available', handler)
    },
    onNotAvailable: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on('update:not-available', handler)
      return () => ipcRenderer.removeListener('update:not-available', handler)
    },
    onProgress: (callback: (progress: DownloadProgress) => void) => {
      const handler = (
        _: Electron.IpcRendererEvent,
        progress: DownloadProgress,
      ) => callback(progress)
      ipcRenderer.on('update:progress', handler)
      return () => ipcRenderer.removeListener('update:progress', handler)
    },
    onDownloaded: (callback: (info: UpdateInfo) => void) => {
      const handler = (_: Electron.IpcRendererEvent, info: UpdateInfo) =>
        callback(info)
      ipcRenderer.on('update:downloaded', handler)
      return () => ipcRenderer.removeListener('update:downloaded', handler)
    },
    onError: (callback: (error: { message: string }) => void) => {
      const handler = (
        _: Electron.IpcRendererEvent,
        error: { message: string },
      ) => callback(error)
      ipcRenderer.on('update:error', handler)
      return () => ipcRenderer.removeListener('update:error', handler)
    },
    // Actions
    download: async () => ipcRenderer.invoke('update:download'),
    install: async () => ipcRenderer.invoke('update:install'),
    check: async () => ipcRenderer.invoke('update:check'),
  },
  // Skills CLI API (Marketplace)
  skillsCli: {
    search: async (query: string) =>
      ipcRenderer.invoke('skills:cli:search', query),
    install: async (options: InstallOptions) =>
      ipcRenderer.invoke('skills:cli:install', options),
    remove: async (skillName: string) =>
      ipcRenderer.invoke('skills:cli:remove', skillName),
    cancel: async () => ipcRenderer.invoke('skills:cli:cancel'),
    onProgress: (callback: (progress: InstallProgress) => void) => {
      const handler = (
        _: Electron.IpcRendererEvent,
        progress: InstallProgress,
      ) => callback(progress)
      ipcRenderer.on('skills:cli:progress', handler)
      return () => ipcRenderer.removeListener('skills:cli:progress', handler)
    },
  },
})
