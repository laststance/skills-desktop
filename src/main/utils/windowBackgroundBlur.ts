import type { BrowserWindow } from 'electron'

import {
  getWindowBackgroundOpacity,
  normalizeWindowBackgroundBlurRadius,
} from '@/shared/settings'
import type { Settings } from '@/shared/settings'

/**
 * Opaque launch color matching the app's dark background token.
 * Exported so `BrowserWindow` construction and post-create blur updates
 * use the same fallback color.
 */
export const MAIN_WINDOW_OPAQUE_BACKGROUND = 'rgb(10, 15, 28)'

/**
 * Clear BrowserWindow backplate that lets window or section opacity reveal the desktop.
 */
export const MAIN_WINDOW_TRANSPARENT_BACKGROUND = '#00000000'

const MACOS_VIBRANCY_MATERIAL = 'under-window'

export { normalizeWindowBackgroundBlurRadius } from '@/shared/settings'

/**
 * Decide whether the native macOS material blur should be enabled.
 * @param blurRadius - Normalized or raw blur radius.
 * @param opacityMode - Section mode uses renderer transparency without a whole-window material.
 * @returns true when the Appearance setting asks for a non-opaque window.
 * @example
 * shouldUseNativeWindowBlur(48) // => true
 */
export function shouldUseNativeWindowBlur(
  blurRadius: number,
  opacityMode: Settings['windowOpacityMode'] = 'entire',
): boolean {
  return (
    opacityMode === 'entire' &&
    normalizeWindowBackgroundBlurRadius(blurRadius) > 0
  )
}

/**
 * Convert the blur slider into the real Electron window opacity.
 * @param blurRadius - Normalized or raw blur radius.
 * @param opacityMode - Section mode keeps native opacity at one to avoid multiplying section values.
 * @returns Saved whole-window opacity in Entire mode, or 1 in Section mode.
 * @example
 * getMainWindowOpacity(48) // => 0.45
 */
export function getMainWindowOpacity(
  blurRadius: number,
  opacityMode: Settings['windowOpacityMode'] = 'entire',
): number {
  return opacityMode === 'section' ? 1 : getWindowBackgroundOpacity(blurRadius)
}

/**
 * Pick the BrowserWindow backplate color for the current transparency mode.
 * @param blurRadius - Normalized or raw blur radius.
 * @param opacityMode - Section mode always requires a clear native backplate.
 * @returns Opaque color for unblurred Entire mode; a clear backplate for Section mode or blur.
 * @example
 * getMainWindowBackgroundColor(48) // => '#00000000'
 */
export function getMainWindowBackgroundColor(
  blurRadius: number,
  opacityMode: Settings['windowOpacityMode'] = 'entire',
): string {
  const normalizedRadius = normalizeWindowBackgroundBlurRadius(blurRadius)
  if (opacityMode === 'section' || normalizedRadius > 0) {
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
 * @param opacityMode - Selected scope from Appearance; the saved Entire intensity remains untouched.
 * @returns Nothing; updates the live BrowserWindow in place.
 * @example
 * applyWindowBackgroundBlur(mainWindow, settings.windowBackgroundBlurRadius)
 */
export function applyWindowBackgroundBlur(
  window: BrowserWindow,
  blurRadius: number,
  opacityMode: Settings['windowOpacityMode'] = 'entire',
): void {
  const normalizedRadius = normalizeWindowBackgroundBlurRadius(blurRadius)
  const backgroundColor = getMainWindowBackgroundColor(
    normalizedRadius,
    opacityMode,
  )
  const windowOpacity = getMainWindowOpacity(normalizedRadius, opacityMode)
  const shouldEnableNativeBlur = shouldUseNativeWindowBlur(
    normalizedRadius,
    opacityMode,
  )

  window.setOpacity(windowOpacity)
  window.setBackgroundColor(backgroundColor)
  /* v8 ignore next -- one OS run cannot cover both platform arms, and setVibrancy must never run off macOS */
  if (process.platform === 'darwin') {
    // Section mode disables the whole-window material so each region can reveal the desktop independently.
    window.setVibrancy(shouldEnableNativeBlur ? MACOS_VIBRANCY_MATERIAL : null)
  }

  // Do not mutate `contentView`: Electron 43 composites it above WebContents,
  // so its background or blur layer hides the already-rendered application.
}
