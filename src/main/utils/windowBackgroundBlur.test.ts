import type { BrowserWindow } from 'electron'
import { describe, expect, it, vi } from 'vitest'

import { WINDOW_BACKGROUND_BLUR_MAX_RADIUS } from '@/shared/settings'

import {
  applyWindowBackgroundBlur,
  getMainWindowBackgroundColor,
  getMainWindowOpacity,
  MAIN_WINDOW_OPAQUE_BACKGROUND,
  MAIN_WINDOW_TRANSPARENT_BACKGROUND,
  normalizeWindowBackgroundBlurRadius,
  shouldUseNativeWindowBlur,
} from './windowBackgroundBlur'

/**
 * Assert macOS-only vibrancy behavior without making Linux CI fail.
 * @param window - Mock BrowserWindow returned from `makeWindowMock`.
 * @param material - Expected vibrancy material on macOS, or null when disabled.
 * @example
 * expectMacVibrancy(window, 'under-window')
 */
function expectMacVibrancy(
  window: BrowserWindow,
  material: 'under-window' | null,
): void {
  const setVibrancy = vi.mocked(window.setVibrancy)
  if (process.platform === 'darwin') {
    expect(setVibrancy).toHaveBeenCalledWith(material)
    return
  }
  expect(setVibrancy).not.toHaveBeenCalled()
}

/**
 * Build a BrowserWindow mock with spies proving Electron 43 contentView stays untouched.
 * @returns Mock window plus spies for assertions.
 * @example
 * const { window } = makeWindowMock()
 * applyWindowBackgroundBlur(window, 12)
 */
function makeWindowMock() {
  const contentView = {
    setBackgroundColor: vi.fn(),
    setBackgroundBlur: vi.fn(),
  }
  const window = {
    setBackgroundColor: vi.fn(),
    setOpacity: vi.fn(),
    setVibrancy: vi.fn(),
    contentView,
  } as unknown as BrowserWindow
  return { window, contentView }
}

/**
 * Pin native BrowserWindow blur behavior without creating Electron 43 overlay layers.
 */
describe('windowBackgroundBlur helpers', () => {
  it('floors negative, truncates fractional, and caps over-max persisted blur radii to the supported range', () => {
    // Arrange
    const negativeRadius = -12
    const fractionalRadius = 12.9
    const overMaxRadius = 99

    // Act
    const flooredRadius = normalizeWindowBackgroundBlurRadius(negativeRadius)
    const roundedRadius = normalizeWindowBackgroundBlurRadius(fractionalRadius)
    const cappedRadius = normalizeWindowBackgroundBlurRadius(overMaxRadius)

    // Assert
    expect(flooredRadius).toBe(0)
    expect(roundedRadius).toBe(12)
    expect(cappedRadius).toBe(WINDOW_BACKGROUND_BLUR_MAX_RADIUS)
  })

  it('paints an opaque window background when the user turns blur off', () => {
    // Arrange
    const blurDisabledRadius = 0

    // Act
    const backgroundColor = getMainWindowBackgroundColor(blurDisabledRadius)

    // Assert
    expect(backgroundColor).toBe(MAIN_WINDOW_OPAQUE_BACKGROUND)
  })

  it('paints a see-through window background when the user turns blur on', () => {
    // Arrange
    const blurEnabledRadius = 12

    // Act
    const backgroundColor = getMainWindowBackgroundColor(blurEnabledRadius)

    // Assert
    expect(backgroundColor).toBe(MAIN_WINDOW_TRANSPARENT_BACKGROUND)
  })

  it('keeps the window fully opaque at zero blur and drops to 0.45 opacity at max blur', () => {
    // Arrange
    const blurDisabledRadius = 0
    const maxBlurRadius = WINDOW_BACKGROUND_BLUR_MAX_RADIUS

    // Act
    const opacityAtNoBlur = getMainWindowOpacity(blurDisabledRadius)
    const opacityAtMaxBlur = getMainWindowOpacity(maxBlurRadius)

    // Assert
    expect(opacityAtNoBlur).toBe(1)
    expect(opacityAtMaxBlur).toBe(0.45)
  })

  it('turns on native blur only once the radius rises above zero', () => {
    // Arrange
    const blurDisabledRadius = 0
    const blurEnabledRadius = 1

    // Act
    const blurOffUsesNative = shouldUseNativeWindowBlur(blurDisabledRadius)
    const blurOnUsesNative = shouldUseNativeWindowBlur(blurEnabledRadius)

    // Assert
    expect(blurOffUsesNative).toBe(false)
    expect(blurOnUsesNative).toBe(true)
  })

  it('keeps renderer content visible when the user disables blur on Electron 43', () => {
    // Arrange
    const { window, contentView } = makeWindowMock()
    const blurDisabledRadius = 0

    // Act
    applyWindowBackgroundBlur(window, blurDisabledRadius)

    // Assert
    expect(window.setOpacity).toHaveBeenCalledWith(1)
    expect(window.setBackgroundColor).toHaveBeenCalledWith(
      MAIN_WINDOW_OPAQUE_BACKGROUND,
    )
    expectMacVibrancy(window, null)
    expect(contentView.setBackgroundColor).not.toHaveBeenCalled()
    expect(contentView.setBackgroundBlur).not.toHaveBeenCalled()
  })

  it('keeps renderer content visible when the user enables maximum native blur on Electron 43', () => {
    // Arrange
    const { window, contentView } = makeWindowMock()
    const overMaxRadius = WINDOW_BACKGROUND_BLUR_MAX_RADIUS + 1

    // Act
    applyWindowBackgroundBlur(window, overMaxRadius)

    // Assert
    expect(window.setOpacity).toHaveBeenCalledWith(0.45)
    expect(window.setBackgroundColor).toHaveBeenCalledWith(
      MAIN_WINDOW_TRANSPARENT_BACKGROUND,
    )
    expectMacVibrancy(window, 'under-window')
    expect(contentView.setBackgroundColor).not.toHaveBeenCalled()
    expect(contentView.setBackgroundBlur).not.toHaveBeenCalled()
  })
})
