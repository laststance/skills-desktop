import { ipcRenderer } from 'electron'

import type { IpcChannel } from '../shared/ipc-channels'

/**
 * Create a type-safe IPC event listener factory.
 * Returns a function that subscribes to the channel, wraps the callback
 * to strip the Electron event object, and returns an unsubscribe function.
 * Eliminates the repeated on/removeListener boilerplate in the context bridge.
 * @param channel - IPC channel name
 * @returns Listener registration function
 * @example
 * // No-arg listener (e.g. update:checking)
 * onChecking: createIpcListener<void>('update:checking')
 *
 * // Typed payload listener
 * onAvailable: createIpcListener<UpdateInfo>('update:available')
 */
export function createIpcListener<T = void>(
  channel: IpcChannel,
): (callback: (data: T) => void) => () => void {
  return (callback: (data: T) => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: T) => callback(data)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  }
}
