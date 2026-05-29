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
 * Build the minimal BrowserWindow/contentView surface the blur mutator uses.
 * @param supportsBlur - Whether the mocked contentView exposes Electron 42 blur.
 * @param supportsViewBackgroundColor - Whether contentView background updates exist.
 * @returns Mock window plus spies for assertions.
 * @example
 * const { window } = makeWindowMock(true)
 * applyWindowBackgroundBlur(window, 12)
 */
function makeWindowMock(
  supportsBlur: boolean,
  supportsViewBackgroundColor = true,
) {
  const contentView = {
    ...(supportsViewBackgroundColor ? { setBackgroundColor: vi.fn() } : {}),
    ...(supportsBlur ? { setBackgroundBlur: vi.fn() } : {}),
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
 * Pure helpers around Electron 42 background blur. The BrowserWindow mutator
 * itself is covered by integration/e2e; these tests pin the clamping and alpha
 * color contract before values reach Electron.
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

  it('renders a solid opaque window with vibrancy off when the user disables blur', () => {
    // Arrange
    const { window, contentView } = makeWindowMock(true)
    const blurDisabledRadius = 0

    // Act
    applyWindowBackgroundBlur(window, blurDisabledRadius)

    // Assert
    expect(window.setOpacity).toHaveBeenCalledWith(1)
    expect(window.setBackgroundColor).toHaveBeenCalledWith(
      MAIN_WINDOW_OPAQUE_BACKGROUND,
    )
    expectMacVibrancy(window, null)
    expect(contentView.setBackgroundColor).toHaveBeenCalledWith(
      MAIN_WINDOW_OPAQUE_BACKGROUND,
    )
    expect(contentView.setBackgroundBlur).toHaveBeenCalledWith(0)
  })

  it('renders a translucent blurred window clamped to max radius when Electron 42 blur is available', () => {
    // Arrange
    const { window, contentView } = makeWindowMock(true)
    const overMaxRadius = WINDOW_BACKGROUND_BLUR_MAX_RADIUS + 1

    // Act
    applyWindowBackgroundBlur(window, overMaxRadius)

    // Assert
    expect(window.setOpacity).toHaveBeenCalledWith(0.45)
    expect(window.setBackgroundColor).toHaveBeenCalledWith(
      MAIN_WINDOW_TRANSPARENT_BACKGROUND,
    )
    expectMacVibrancy(window, 'under-window')
    expect(contentView.setBackgroundColor).toHaveBeenCalledWith(
      MAIN_WINDOW_TRANSPARENT_BACKGROUND,
    )
    expect(contentView.setBackgroundBlur).toHaveBeenCalledWith(
      WINDOW_BACKGROUND_BLUR_MAX_RADIUS,
    )
  })

  it('falls back to translucency without crashing when Electron lacks setBackgroundBlur', () => {
    // Arrange
    const { window, contentView } = makeWindowMock(false)
    const blurEnabledRadius = 12

    // Act + Assert
    expect(() =>
      applyWindowBackgroundBlur(window, blurEnabledRadius),
    ).not.toThrow()
    expect(window.setOpacity).toHaveBeenCalledWith(0.86)
    expect(window.setBackgroundColor).toHaveBeenCalledWith(
      MAIN_WINDOW_TRANSPARENT_BACKGROUND,
    )
    expect(contentView.setBackgroundColor).toHaveBeenCalledWith(
      MAIN_WINDOW_TRANSPARENT_BACKGROUND,
    )
    expect('setBackgroundBlur' in contentView).toBe(false)
  })

  it('still applies window-level blur without crashing when contentView lacks setBackgroundColor', () => {
    // Arrange
    const { window, contentView } = makeWindowMock(true, false)
    const blurEnabledRadius = 12

    // Act + Assert
    expect(() =>
      applyWindowBackgroundBlur(window, blurEnabledRadius),
    ).not.toThrow()
    expect(window.setOpacity).toHaveBeenCalledWith(0.86)
    expect(window.setBackgroundColor).toHaveBeenCalledWith(
      MAIN_WINDOW_TRANSPARENT_BACKGROUND,
    )
    expect('setBackgroundColor' in contentView).toBe(false)
    expect(contentView.setBackgroundBlur).toHaveBeenCalledWith(12)
  })
})
