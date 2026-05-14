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
 * RGB channels for the dark app canvas used by Electron before renderer CSS
 * is available. The renderer uses the OKLCH token equivalent.
 */
export const MAIN_WINDOW_BACKGROUND_RGB_CHANNELS = '10, 15, 28'

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
  return (
    normalizeWindowBackgroundBlurRadius(blurRadius) >
    normalizeWindowBackgroundBlurRadius(0)
  )
}

/**
 * Pick the window backplate color required by Electron's blur renderer.
 * @param blurRadius - Normalized or raw blur radius.
 * @returns Opaque color when blur is off; slider-derived alpha when blur is on.
 * @example
 * getMainWindowBackgroundColor(48) // => 'rgba(10, 15, 28, 0.68)'
 */
export function getMainWindowBackgroundColor(blurRadius: number): string {
  const normalizedRadius = normalizeWindowBackgroundBlurRadius(blurRadius)
  if (normalizedRadius > 0) {
    const opacity = getWindowBackgroundOpacity(normalizedRadius)
    // Electron only shows native blur through an alpha BrowserWindow backplate.
    return `rgba(${MAIN_WINDOW_BACKGROUND_RGB_CHANNELS}, ${opacity})`
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
  const shouldEnableNativeBlur = shouldUseNativeWindowBlur(normalizedRadius)

  window.setBackgroundColor(backgroundColor)
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
