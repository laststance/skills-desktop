import { join } from 'path'

import { app, BrowserWindow } from 'electron'

import { attachExternalLinkHandler } from '../utils/attachExternalLinkHandler'
import { getSecureWebPreferences } from '../utils/secureWebPreferences'

/**
 * Single-instance reference to the Settings window. Held at module scope
 * so subsequent `createOrFocusSettingsWindow()` calls (App menu Cmd+, or
 * sidebar gear icon) focus the existing window instead of spawning a
 * second one. Cleared on `'closed'`.
 */
let settingsWindow: BrowserWindow | null = null

/**
 * Open (or focus, if already open) the Settings window. Loads the
 * separate `settings/index.html` Rollup entry — see
 * `electron.vite.config.ts` for the multi-entry config.
 *
 * Window chrome: standard macOS title bar (NOT hidden-inset like the
 * main window) so the title "Settings" reads naturally; not minimizable,
 * maximizable, or fullscreen-able to match Inkdrop's pattern.
 * @example
 * // Wired into the App menu and the sidebar gear icon button.
 * createOrFocusSettingsWindow()
 */
export function createOrFocusSettingsWindow(): void {
  if (settingsWindow !== null && !settingsWindow.isDestroyed()) {
    if (settingsWindow.isMinimized()) settingsWindow.restore()
    settingsWindow.focus()
    return
  }

  const window = new BrowserWindow({
    width: 800,
    height: 600,
    minWidth: 600,
    minHeight: 400,
    show: false,
    title: 'Settings',
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: '#0A0F1C',
    webPreferences: getSecureWebPreferences(),
  })

  // External-link routing: keeps About-tab anchor tags out of an in-app
  // BrowserWindow. Mirrors the main-window pattern in src/main/index.ts.
  attachExternalLinkHandler(window)

  window.on('ready-to-show', () => {
    window.show()
  })

  window.on('closed', () => {
    settingsWindow = null
  })

  // Dev: hot-reload via electron-vite renderer URL with explicit hash.
  // Prod: load the bundled HTML file directly.
  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && rendererUrl) {
    window.loadURL(`${rendererUrl}/settings/index.html`)
  } else {
    window.loadFile(join(__dirname, '../renderer/settings/index.html'))
  }

  settingsWindow = window
}
