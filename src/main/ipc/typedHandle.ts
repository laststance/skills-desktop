import { ipcMain, type IpcMainInvokeEvent } from 'electron'

import type {
  IpcInvokeChannel,
  IpcInvokeContract,
} from '../../shared/ipc-contract'

/**
 * Type-safe wrapper around ipcMain.handle that enforces the IPC contract.
 * The handler's args and return type are inferred from IpcInvokeContract.
 * @param channel - IPC channel name (must be a key of IpcInvokeContract)
 * @param handler - Handler function receiving (event, ...args) and returning the contracted result
 * @example
 * typedHandle('skills:getAll', async () => scanSkills())
 * typedHandle('files:list', async (_, skillPath) => listSkillFiles(skillPath))
 */
export function typedHandle<C extends IpcInvokeChannel>(
  channel: C,
  handler: (
    event: IpcMainInvokeEvent,
    ...args: IpcInvokeContract[C]['args']
  ) => Promise<IpcInvokeContract[C]['result']> | IpcInvokeContract[C]['result'],
): void {
  ipcMain.handle(channel, handler as Parameters<typeof ipcMain.handle>[1])
}
