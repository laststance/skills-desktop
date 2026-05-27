import { getMainWindow } from '@/main/services/mainWindowState'
import { getSettings, saveSettings } from '@/main/services/settings'
import { createOrFocusSettingsWindow } from '@/main/services/settingsWindow'
import { applyUpdaterPreferences } from '@/main/updater'
import { applyWindowBackgroundBlur } from '@/main/utils/windowBackgroundBlur'
import { IPC_CHANNELS } from '@/shared/ipc-channels'

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
    const before = getSettings()
    const next = await saveSettings(partial)
    // `saveSettings` returns the same reference when nothing actually
    // changed (shallow-compare guard inside the service). Skip the
    // broadcast in that case so we don't fan out a no-op `settings:changed`
    // and trigger a redundant Redux replace in every open window.
    if (next !== before) {
      if (
        next.windowBackgroundBlurRadius !== before.windowBackgroundBlurRadius
      ) {
        const mainWindow = getMainWindow()
        // Settings can outlive the main window on macOS; a closed main window
        // simply receives the persisted blur the next time it is created.
        if (mainWindow !== null) {
          applyWindowBackgroundBlur(mainWindow, next.windowBackgroundBlurRadius)
        }
      }
      // Push the auto-download preference onto the live updater so a
      // mid-session toggle takes effect on the next check without an app
      // restart. Harmless when the updater is inactive (dev / unpackaged):
      // it only mutates config on the electron-updater singleton.
      if (next.autoDownloadUpdates !== before.autoDownloadUpdates) {
        applyUpdaterPreferences(next)
      }
      broadcastTypedEvent(IPC_CHANNELS.SETTINGS_CHANGED, next)
    }
    return next
  })
}
