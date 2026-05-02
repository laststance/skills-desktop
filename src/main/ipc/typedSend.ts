import { BrowserWindow, type WebContents } from 'electron'

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

/**
 * Broadcast a typed event to every open BrowserWindow. Used by the
 * updater and the settings service to fan out state changes so the
 * main window and Settings window both stay in sync.
 *
 * Lifted out of `updater.ts` so multiple subsystems can reuse it without
 * each redefining its own `for (...) typedSend(...)` loop.
 * @param channel - Event channel name (key of IpcEventContract)
 * @param args - Payload matching the contract (omit for void channels)
 * @example
 * broadcastTypedEvent('settings:changed', { defaultSkillTab: 'info' })
 */
export function broadcastTypedEvent<C extends IpcEventChannel>(
  channel: C,
  ...args: IpcEventContract[C] extends void ? [] : [IpcEventContract[C]]
): void {
  for (const win of BrowserWindow.getAllWindows()) {
    typedSend(win.webContents, channel, ...args)
  }
}
