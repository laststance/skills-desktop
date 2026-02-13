import { ipcRenderer } from 'electron'

import type {
  IpcInvokeChannel,
  IpcInvokeContract,
} from '../shared/ipc-contract'

/**
 * Type-safe wrapper around ipcRenderer.invoke that enforces the IPC contract.
 * The args and return type are inferred from IpcInvokeContract.
 * @param channel - IPC channel name (must be a key of IpcInvokeContract)
 * @param args - Arguments matching the contract for this channel
 * @returns Promise resolving to the contracted result type
 * @example
 * const skills = await typedInvoke('skills:getAll') // Promise<Skill[]>
 * const files = await typedInvoke('files:list', '/path/to/skill') // Promise<SkillFile[]>
 */
export async function typedInvoke<C extends IpcInvokeChannel>(
  channel: C,
  ...args: IpcInvokeContract[C]['args']
): Promise<IpcInvokeContract[C]['result']> {
  return ipcRenderer.invoke(channel, ...args) as Promise<
    IpcInvokeContract[C]['result']
  >
}
