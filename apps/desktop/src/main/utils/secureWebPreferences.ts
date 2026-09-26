import { join } from 'path'

import type { WebPreferences } from 'electron'

/**
 * Hardened `webPreferences` shared by every BrowserWindow we create
 * (main window + Settings window). Centralizing this keeps the security
 * baseline (`sandbox` + `contextIsolation` + `nodeIntegration: false`)
 * impossible to silently weaken in only one window.
 *
 * Returned as a function — not a frozen constant — because
 * `app.getPath`/`__dirname` resolution is only valid at main-process
 * runtime; evaluating at module-load time crashes Electron under tests.
 * @returns A `WebPreferences` object suitable for passing into a `new BrowserWindow({ webPreferences })`.
 * @example
 * new BrowserWindow({ webPreferences: getSecureWebPreferences() })
 */
export function getSecureWebPreferences(): WebPreferences {
  return {
    preload: join(__dirname, '../preload/index.js'),
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
  }
}
