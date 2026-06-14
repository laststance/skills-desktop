import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import { DEFAULT_SETTINGS, type Settings } from '@/shared/settings'

const mockSettingsSet = vi.fn()

beforeEach(() => {
  mockSettingsSet.mockReset()
  mockSettingsSet.mockResolvedValue(undefined)
  // Browser mode has no preload bridge; Appearance only needs settings.set.
  vi.stubGlobal('electron', {
    settings: { set: mockSettingsSet },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Build a small settings-only store for the Appearance pane.
 * @param overrides - Settings fields that differ from DEFAULT_SETTINGS.
 * @returns Redux store with settings preloaded.
 * @example
 * await createStore({ windowBackgroundBlurRadius: 24, markdownFontSizePx: 18 })
 */
async function createStore(
  overrides: Partial<Settings> = {},
): Promise<ReturnType<typeof configureStore>> {
  const { default: settingsReducer } =
    await import('@/renderer/src/redux/slices/settingsSlice')
  return configureStore({
    reducer: {
      settings: settingsReducer,
    },
    preloadedState: {
      settings: { ...DEFAULT_SETTINGS, ...overrides },
    },
  })
}

describe('Settings → Appearance', () => {
  it('persists Toolbar text when the Installed search count display is changed', async () => {
    // Arrange
    const store = await createStore()
    const { Appearance } = await import('./Appearance')
    const screen = await render(
      <Provider store={store}>
        <Appearance />
      </Provider>,
    )

    // Act
    await screen.getByRole('radio', { name: /Toolbar text/i }).click()

    // Assert
    await expect.poll(() => mockSettingsSet.mock.calls.length).toBe(1)
    expect(mockSettingsSet).toHaveBeenCalledWith({
      installedSearchCountDisplay: 'inline',
    })
    const settingsState = store.getState() as {
      settings: typeof DEFAULT_SETTINGS
    }
    expect(settingsState.settings.installedSearchCountDisplay).toBe('inline')
  })

  it('persists the new window blur radius when the opacity slider moves', async () => {
    // Arrange
    const store = await createStore()
    const { Appearance } = await import('./Appearance')
    const screen = await render(
      <Provider store={store}>
        <Appearance />
      </Provider>,
    )

    // Act
    const slider = screen.getByRole('slider', { name: /Opacity/i })
    await slider.fill('24')

    // Assert
    await expect.element(screen.getByText('72% / 24px')).toBeVisible()
    await expect.poll(() => mockSettingsSet.mock.calls.length).toBe(1)
    expect(mockSettingsSet).toHaveBeenCalledWith({
      windowBackgroundBlurRadius: 24,
    })
  })

  it('announces the opacity slider value to assistive tech as readable text, not the raw radius', async () => {
    // Arrange
    const store = await createStore()
    const { Appearance } = await import('./Appearance')
    const screen = await render(
      <Provider store={store}>
        <Appearance />
      </Provider>,
    )
    const slider = screen.getByRole('slider', { name: /Opacity/i })

    // Assert — at the opaque default a screen reader hears 'Opaque', not '0'
    await expect.element(slider).toHaveAttribute('aria-valuetext', 'Opaque')

    // Act
    await slider.fill('24')

    // Assert — after the drag it hears the same badge the eye sees, not '24'
    await expect.element(slider).toHaveAttribute('aria-valuetext', '72% / 24px')
  })

  it('restores the opaque default window when Reset to default is pressed', async () => {
    // Arrange
    const store = await createStore({ windowBackgroundBlurRadius: 24 })
    const { Appearance } = await import('./Appearance')
    const screen = await render(
      <Provider store={store}>
        <Appearance />
      </Provider>,
    )
    await expect.element(screen.getByText('72% / 24px')).toBeVisible()

    // Act — the per-row aria-label disambiguates the three reset buttons.
    await screen
      .getByRole('button', { name: /Reset to default: Opacity/i })
      .click()

    // Assert
    await expect.element(screen.getByText('Opaque')).toBeVisible()
    await expect.poll(() => mockSettingsSet.mock.calls.length).toBe(1)
    expect(mockSettingsSet).toHaveBeenCalledWith({
      windowBackgroundBlurRadius: 0,
    })
    expect(
      screen
        .getByRole('button', { name: /Reset to default: Opacity/i })
        .element(),
    ).toBeDisabled()
  })

  it('persists the chosen reading font size when the Reading font size slider moves', async () => {
    // Arrange
    const store = await createStore()
    const { Appearance } = await import('./Appearance')
    const screen = await render(
      <Provider store={store}>
        <Appearance />
      </Provider>,
    )

    // Act
    const slider = screen.getByRole('slider', { name: /Reading font size/i })
    await slider.fill('18')

    // Assert
    await expect.element(screen.getByText('18px')).toBeVisible()
    await expect.poll(() => mockSettingsSet.mock.calls.length).toBe(1)
    expect(mockSettingsSet).toHaveBeenCalledWith({ markdownFontSizePx: 18 })
  })

  it('persists the chosen code font size when the Code font size slider moves', async () => {
    // Arrange
    const store = await createStore()
    const { Appearance } = await import('./Appearance')
    const screen = await render(
      <Provider store={store}>
        <Appearance />
      </Provider>,
    )

    // Act
    const slider = screen.getByRole('slider', { name: /Code font size/i })
    await slider.fill('16')

    // Assert
    await expect.element(screen.getByText('16px')).toBeVisible()
    await expect.poll(() => mockSettingsSet.mock.calls.length).toBe(1)
    expect(mockSettingsSet).toHaveBeenCalledWith({ codeFontSizePx: 16 })
  })

  it('persists the chosen code theme when a new theme is selected', async () => {
    // Arrange
    const store = await createStore()
    const { Appearance } = await import('./Appearance')
    const screen = await render(
      <Provider store={store}>
        <Appearance />
      </Provider>,
    )

    // Act
    await screen
      .getByRole('combobox', { name: /Code theme/i })
      .selectOptions('Vitesse')

    // Assert
    await expect.poll(() => mockSettingsSet.mock.calls.length).toBe(1)
    expect(mockSettingsSet).toHaveBeenCalledWith({ codeThemeId: 'vitesse' })
  })

  it('restores the default reading font size when its Reset to default is pressed', async () => {
    // Arrange
    const store = await createStore({ markdownFontSizePx: 18 })
    const { Appearance } = await import('./Appearance')
    const screen = await render(
      <Provider store={store}>
        <Appearance />
      </Provider>,
    )
    await expect.element(screen.getByText('18px')).toBeVisible()

    // Act
    await screen
      .getByRole('button', { name: /Reset to default: Reading font size/i })
      .click()

    // Assert
    await expect.element(screen.getByText('14px')).toBeVisible()
    await expect.poll(() => mockSettingsSet.mock.calls.length).toBe(1)
    expect(mockSettingsSet).toHaveBeenCalledWith({ markdownFontSizePx: 14 })
    expect(
      screen
        .getByRole('button', { name: /Reset to default: Reading font size/i })
        .element(),
    ).toBeDisabled()
  })

  it('ignores deselecting the already-active Installed search count toggle', async () => {
    // Arrange — default is the 'tab' display, so 'Tab badge' is the active toggle.
    const store = await createStore()
    const { Appearance } = await import('./Appearance')
    const screen = await render(
      <Provider store={store}>
        <Appearance />
      </Provider>,
    )

    // Act — re-clicking the active single-select toggle makes Radix emit '',
    // which the change handler must drop rather than persist a blank display.
    await screen.getByRole('radio', { name: /Tab badge/i }).click()

    // Assert — nothing persisted and the display stays 'tab'.
    await new Promise((resolve) => window.setTimeout(resolve, 180))
    expect(mockSettingsSet).not.toHaveBeenCalled()
    const settingsState = store.getState() as {
      settings: typeof DEFAULT_SETTINGS
    }
    expect(settingsState.settings.installedSearchCountDisplay).toBe('tab')
  })

  it('does not persist a slider drag that an incoming settings broadcast overrides', async () => {
    // Arrange
    const store = await createStore({ windowBackgroundBlurRadius: 12 })
    const { setSettings } =
      await import('@/renderer/src/redux/slices/settingsSlice')
    const { Appearance } = await import('./Appearance')
    const screen = await render(
      <Provider store={store}>
        <Appearance />
      </Provider>,
    )

    // Act
    const slider = screen.getByRole('slider', { name: /Opacity/i })
    await slider.fill('24')
    store.dispatch(
      setSettings({
        ...DEFAULT_SETTINGS,
        windowBackgroundBlurRadius: 0,
      }),
    )

    // Assert
    await new Promise((resolve) => window.setTimeout(resolve, 180))
    expect(mockSettingsSet).not.toHaveBeenCalled()
  })
})
