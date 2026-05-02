import { type BrowserWindow, shell } from 'electron'

/**
 * Route any `window.open()` / target="_blank" anchor click out of the
 * given BrowserWindow into the OS default browser via `shell.openExternal`.
 * Denies non-http(s) schemes (e.g. `javascript:`, `file:`) so a malicious
 * marketplace listing or About-tab content cannot pivot through this hook
 * to navigate the embedding window.
 *
 * Mirrors the pattern recommended by Electron's security docs and is
 * applied to every window we create — main window plus Settings window —
 * so external link behavior is consistent across surfaces.
 * @param window - BrowserWindow whose webContents should hand off external links to the OS.
 * @example
 * const window = new BrowserWindow({ ... })
 * attachExternalLinkHandler(window)
 */
export function attachExternalLinkHandler(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler((details) => {
    try {
      const url = new URL(details.url)
      if (['http:', 'https:'].includes(url.protocol)) {
        shell.openExternal(details.url)
      }
    } catch {
      // Invalid URL, ignore
    }
    return { action: 'deny' }
  })
}
