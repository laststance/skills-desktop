import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'

import { BackgroundSettings } from '@/renderer/settings/backgrounds/BackgroundSettings'
import { backgroundQueryClient } from '@/renderer/settings/backgrounds/query'
import { AppToaster } from '@/renderer/src/components/AppToaster'
import settingsReducer, {
  setSettings,
} from '@/renderer/src/redux/slices/settingsSlice'
import themeReducer from '@/renderer/src/redux/slices/themeSlice'
import uiReducer from '@/renderer/src/redux/slices/uiSlice'
import '@/renderer/src/styles/globals.css'
import {
  DEFAULT_BACKGROUND_CROP,
  type BackgroundDisplay,
  type BackgroundSnapshot,
} from '@/shared/backgrounds'
import { DEFAULT_SETTINGS, type Settings } from '@/shared/settings'

import { BackgroundAttribution } from './BackgroundAttribution'
import { BackgroundCanvas } from './BackgroundCanvas'

const previewUrl = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="3840" height="2160"><rect width="3840" height="2160" fill="#305b58"/></svg>')}`
const display: BackgroundDisplay = {
  selection: {
    source: { kind: 'builtin', builtinId: 'alpine-lake' },
    displayId: '00000000-0000-4000-8000-000000000001',
    crop: DEFAULT_BACKGROUND_CROP,
    aspect: 'original',
  },
  image: { url: previewUrl, width: 3840, height: 2160 },
  crop: DEFAULT_BACKGROUND_CROP,
  title: 'Alpine lake',
  credit: {
    photographerName: 'Mike Petrucci',
    photographerUrl: 'https://unsplash.com/@mikepetrucci',
    photoUrl: 'https://unsplash.com/photos/5oRIcisKaxU',
  },
}
let currentSnapshot: BackgroundSnapshot
let broadcast: (snapshot: BackgroundSnapshot) => void = () => undefined
let disposeScreen: (() => void | Promise<void>) | undefined
const retryDisplay = vi.fn<() => Promise<BackgroundSnapshot>>()
const apply = vi.fn()
const openExternal = vi.fn()

beforeEach(async () => {
  await page.viewport(800, 600)
  backgroundQueryClient.clear()
  currentSnapshot = {
    revision: 0,
    displayRetryRevision: 0,
    operation: null,
    display,
  }
  retryDisplay.mockReset().mockImplementation(async () => {
    currentSnapshot = {
      ...currentSnapshot,
      revision: currentSnapshot.revision + 1,
      displayRetryRevision: currentSnapshot.displayRetryRevision + 1,
    }
    broadcast(currentSnapshot)
    return currentSnapshot
  })
  apply.mockReset()
  openExternal.mockReset().mockResolvedValue(undefined)
  vi.stubGlobal('electron', {
    backgrounds: {
      getSnapshot: async () => currentSnapshot,
      onChanged: (callback: typeof broadcast) => {
        broadcast = callback
        return () => {
          broadcast = () => undefined
        }
      },
      retryDisplay,
      apply,
    },
    shell: { openExternal },
  })
})
afterEach(async () => {
  const dispose = disposeScreen
  disposeScreen = undefined
  await dispose?.()
  toast.dismiss()
  vi.unstubAllGlobals()
  backgroundQueryClient.clear()
})

/** Mounts the real Main/Appearance consumers of one snapshot stream with actual Redux, SVGs, CSS and Toaster.
 * @returns Browser locators and the local settings store for cross-surface assertions.
 * @example const { screen, store } = await renderBackgrounds()
 */
async function renderBackgrounds(
  selected: Settings['background']['selected'] = display.selection,
) {
  const store = configureStore({
    reducer: { settings: settingsReducer, theme: themeReducer, ui: uiReducer },
    preloadedState: {
      settings: {
        ...DEFAULT_SETTINGS,
        background: {
          ...DEFAULT_SETTINGS.background,
          selected,
          hasAppliedImage: Boolean(selected),
        },
      },
    },
  })
  const screen = await render(
    <Provider store={store}>
      <div className="relative isolate h-32" data-testid="workspace">
        <BackgroundCanvas />
        <div data-testid="foreground" className="text-foreground">
          Readable 日本語
        </div>
        <div className="flex h-8">
          <BackgroundAttribution />
        </div>
        <div
          data-testid="code-boundary"
          className="opaque-surface bg-background text-muted-foreground"
        >
          const stable = true
        </div>
      </div>
      <BackgroundSettings />
      <AppToaster />
    </Provider>,
  )
  disposeScreen = screen.unmount
  return { screen, store }
}

/** Returns the actual resource nodes shared by each SVG's native clipping/repetition uses.
 * @returns Main and Appearance SVG image elements, in document order.
 * @example const [mainImage, previewImage] = images()
 */
function images(): Element[] {
  return Array.from(document.querySelectorAll('[data-background-resource]'))
}

describe('main background integration', () => {
  test('announces image failure through existing empty status regions and clears them after recovery', async () => {
    // Arrange
    currentSnapshot = { ...currentSnapshot, display: null }
    const { screen, store } = await renderBackgrounds(null)
    const statusRegions = screen.getByRole('status').elements()
    expect(statusRegions).toHaveLength(2)
    expect(statusRegions.map((region) => region.textContent)).toEqual(['', ''])

    // Act: first selection fails to load after both live regions already exist.
    store.dispatch(
      setSettings({
        ...store.getState().settings,
        background: {
          ...store.getState().settings.background,
          selected: display.selection,
          hasAppliedImage: true,
        },
      }),
    )
    currentSnapshot = {
      ...currentSnapshot,
      revision: 1,
      display: {
        ...display,
        image: { ...display.image, url: 'data:image/png;base64,AAAA' },
      },
    }
    broadcast(currentSnapshot)

    // Assert: native image errors update the mounted announcement targets.
    await expect
      .poll(
        () =>
          screen.getByRole('button', { name: 'Retry image' }).elements().length,
      )
      .toBe(2)
    await expect
      .poll(() => statusRegions.map((region) => region.textContent))
      .toEqual([
        'Background unavailable.Retry image',
        'Background unavailable. Retry image',
      ])
    expect(screen.getByRole('status').elements()[0]).toBe(statusRegions[0])
    expect(screen.getByRole('status').elements()[1]).toBe(statusRegions[1])

    // Act: a valid resource recovers without replacing either live region.
    currentSnapshot = { ...currentSnapshot, revision: 2, display }
    broadcast(currentSnapshot)

    // Assert
    await expect
      .poll(() => statusRegions.map((region) => region.textContent))
      .toEqual(['', ''])
    expect(screen.getByRole('status').elements()[0]).toBe(statusRegions[0])
    expect(screen.getByRole('status').elements()[1]).toBe(statusRegions[1])
    expect(
      screen.getByRole('button', { name: 'Retry image' }).elements(),
    ).toHaveLength(0)
  })

  test('first Apply keeps the settings-before-display interval in loading state without briefly offering missing-image Retry', async () => {
    // Arrange
    currentSnapshot = {
      revision: 1,
      displayRetryRevision: 0,
      display: null,
      operation: {
        operationId: 1,
        requestId: '00000000-0000-4000-8000-000000000009',
        source: display.selection.source,
        crop: display.crop,
        aspect: 'original',
        status: 'applying',
      },
    }
    const { screen, store } = await renderBackgrounds(null)
    // Act: reproduce Main's actual separate settings and display messages.
    store.dispatch(
      setSettings({
        ...store.getState().settings,
        background: {
          ...store.getState().settings.background,
          selected: display.selection,
          hasAppliedImage: true,
        },
      }),
    )
    // Assert
    await expect
      .element(screen.getByText('Loading background…', { exact: true }))
      .toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Retry image' }).elements(),
    ).toHaveLength(0)
    expect(
      screen.getByText('Background unavailable', { exact: false }).elements(),
    ).toHaveLength(0)
    // Act
    currentSnapshot = {
      ...currentSnapshot,
      revision: 2,
      display,
      operation: {
        ...currentSnapshot.operation!,
        status: 'succeeded',
        opacityAdjusted: true,
      },
    }
    broadcast(currentSnapshot)
    // Assert
    await expect
      .poll(() =>
        document
          .querySelector('[data-background-image]')
          ?.getAttribute('data-background-state'),
      )
      .toBe('ready')
    await expect
      .element(screen.getByText('Alpine lake', { exact: true }))
      .toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Retry image' }).elements(),
    ).toHaveLength(0)
    expect(store.getState().settings.background.selected).toEqual(
      display.selection,
    )
  })
  test('offers Retry at authoritative revision zero for a saved selection whose prepared display is missing', async () => {
    // Arrange
    currentSnapshot = {
      revision: 0,
      displayRetryRevision: 0,
      operation: null,
      display: null,
    }
    const { screen, store } = await renderBackgrounds()
    // Act
    await screen
      .getByTestId('workspace')
      .getByRole('button', { name: 'Retry image' })
      .click()
    // Assert
    await expect.element(screen.getByTestId('background-canvas')).toBeVisible()
    await expect
      .element(screen.getByText('Background unavailable', { exact: true }))
      .toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Retry image' }).elements(),
    ).toHaveLength(2)
    expect(store.getState().settings.background.selected).toEqual(
      display.selection,
    )
    expect(apply).not.toHaveBeenCalled()
  })

  test('keeps a newer committed image when an earlier Retry response arrives late', async () => {
    // Arrange
    const unavailableSnapshot: BackgroundSnapshot = {
      revision: 0,
      displayRetryRevision: 0,
      operation: null,
      display: {
        ...display,
        image: { ...display.image, url: 'data:image/png;base64,AAAA' },
      },
    }
    currentSnapshot = unavailableSnapshot
    let reply: ((snapshot: BackgroundSnapshot) => void) | undefined
    retryDisplay.mockImplementationOnce(
      async () =>
        new Promise((resolve) => {
          reply = resolve
        }),
    )
    const { screen } = await renderBackgrounds()
    const retry = screen
      .getByTestId('workspace')
      .getByRole('button', { name: 'Retry image' })
    await expect.element(retry).toBeVisible()
    const oldReply = {
      ...unavailableSnapshot,
      revision: 1,
      displayRetryRevision: 1,
    }
    // Act
    await retry.click()
    currentSnapshot = {
      revision: 2,
      displayRetryRevision: 1,
      operation: null,
      display: { ...display, title: 'Newer image' },
    }
    broadcast(currentSnapshot)
    await expect
      .element(screen.getByText('Newer image', { exact: true }))
      .toBeVisible()
    const newerImage = images()[0]
    reply?.(oldReply)
    // Assert
    await expect
      .poll(() =>
        document
          .querySelector(
            '[data-testid="background-canvas"] [data-background-image]',
          )
          ?.getAttribute('data-background-state'),
      )
      .toBe('ready')
    expect(images()[0]).toBe(newerImage)
    await expect
      .element(screen.getByText('Newer image', { exact: true }))
      .toBeVisible()
    expect(apply).not.toHaveBeenCalled()
  })

  test('keeps the original clear canvas when no image has been selected', async () => {
    // Arrange
    currentSnapshot = {
      revision: 0,
      displayRetryRevision: 0,
      operation: null,
      display: null,
    }
    // Act
    const { screen } = await renderBackgrounds(null)
    // Assert
    await expect.element(screen.getByText('No background image')).toBeVisible()
    expect(screen.getByTestId('background-canvas').elements()).toHaveLength(0)
    expect(images()).toHaveLength(0)
  })

  test('paints one image layer beneath solid foregrounds and opaque code while retaining linked credits', async () => {
    // Arrange / Act
    const { screen } = await renderBackgrounds()
    // Assert
    await expect.element(screen.getByTestId('background-canvas')).toBeVisible()
    expect(screen.getByTestId('background-canvas').elements()).toHaveLength(1)
    expect(
      getComputedStyle(screen.getByTestId('foreground').element()).opacity,
    ).toBe('1')
    expect(
      getComputedStyle(screen.getByTestId('code-boundary').element())
        .getPropertyValue('--window-surface-opacity')
        .trim(),
    ).toBe('1')
    const workspace = screen.getByTestId('workspace')
    await expect
      .element(workspace.getByRole('link', { name: 'Mike Petrucci' }))
      .toBeVisible()
    await workspace.getByRole('link', { name: 'Unsplash' }).click()
    expect(openExternal).toHaveBeenCalledWith(
      'https://unsplash.com/photos/5oRIcisKaxU?utm_source=skills-desktop&utm_medium=referral',
    )
    expect(
      getComputedStyle(
        workspace.getByRole('link', { name: 'Unsplash' }).element(),
      ).opacity,
    ).toBe('1')
  })

  test('middle-clicking a credit opens the external browser and a failed link shows recovery without navigating the app', async () => {
    // Arrange
    const { screen } = await renderBackgrounds()
    const workspace = screen.getByTestId('workspace')
    const photographer = workspace.getByRole('link', { name: 'Mike Petrucci' })
    const originalLocation = location.href
    // Act
    await photographer.click({ button: 'middle' })
    // Assert
    expect(openExternal).toHaveBeenCalledWith(
      'https://unsplash.com/@mikepetrucci?utm_source=skills-desktop&utm_medium=referral',
    )
    expect(location.href).toBe(originalLocation)
    // Act
    openExternal.mockRejectedValueOnce(
      new Error('External browser unavailable'),
    )
    await workspace.getByRole('link', { name: 'Unsplash' }).click()
    // Assert
    await expect
      .element(screen.getByText('Link could not be opened'))
      .toBeVisible()
    await expect
      .element(screen.getByText('Try again in a moment.'))
      .toBeVisible()
    expect(location.href).toBe(originalLocation)
  })

  test('keeps the current resource loaded through Apply progress, failure, layout and opacity changes', async () => {
    // Arrange
    const { screen, store } = await renderBackgrounds()
    await expect.element(screen.getByTestId('background-canvas')).toBeVisible()
    const originalImages = images()
    expect(originalImages).toHaveLength(2)
    // Act
    currentSnapshot = {
      ...currentSnapshot,
      revision: 1,
      operation: {
        operationId: 1,
        requestId: '00000000-0000-4000-8000-000000000002',
        source: display.selection.source,
        crop: display.crop,
        aspect: 'original',
        status: 'applying',
      },
    }
    broadcast(currentSnapshot)
    store.dispatch(
      setSettings({
        ...store.getState().settings,
        windowBackgroundOpacityPercent: 60,
        background: { ...store.getState().settings.background, layout: 'fit' },
      }),
    )
    currentSnapshot = {
      ...currentSnapshot,
      revision: 2,
      operation: {
        ...currentSnapshot.operation!,
        status: 'failed',
        error: { code: 'provider-unavailable', message: 'Try again later.' },
      },
    }
    broadcast(currentSnapshot)
    // Assert
    await expect
      .element(screen.getByText('Background could not be applied'))
      .toBeVisible()
    expect(images()[0]).toBe(originalImages[0])
    expect(images()[1]).toBe(originalImages[1])
    expect(
      document
        .querySelector('[data-background-image]')
        ?.getAttribute('data-background-layout'),
    ).toBe('fit')
    expect(apply).not.toHaveBeenCalled()
    expect(retryDisplay).not.toHaveBeenCalled()
  })

  test('Appearance Retry reloads the main resource too while retaining the unavailable selection', async () => {
    // Arrange — a malformed image actually emits native SVG load failure in both surfaces.
    currentSnapshot = {
      ...currentSnapshot,
      display: {
        ...display,
        image: { ...display.image, url: 'data:image/png;base64,AAAA' },
      },
    }
    const { screen, store } = await renderBackgrounds()
    await expect
      .element(screen.getByText('Background unavailable.').first())
      .toBeVisible()
    await expect
      .poll(
        () =>
          screen.getByRole('button', { name: 'Retry image' }).elements().length,
      )
      .toBe(2)
    const originalImages = images()
    const originalSettings = store.getState().settings
    // Act — the second button belongs to Appearance, not the main fallback.
    await screen.getByRole('button', { name: 'Retry image' }).nth(1).click()
    // Assert
    await expect.poll(() => images()[0] === originalImages[0]).toBe(false)
    expect(images()[1]).not.toBe(originalImages[1])
    await expect
      .element(screen.getByText('Background unavailable.').first())
      .toBeVisible()
    expect(store.getState().settings).toBe(originalSettings)
    expect(store.getState().settings.background.selected).toBe(
      display.selection,
    )
    expect(retryDisplay).toHaveBeenCalledTimes(1)
    expect(apply).not.toHaveBeenCalled()
    expect(
      screen.getByText('Background applied', { exact: true }).elements(),
    ).toHaveLength(0)
  })

  test('retries from the main fallback and shows a real error toast when IPC is unavailable', async () => {
    // Arrange
    currentSnapshot = {
      ...currentSnapshot,
      display: {
        ...display,
        image: { ...display.image, url: 'data:image/png;base64,AAAA' },
      },
    }
    retryDisplay.mockRejectedValueOnce(new Error('IPC closed'))
    const { screen } = await renderBackgrounds()
    await expect
      .element(
        screen
          .getByTestId('workspace')
          .getByRole('button', { name: 'Retry image' }),
      )
      .toBeVisible()
    const originalImage = images()[0]
    // Act
    await screen
      .getByTestId('workspace')
      .getByRole('button', { name: 'Retry image' })
      .click()
    // Assert
    await expect
      .element(screen.getByText('Background could not be reloaded'))
      .toBeVisible()
    await expect
      .element(screen.getByText('The selected image was kept. Try again.'))
      .toBeVisible()
    expect(images()[0]).toBe(originalImage)
    expect(apply).not.toHaveBeenCalled()
  })

  test('does not replay an already dismissed Apply success when explicit display Retry publishes a snapshot', async () => {
    // Arrange
    currentSnapshot = {
      ...currentSnapshot,
      operation: {
        operationId: 1,
        requestId: '00000000-0000-4000-8000-000000000002',
        source: display.selection.source,
        crop: display.crop,
        aspect: 'original',
        status: 'succeeded',
        opacityAdjusted: false,
      },
      display: {
        ...display,
        image: { ...display.image, url: 'data:image/png;base64,AAAA' },
      },
    }
    const { screen } = await renderBackgrounds()
    await expect
      .element(screen.getByText('Background applied', { exact: true }))
      .toBeVisible()
    toast.dismiss('background-operation')
    await expect
      .poll(
        () =>
          screen.getByText('Background applied', { exact: true }).elements()
            .length,
      )
      .toBe(0)
    // Act
    await screen
      .getByTestId('workspace')
      .getByRole('button', { name: 'Retry image' })
      .click()
    // Assert
    expect(retryDisplay).toHaveBeenCalledTimes(1)
    expect(
      screen.getByText('Background applied', { exact: true }).elements(),
    ).toHaveLength(0)
    expect(apply).not.toHaveBeenCalled()
  })
})
