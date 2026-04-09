import { shell } from 'electron'

import { IPC_CHANNELS } from '../../shared/ipc-channels'

import { typedHandle } from './typedHandle'

/**
 * Register IPC handlers for Electron `shell` APIs.
 *
 * The `shell` module is main-process-only — it is unavailable in sandboxed
 * preload scripts — so callers in the renderer must route through IPC.
 */
export function registerShellHandlers(): void {
  typedHandle(IPC_CHANNELS.SHELL_OPEN_EXTERNAL, async (_event, url) => {
    await shell.openExternal(url)
  })
}
