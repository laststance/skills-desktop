import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import type { RootState } from '@/renderer/src/redux/store'
import { semanticVersion } from '@/shared/types'

/**
 * Browser-mode tests for the auto-update toast. Runs in Chromium so the
 * Button click handlers fire through the real event loop and the
 * `window.electron.update` IPC surface (download / install) is exercised the
 * same way production does. Each status drives a different header icon, title,
 * body copy, and action set, so the suite walks every visible phase plus the
 * three "hidden" phases that short-circuit to a null render.
 */

// Spies for the update IPC actions the toast triggers via the
// useUpdateNotification helpers (downloadUpdate -> download, installUpdate ->
// install). Stubbed onto window.electron.update so the handlers reach them.
const downloadMock = vi.fn(async () => Promise.resolve())
const installMock = vi.fn(async () => Promise.resolve())

beforeEach(() => {
  downloadMock.mockClear()
  installMock.mockClear()
  vi.stubGlobal('electron', {
    update: {
      download: downloadMock,
      install: installMock,
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Mount the toast inside a real-reducer store seeded with the given update
 * phase, so the component reads the same state shape production populates from
 * electron-updater IPC events.
 * @param overrides - Partial `update` slice fields to seed (status/version/...).
 * @returns Render handle + the Redux store for state assertions.
 */
async function renderToast(
  overrides: Partial<{
    status: RootState['update']['status']
    version: string | null
    progress: number
    error: string | null
    dismissed: boolean
  }> = {},
) {
  const { default: updateReducer } =
    await import('@/renderer/src/redux/slices/updateSlice')
  const { UpdateToast } = await import('./UpdateToast')

  const store = configureStore({
    reducer: { update: updateReducer },
    preloadedState: {
      update: {
        status: overrides.status ?? 'idle',
        version:
          overrides.version === undefined
            ? null
            : overrides.version === null
              ? null
              : semanticVersion(overrides.version),
        releaseNotes: null,
        progress: overrides.progress ?? 0,
        error: overrides.error ?? null,
        dismissed: overrides.dismissed ?? false,
      } satisfies RootState['update'],
    },
  })

  const screen = await render(
    <Provider store={store}>
      <UpdateToast />
    </Provider>,
  )
  return { screen, store }
}

describe('UpdateToast', () => {
  it('shows the available-update prompt with version and a Download CTA', async () => {
    // Arrange + Act
    const { screen } = await renderToast({
      status: 'available',
      version: '0.30.0',
    })

    // Assert — header title, body copy, and both CTAs are present.
    await expect
      .element(screen.getByText('Update Available'))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText('Version 0.30.0 is available. Download now?'))
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('button', { name: 'Download' }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('button', { name: 'Later' }))
      .toBeInTheDocument()
  })

  it('starts the download and flips to the downloading phase when Download is clicked', async () => {
    // Arrange
    const { screen, store } = await renderToast({
      status: 'available',
      version: '0.30.0',
    })

    // Act
    await screen.getByRole('button', { name: 'Download' }).click()

    // Assert — the slice moved to downloading and the IPC download was invoked.
    await expect.poll(() => store.getState().update.status).toBe('downloading')
    expect(downloadMock).toHaveBeenCalledTimes(1)
  })

  it('dismisses the toast when the available-phase Later button is clicked', async () => {
    // Arrange
    const { screen, store } = await renderToast({
      status: 'available',
      version: '0.30.0',
    })

    // Act
    await screen.getByRole('button', { name: 'Later' }).click()

    // Assert
    await expect.poll(() => store.getState().update.dismissed).toBe(true)
  })

  it('renders the downloading phase with a progress percentage and no action buttons', async () => {
    // Arrange + Act
    const { screen } = await renderToast({
      status: 'downloading',
      version: '0.30.0',
      progress: 42,
    })

    // Assert — title, body, and the rounded progress readout; no CTA pair.
    await expect
      .element(screen.getByText('Downloading Update'))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText('Downloading version 0.30.0...'))
      .toBeInTheDocument()
    await expect.element(screen.getByText('42%')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Download' }).elements(),
    ).toHaveLength(0)
    expect(
      screen.getByRole('button', { name: 'Restart Now' }).elements(),
    ).toHaveLength(0)
  })

  it('shows the ready-to-install prompt with a Restart Now CTA', async () => {
    // Arrange + Act
    const { screen } = await renderToast({
      status: 'ready',
      version: '0.30.0',
    })

    // Assert
    await expect.element(screen.getByText('Update Ready')).toBeInTheDocument()
    await expect
      .element(
        screen.getByText(
          'Version 0.30.0 is ready to install. Restart to apply update.',
        ),
      )
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('button', { name: 'Restart Now' }))
      .toBeInTheDocument()
  })

  it('installs the update when Restart Now is clicked in the ready phase', async () => {
    // Arrange
    const { screen } = await renderToast({
      status: 'ready',
      version: '0.30.0',
    })

    // Act
    await screen.getByRole('button', { name: 'Restart Now' }).click()

    // Assert
    await expect.poll(() => installMock.mock.calls.length).toBe(1)
  })

  it('dismisses the toast when the ready-phase Later button is clicked', async () => {
    // Arrange
    const { screen, store } = await renderToast({
      status: 'ready',
      version: '0.30.0',
    })

    // Act
    await screen.getByRole('button', { name: 'Later' }).click()

    // Assert
    await expect.poll(() => store.getState().update.dismissed).toBe(true)
  })

  it('surfaces the failure message with a single Dismiss action in the error phase', async () => {
    // Arrange + Act
    const { screen } = await renderToast({
      status: 'error',
      error: 'Network timeout while downloading',
    })

    // Assert — the footer action button reads "Dismiss" (the header X also
    // carries an aria-label "Dismiss", so we target the text-bearing footer
    // button to assert the error phase's single CTA).
    await expect.element(screen.getByText('Update Error')).toBeInTheDocument()
    await expect
      .element(screen.getByText('Network timeout while downloading'))
      .toBeInTheDocument()
    await expect.element(screen.getByText('Dismiss')).toBeInTheDocument()
  })

  it('dismisses the toast when the error-phase Dismiss button is clicked', async () => {
    // Arrange
    const { screen, store } = await renderToast({
      status: 'error',
      error: 'Network timeout while downloading',
    })

    // Act — the error phase exposes its own text-bearing "Dismiss" footer
    // button (distinct from the icon-only header X that shares the name).
    await screen.getByText('Dismiss').click()

    // Assert
    await expect.poll(() => store.getState().update.dismissed).toBe(true)
  })

  it('closes the toast via the header X button', async () => {
    // Arrange — any visible phase exposes the header dismiss control.
    const { screen, store } = await renderToast({
      status: 'available',
      version: '0.30.0',
    })

    // Act — in the available phase the only control named "Dismiss" is the
    // icon-only header X (footer buttons are "Later" / "Download").
    await screen.getByRole('button', { name: 'Dismiss' }).click()

    // Assert
    await expect.poll(() => store.getState().update.dismissed).toBe(true)
  })

  it('renders nothing while idle so no toast appears before an update is found', async () => {
    // Arrange + Act
    const { screen } = await renderToast({ status: 'idle' })

    // Assert — no toast title from any visible phase is in the document.
    expect(screen.getByText('Update Available').elements()).toHaveLength(0)
    expect(screen.getByText('Update Ready').elements()).toHaveLength(0)
  })

  it('renders nothing while checking so the toast stays hidden during the version check', async () => {
    // Arrange + Act
    const { screen } = await renderToast({ status: 'checking' })

    // Assert
    expect(screen.getByText('Downloading Update').elements()).toHaveLength(0)
    expect(screen.getByText('Update Error').elements()).toHaveLength(0)
  })

  it('renders nothing once dismissed even when an update is available', async () => {
    // Arrange + Act — a visible phase that the user already dismissed.
    const { screen } = await renderToast({
      status: 'available',
      version: '0.30.0',
      dismissed: true,
    })

    // Assert
    expect(screen.getByText('Update Available').elements()).toHaveLength(0)
  })
})
