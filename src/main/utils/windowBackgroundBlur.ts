import type { BrowserWindow } from 'electron'

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
 * Apply Appearance blur behind renderer content using BrowserWindow-native effects.
 * @param window - Main BrowserWindow instance.
 * @param blurRadius - Legacy-named Appearance transparency intensity.
 * @returns Nothing; updates the live BrowserWindow in place.
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
  /* v8 ignore next -- one OS run cannot cover both platform arms, and setVibrancy must never run off macOS */
  if (process.platform === 'darwin') {
    // macOS vibrancy supplies the system material seen through the transparent
    // Chromium surface. Turning it off at radius 0 restores the solid app.
    window.setVibrancy(shouldEnableNativeBlur ? MACOS_VIBRANCY_MATERIAL : null)
  }

  // Do not mutate `contentView`: Electron 43 composites it above WebContents,
  // so its background or blur layer hides the already-rendered application.
}
