import type { WebContents } from 'electron'

import type {
  IpcEventChannel,
  IpcEventContract,
} from '../../shared/ipc-contract'

/**
 * Type-safe wrapper around webContents.send for event channels.
 * Ensures sent data matches IpcEventContract at compile time.
 * @param webContents - Target renderer's WebContents
 * @param channel - Event channel name (key of IpcEventContract)
 * @param args - Payload matching the contract (omit for void channels)
 * @example
 * typedSend(win.webContents, 'update:checking')
 * typedSend(win.webContents, 'update:available', { version: '1.0.0' })
 */
export function typedSend<C extends IpcEventChannel>(
  webContents: WebContents,
  channel: C,
  ...args: IpcEventContract[C] extends void ? [] : [IpcEventContract[C]]
): void {
  webContents.send(channel, ...args)
}
