import type { BrowserWindow } from 'electron'
import { describe, expect, it, vi } from 'vitest'

import { WINDOW_BACKGROUND_BLUR_MAX_RADIUS } from '@/shared/settings'

import {
  applyWindowBackgroundBlur,
  MAIN_WINDOW_BLURRED_BACKGROUND,
  getMainWindowBackgroundColor,
  MAIN_WINDOW_OPAQUE_BACKGROUND,
  normalizeWindowBackgroundBlurRadius,
} from './windowBackgroundBlur'

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
  it('clamps persisted blur radius values to the supported range', () => {
    expect(normalizeWindowBackgroundBlurRadius(-12)).toBe(0)
    expect(normalizeWindowBackgroundBlurRadius(12.9)).toBe(12)
    expect(normalizeWindowBackgroundBlurRadius(99)).toBe(
      WINDOW_BACKGROUND_BLUR_MAX_RADIUS,
    )
  })

  it('uses an opaque background when blur is disabled', () => {
    expect(getMainWindowBackgroundColor(0)).toBe(MAIN_WINDOW_OPAQUE_BACKGROUND)
  })

  it('uses an alpha background when blur is enabled', () => {
    expect(getMainWindowBackgroundColor(12)).toBe(
      MAIN_WINDOW_BLURRED_BACKGROUND,
    )
  })

  it('applies opaque color and zero blur when the radius is disabled', () => {
    const { window, contentView } = makeWindowMock(true)

    applyWindowBackgroundBlur(window, 0)

    expect(window.setBackgroundColor).toHaveBeenCalledWith(
      MAIN_WINDOW_OPAQUE_BACKGROUND,
    )
    expect(contentView.setBackgroundColor).toHaveBeenCalledWith(
      MAIN_WINDOW_OPAQUE_BACKGROUND,
    )
    expect(contentView.setBackgroundBlur).toHaveBeenCalledWith(0)
  })

  it('applies alpha color and clamped blur when Electron 42 blur is available', () => {
    const { window, contentView } = makeWindowMock(true)

    applyWindowBackgroundBlur(window, WINDOW_BACKGROUND_BLUR_MAX_RADIUS + 1)

    expect(window.setBackgroundColor).toHaveBeenCalledWith(
      MAIN_WINDOW_BLURRED_BACKGROUND,
    )
    expect(contentView.setBackgroundColor).toHaveBeenCalledWith(
      MAIN_WINDOW_BLURRED_BACKGROUND,
    )
    expect(contentView.setBackgroundBlur).toHaveBeenCalledWith(
      WINDOW_BACKGROUND_BLUR_MAX_RADIUS,
    )
  })

  it('skips blur safely when Electron exposes no setBackgroundBlur method', () => {
    const { window, contentView } = makeWindowMock(false)

    expect(() => applyWindowBackgroundBlur(window, 12)).not.toThrow()
    expect(window.setBackgroundColor).toHaveBeenCalledWith(
      MAIN_WINDOW_BLURRED_BACKGROUND,
    )
    expect(contentView.setBackgroundColor).toHaveBeenCalledWith(
      MAIN_WINDOW_BLURRED_BACKGROUND,
    )
    expect('setBackgroundBlur' in contentView).toBe(false)
  })

  it('skips contentView background safely when the method is absent', () => {
    const { window, contentView } = makeWindowMock(true, false)

    expect(() => applyWindowBackgroundBlur(window, 12)).not.toThrow()
    expect(window.setBackgroundColor).toHaveBeenCalledWith(
      MAIN_WINDOW_BLURRED_BACKGROUND,
    )
    expect('setBackgroundColor' in contentView).toBe(false)
    expect(contentView.setBackgroundBlur).toHaveBeenCalledWith(12)
  })
})
