import { IPC_CHANNELS } from '@/shared/ipc-channels'

import {
  getCliCommandStatus,
  installCliCommand,
  removeCliCommand,
} from '../services/cliCommandService'

import { typedHandle } from './typedHandle'

/**
 * Registers Settings-facing handlers for managing the app-level CLI shim.
 * @returns void after the three no-arg channels are attached to ipcMain.
 * @example registerCliCommandHandlers()
 */
export function registerCliCommandHandlers(): void {
  typedHandle(IPC_CHANNELS.CLI_COMMAND_GET_STATUS, async () =>
    getCliCommandStatus(),
  )
  typedHandle(IPC_CHANNELS.CLI_COMMAND_INSTALL, async () => installCliCommand())
  typedHandle(IPC_CHANNELS.CLI_COMMAND_REMOVE, async () => removeCliCommand())
}
