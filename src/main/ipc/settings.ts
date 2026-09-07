import { BrowserWindow, type WebContents } from 'electron'

import { getSettings, saveSettings } from '@/main/services/settings'
import { createOrFocusSettingsWindow } from '@/main/services/settingsWindow'
import { applyUpdaterPreferences } from '@/main/updater'
import { IPC_CHANNELS } from '@/shared/ipc-channels'

import { typedHandle } from './typedHandle'
import { typedSend } from './typedSend'

/**
 * Wires the IPC surface for the Settings window:
 *  - `settings:open`         opens (or focuses) the Settings BrowserWindow.
 *  - `settings:get`          returns the in-memory cache so renderers can
 *                            hydrate their Redux slice on mount.
 *  - `settings:set`          merges a partial update, persists to JSON,
 *                            returns the saved snapshot to its sender, and
 *                            broadcasts `settings:changed` without stale self-echoes.
 *
 * The broadcast is what eliminates the dual-Redux race we'd see if
 * persistence lived in localStorage and both windows wrote to the same
 * key — the main process is the single source of truth and renderers
 * are pure caches.
 */
export function registerSettingsHandlers(): void {
  const latestSaveRequests = new WeakMap<WebContents, symbol>()

  typedHandle(IPC_CHANNELS.SETTINGS_OPEN, () => {
    createOrFocusSettingsWindow()
  })

  typedHandle(IPC_CHANNELS.SETTINGS_GET, () => getSettings())

  typedHandle(IPC_CHANNELS.SETTINGS_SET, async (event, partial) => {
    const request = Symbol()
    latestSaveRequests.set(event.sender, request)
    const before = getSettings()
    const next = await saveSettings(partial).catch((error: unknown) => {
      // A failed latest save restores durable preferences even if another window replaced its optimistic edit.
      if (
        !event.sender.isDestroyed() &&
        latestSaveRequests.get(event.sender) === request
      ) {
        typedSend(event.sender, IPC_CHANNELS.SETTINGS_CHANGED, getSettings())
      }
      throw error
    })
    // `saveSettings` returns the same reference when nothing actually
    // changed (shallow-compare guard inside the service). Skip the
    // broadcast in that case so we don't fan out a no-op `settings:changed`
    // and trigger a redundant Redux replace in every open window.
    if (next !== before) {
      // Push the auto-download preference onto the live updater so a
      // mid-session toggle takes effect on the next check without an app
      // restart. Harmless when the updater is inactive (dev / unpackaged):
      // it only mutates config on the electron-updater singleton.
      if (next.autoDownloadUpdates !== before.autoDownloadUpdates) {
        applyUpdaterPreferences(next)
      }
      // Only obsolete self-echoes are skipped; the latest save still reconciles overlapping windows.
      for (const window of BrowserWindow.getAllWindows()) {
        if (
          window.isDestroyed() ||
          window.webContents.isDestroyed() ||
          (window.webContents === event.sender &&
            latestSaveRequests.get(event.sender) !== request)
        )
          continue
        typedSend(window.webContents, IPC_CHANNELS.SETTINGS_CHANGED, next)
      }
    }
    return next
  })
}
