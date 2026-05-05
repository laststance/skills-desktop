import { getMainWindow } from '@/main/services/mainWindowState'
import { IPC_CHANNELS } from '@/shared/ipc-channels'

import { typedHandle } from './typedHandle'

/**
 * Wires IPC handlers that introspect the main BrowserWindow.
 *
 * `window:getMainBounds` returns the live content bounds (CSS pixels,
 * matching what the renderer's `window.innerWidth/Height` would report) so
 * the Settings window can capture the user's current size and persist it
 * to `settings.windowSize`. Returns `null` when the main window is gone
 * (closed but Settings still open) — the caller treats null as "feature
 * unavailable" and disables the button.
 */
export function registerWindowHandlers(): void {
  typedHandle(IPC_CHANNELS.WINDOW_GET_MAIN_BOUNDS, () => {
    const mainWindow = getMainWindow()
    if (mainWindow === null) return null
    const bounds = mainWindow.getContentBounds()
    return { width: bounds.width, height: bounds.height }
  })
}
