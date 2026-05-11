import type { BrowserWindow, View } from 'electron'

import {
  WINDOW_BACKGROUND_BLUR_MAX_RADIUS,
  WINDOW_BACKGROUND_BLUR_MIN_RADIUS,
} from '@/shared/settings'

/**
 * Opaque launch color matching the app's dark background token.
 * Exported so `BrowserWindow` construction and post-create blur updates
 * use the same fallback color.
 */
export const MAIN_WINDOW_OPAQUE_BACKGROUND = 'rgb(10, 15, 28)'

/**
 * Alpha mirrors the renderer's `bg-background/85` class so Chromium and the
 * native Electron contentView expose the same glass strength.
 */
export const MAIN_WINDOW_BLURRED_BACKGROUND = 'rgba(10, 15, 28, 0.85)'

type BackgroundBlurCapableView = View & {
  setBackgroundBlur?: (blurRadius: number) => void
}

/**
 * Clamp a persisted blur radius before it touches Electron APIs.
 * @param blurRadius - User setting from `settings.json` or IPC.
 * @returns Whole-pixel radius inside the app-supported range.
 * @example
 * normalizeWindowBackgroundBlurRadius(99) // => 48
 */
export function normalizeWindowBackgroundBlurRadius(
  blurRadius: number,
): number {
  return Math.min(
    WINDOW_BACKGROUND_BLUR_MAX_RADIUS,
    Math.max(WINDOW_BACKGROUND_BLUR_MIN_RADIUS, Math.trunc(blurRadius)),
  )
}

/**
 * Pick the window backplate color required by Electron's blur renderer.
 * @param blurRadius - Normalized or raw blur radius.
 * @returns Opaque color when blur is off; alpha color when blur is on.
 * @example
 * getMainWindowBackgroundColor(12) // => 'rgba(10, 15, 28, 0.82)'
 */
export function getMainWindowBackgroundColor(blurRadius: number): string {
  const normalizedRadius = normalizeWindowBackgroundBlurRadius(blurRadius)
  // Electron only shows `setBackgroundBlur` through an alpha background.
  if (normalizedRadius > 0) {
    return MAIN_WINDOW_BLURRED_BACKGROUND
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

  window.setBackgroundColor(backgroundColor)

  const contentView = window.contentView as BackgroundBlurCapableView
  if (typeof contentView.setBackgroundColor === 'function') {
    contentView.setBackgroundColor(backgroundColor)
  }

  // Electron 42 exposes this at runtime, but its TypeScript declarations may
  // lag behind. Guarding keeps older local Electron builds from crashing.
  if (typeof contentView.setBackgroundBlur !== 'function') return

  contentView.setBackgroundBlur(normalizedRadius)
}
