import { IPC_CHANNELS } from '../../shared/ipc-channels'
import { getSettings, saveSettings } from '../services/settings'
import { createOrFocusSettingsWindow } from '../services/settingsWindow'

import { typedHandle } from './typedHandle'
import { broadcastTypedEvent } from './typedSend'

/**
 * Wires the IPC surface for the Settings window:
 *  - `settings:open`         opens (or focuses) the Settings BrowserWindow.
 *  - `settings:get`          returns the in-memory cache so renderers can
 *                            hydrate their Redux slice on mount.
 *  - `settings:set`          merges a partial update, persists to JSON,
 *                            and broadcasts `settings:changed` so every
 *                            open window converges (no stale state across
 *                            the main window and Settings window).
 *
 * The broadcast is what eliminates the dual-Redux race we'd see if
 * persistence lived in localStorage and both windows wrote to the same
 * key — the main process is the single source of truth and renderers
 * are pure caches.
 */
export function registerSettingsHandlers(): void {
  typedHandle(IPC_CHANNELS.SETTINGS_OPEN, () => {
    createOrFocusSettingsWindow()
  })

  typedHandle(IPC_CHANNELS.SETTINGS_GET, () => getSettings())

  typedHandle(IPC_CHANNELS.SETTINGS_SET, async (_event, partial) => {
    const next = await saveSettings(partial)
    broadcastTypedEvent(IPC_CHANNELS.SETTINGS_CHANGED, next)
    return next
  })
}
