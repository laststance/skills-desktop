import type { BrowserWindow } from 'electron'

/**
 * Shared module-scoped reference to the application's main BrowserWindow.
 *
 * Why this lives in its own module: both `src/main/index.ts` (which creates
 * the window) and IPC handlers (which need to query the window's bounds for
 * the Settings → "Use current window size" action) need access. A separate
 * module avoids a circular import between `index.ts` and `ipc/window.ts`.
 *
 * Settings window references stay in `settingsWindow.ts` — same single-
 * instance pattern, kept separate so each module owns one window's lifecycle.
 *
 * Always go through `getMainWindow()` rather than the module-local variable
 * so callers consistently get a `null` back after the window has been
 * destroyed (Electron leaves a `BrowserWindow` instance behind whose methods
 * throw post-`destroy()`).
 */
let mainWindowRef: BrowserWindow | null = null

/**
 * Record the freshly-created main window so IPC handlers can query it.
 * Pass `null` from the window's `'closed'` event so a stale reference
 * cannot leak across re-creates.
 * @param window - The newly created main BrowserWindow, or null on close
 */
export function setMainWindow(window: BrowserWindow | null): void {
  mainWindowRef = window
}

/**
 * Returns the live main window, or `null` if there is none (never created,
 * already closed, or destroyed). Callers should treat `null` as "feature
 * not available right now" rather than an error.
 * @returns The current main BrowserWindow, or null
 * @example
 * const win = getMainWindow()
 * if (!win) return null
 * const { width, height } = win.getContentBounds()
 */
export function getMainWindow(): BrowserWindow | null {
  if (mainWindowRef === null) return null
  if (mainWindowRef.isDestroyed()) return null
  return mainWindowRef
}
