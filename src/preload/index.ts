import { contextBridge, ipcRenderer, shell } from 'electron'

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
})
