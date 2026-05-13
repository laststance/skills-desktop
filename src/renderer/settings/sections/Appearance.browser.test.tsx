import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import { DEFAULT_SETTINGS } from '@/shared/settings'

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
 * @param windowBackgroundBlurRadius - Initial Electron blur radius.
 * @returns Redux store with settings preloaded.
 */
async function createStore(
  windowBackgroundBlurRadius: number = 0,
): Promise<ReturnType<typeof configureStore>> {
  const { default: settingsReducer } =
    await import('@/renderer/src/redux/slices/settingsSlice')
  return configureStore({
    reducer: {
      settings: settingsReducer,
    },
    preloadedState: {
      settings: { ...DEFAULT_SETTINGS, windowBackgroundBlurRadius },
    },
  })
}

describe('Settings → Appearance', () => {
  it('dispatches settings:set when the opacity slider changes', async () => {
    const store = await createStore()
    const { Appearance } = await import('./Appearance')
    const screen = await render(
      <Provider store={store}>
        <Appearance />
      </Provider>,
    )

    const slider = screen.getByRole('slider', { name: /Opacity/i })
    await slider.fill('24')

    await expect.element(screen.getByText('84% / 24px')).toBeVisible()
    await expect.poll(() => mockSettingsSet.mock.calls.length).toBe(1)
    expect(mockSettingsSet).toHaveBeenCalledWith({
      windowBackgroundBlurRadius: 24,
    })
  })

  it('cancels a pending slider persist when a settings broadcast arrives', async () => {
    const store = await createStore(12)
    const { setSettings } =
      await import('@/renderer/src/redux/slices/settingsSlice')
    const { Appearance } = await import('./Appearance')
    const screen = await render(
      <Provider store={store}>
        <Appearance />
      </Provider>,
    )

    const slider = screen.getByRole('slider', { name: /Opacity/i })
    await slider.fill('24')
    store.dispatch(
      setSettings({
        ...DEFAULT_SETTINGS,
        windowBackgroundBlurRadius: 0,
      }),
    )

    await new Promise((resolve) => window.setTimeout(resolve, 180))
    expect(mockSettingsSet).not.toHaveBeenCalled()
  })
})
