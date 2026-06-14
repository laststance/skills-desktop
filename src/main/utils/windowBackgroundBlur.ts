import type { BrowserWindow, View } from 'electron'

import {
  getWindowBackgroundOpacity,
  normalizeWindowBackgroundBlurRadius,
} from '@/shared/settings'

/**
 * Opaque launch color matching the app's dark background token.
 * Exported so `BrowserWindow` construction and post-create blur updates
 * use the same fallback color.
 */
export const MAIN_WINDOW_OPAQUE_BACKGROUND = 'rgb(10, 15, 28)'

/**
 * Fully transparent BrowserWindow backplate used when real window opacity is on.
 */
export const MAIN_WINDOW_TRANSPARENT_BACKGROUND = '#00000000'

type BackgroundBlurCapableView = View & {
  setBackgroundBlur?: (blurRadius: number) => void
}

const MACOS_VIBRANCY_MATERIAL = 'under-window'

export { normalizeWindowBackgroundBlurRadius } from '@/shared/settings'

/**
 * Decide whether the native macOS material blur should be enabled.
 * @param blurRadius - Normalized or raw blur radius.
 * @returns true when the Appearance setting asks for a non-opaque window.
 * @example
 * shouldUseNativeWindowBlur(48) // => true
 */
export function shouldUseNativeWindowBlur(blurRadius: number): boolean {
  return normalizeWindowBackgroundBlurRadius(blurRadius) > 0
}

/**
 * Convert the blur slider into the real Electron window opacity.
 * @param blurRadius - Normalized or raw blur radius.
 * @returns Whole-window opacity from opaque to transparent.
 * @example
 * getMainWindowOpacity(48) // => 0.45
 */
export function getMainWindowOpacity(blurRadius: number): number {
  return getWindowBackgroundOpacity(blurRadius)
}

/**
 * Pick the BrowserWindow backplate color for the current transparency mode.
 * @param blurRadius - Normalized or raw blur radius.
 * @returns Opaque color when blur is off; clear backplate when blur is on.
 * @example
 * getMainWindowBackgroundColor(48) // => '#00000000'
 */
export function getMainWindowBackgroundColor(blurRadius: number): string {
  const normalizedRadius = normalizeWindowBackgroundBlurRadius(blurRadius)
  if (normalizedRadius > 0) {
    // The renderer paints the app chrome; Electron's native backplate must stay
    // clear so BrowserWindow.setOpacity can reveal the desktop underneath.
    return MAIN_WINDOW_TRANSPARENT_BACKGROUND
  }
  return MAIN_WINDOW_OPAQUE_BACKGROUND
}

/**
 * Apply the persisted Appearance blur setting to the live main window.
 * @param window - Main BrowserWindow instance.
 * @param blurRadius - Requested Electron 42 blur radius in CSS pixels.
 * @example
 * applyWindowBackgroundBlur(mainWindow, settings.windowBackgroundBlurRadius)
 */
export function applyWindowBackgroundBlur(
  window: BrowserWindow,
  blurRadius: number,
): void {
  const normalizedRadius = normalizeWindowBackgroundBlurRadius(blurRadius)
  const backgroundColor = getMainWindowBackgroundColor(normalizedRadius)
  const windowOpacity = getMainWindowOpacity(normalizedRadius)
  const shouldEnableNativeBlur = shouldUseNativeWindowBlur(normalizedRadius)

  window.setOpacity(windowOpacity)
  window.setBackgroundColor(backgroundColor)
  /* v8 ignore next -- false arm (Windows/Linux) is unreachable: the node test lane runs on macOS where process.platform is always 'darwin', and setVibrancy is a macOS-only API that must not be called off-platform */
  if (process.platform === 'darwin') {
    // macOS vibrancy supplies the system material seen through the transparent
    // Chromium surface. Turning it off at radius 0 restores the solid app.
    window.setVibrancy(shouldEnableNativeBlur ? MACOS_VIBRANCY_MATERIAL : null)
  }

  const contentView = window.contentView as BackgroundBlurCapableView
  if (typeof contentView.setBackgroundColor === 'function') {
    contentView.setBackgroundColor(backgroundColor)
  }

  // Electron 42 exposes this at runtime, but its TypeScript declarations may
  // lag behind. Guarding keeps older local Electron builds from crashing.
  if (typeof contentView.setBackgroundBlur !== 'function') return

  contentView.setBackgroundBlur(normalizedRadius)
}
