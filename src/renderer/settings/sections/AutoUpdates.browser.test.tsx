import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import { DEFAULT_SETTINGS, type Settings } from '@/shared/settings'

const mockSettingsSet = vi.fn()

beforeEach(() => {
  mockSettingsSet.mockReset()
  mockSettingsSet.mockResolvedValue(undefined)
  // Browser mode has no preload bridge; Auto Updates only needs settings.set.
  vi.stubGlobal('electron', {
    settings: { set: mockSettingsSet },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Build a settings-only store for the Auto Updates pane.
 * @param overrides - Settings fields to layer over DEFAULT_SETTINGS.
 * @returns Redux store with settings preloaded.
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

describe('Settings → Auto Updates', () => {
  it('persists opting into automatic background downloads', async () => {
    const store = await createStore()
    const { AutoUpdates } = await import('./AutoUpdates')
    const screen = await render(
      <Provider store={store}>
        <AutoUpdates />
      </Provider>,
    )

    await screen
      .getByRole('checkbox', { name: /Download updates automatically/i })
      .click()

    await expect.poll(() => mockSettingsSet.mock.calls.length).toBe(1)
    expect(mockSettingsSet).toHaveBeenCalledWith({ autoDownloadUpdates: true })
  })

  it('persists turning automatic background downloads back off', async () => {
    // Pin the `checked === true` coercion's false-path: an already-checked
    // box, when clicked, must persist `false` — never the indeterminate
    // sentinel Radix can report.
    const store = await createStore({ autoDownloadUpdates: true })
    const { AutoUpdates } = await import('./AutoUpdates')
    const screen = await render(
      <Provider store={store}>
        <AutoUpdates />
      </Provider>,
    )

    await screen
      .getByRole('checkbox', { name: /Download updates automatically/i })
      .click()

    await expect.poll(() => mockSettingsSet.mock.calls.length).toBe(1)
    expect(mockSettingsSet).toHaveBeenCalledWith({ autoDownloadUpdates: false })
  })

  it('reflects a persisted opt-in as an already-checked box', async () => {
    const store = await createStore({ autoDownloadUpdates: true })
    const { AutoUpdates } = await import('./AutoUpdates')
    const screen = await render(
      <Provider store={store}>
        <AutoUpdates />
      </Provider>,
    )

    await expect
      .element(
        screen.getByRole('checkbox', {
          name: /Download updates automatically/i,
        }),
      )
      .toBeChecked()
  })
})
