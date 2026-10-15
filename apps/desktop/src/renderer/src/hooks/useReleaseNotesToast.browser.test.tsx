import { configureStore } from '@reduxjs/toolkit'
import { StrictMode, type ReactNode } from 'react'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { renderHook } from 'vitest-browser-react'

import rendererPreferencesReducer, {
  syncRendererPreferences,
  rendererPreferencesHydrated,
} from '@/renderer/src/redux/slices/rendererPreferencesSlice'
import { createPreferencesFixture } from '@/renderer/src/test-utils/rendererPreferences'
import {
  RELEASE_NOTES_LAST_SEEN_VERSION_KEY,
  RENDERER_PREFERENCES_STORAGE_KEY,
} from '@/shared/constants'

let fixture: Awaited<ReturnType<typeof createPreferencesFixture>> | undefined

/** Releases the previous test's storage listener before replacement or teardown.
 * @example await disposeReleaseNotesFixture()
 */
async function disposeReleaseNotesFixture(): Promise<void> {
  const previous = fixture
  fixture = undefined
  await previous?.dispose()
}

async function renderReleaseNotes() {
  await disposeReleaseNotesFixture()
  fixture = await createPreferencesFixture()
  const { useReleaseNotesToast } = await import('./useReleaseNotesToast')
  return renderHook(() => useReleaseNotesToast(), { wrapper: fixture.Wrapper })
}

const toastMock = vi.fn()
const windowOpenMock = vi.fn()

vi.mock('sonner', () => ({
  toast: (...args: unknown[]) => toastMock(...args),
}))

beforeEach(() => {
  toastMock.mockReset()
  windowOpenMock.mockReset()
  window.localStorage.clear()
  vi.stubGlobal('__APP_VERSION__', '0.21.1')
  vi.stubGlobal('open', windowOpenMock)
})

afterEach(async () => {
  await disposeReleaseNotesFixture()
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

describe('useReleaseNotesToast', () => {
  test('does not show the release notes toast on first install', async () => {
    // Arrange

    // Act
    await renderReleaseNotes()

    // Assert
    await expect
      .poll(
        () =>
          JSON.parse(
            window.localStorage.getItem(RENDERER_PREFERENCES_STORAGE_KEY) ??
              '{}',
          ).state?.rendererPreferences?.lastSeenVersion,
      )
      .toBe('0.21.1')
    expect(toastMock).not.toHaveBeenCalled()
  })

  test('does not show the release notes toast when the current version was already seen', async () => {
    // Arrange
    window.localStorage.setItem(RELEASE_NOTES_LAST_SEEN_VERSION_KEY, '0.21.1')

    // Act
    await renderReleaseNotes()

    // Assert
    expect(toastMock).not.toHaveBeenCalled()
  })

  test('shows a dismissible post-update release notes toast with the View action', async () => {
    // Arrange
    window.localStorage.setItem(RELEASE_NOTES_LAST_SEEN_VERSION_KEY, '0.21.0')

    // Act
    await renderReleaseNotes()

    // Assert
    await expect.poll(() => toastMock.mock.calls.length).toBe(1)
    expect(toastMock.mock.calls[0]?.[0]).toBe('Updated to v0.21.1')
    expect(toastMock.mock.calls[0]?.[1]).toMatchObject({
      description: 'See what changed in this release.',
      duration: 8000,
      closeButton: true,
      classNames: {
        title: 'text-popover-foreground pl-7',
      },
      action: {
        label: 'View',
      },
    })

    const toastAction = toastMock.mock.calls[0]?.[1]?.action
    expect(toastAction).toMatchObject({ label: 'View' })
    if (typeof toastAction !== 'object' || toastAction === null) {
      throw new Error('Expected the release notes toast to expose an action')
    }
    const actionOnClick = 'onClick' in toastAction ? toastAction.onClick : null
    expect(actionOnClick).toBeTypeOf('function')
    if (typeof actionOnClick !== 'function') {
      throw new Error('Expected the View action to be clickable')
    }
    actionOnClick()
    expect(windowOpenMock).toHaveBeenCalledWith(
      'https://github.com/laststance/skills-desktop/releases/tag/v0.21.1',
      '_blank',
      'noopener,noreferrer',
    )
  })
})

test('waits for hydrated preferences and shows the update cue once across StrictMode and remounts', async () => {
  // Arrange
  const store = configureStore({
    reducer: { rendererPreferences: rendererPreferencesReducer },
  })
  const { useReleaseNotesToast } = await import('./useReleaseNotesToast')
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StrictMode>
      <Provider store={store}>{children}</Provider>
    </StrictMode>
  )

  // Act
  const first = await renderHook(() => useReleaseNotesToast(), { wrapper })

  // Assert
  expect(toastMock).not.toHaveBeenCalled()
  expect(store.getState().rendererPreferences.lastSeenVersion).toBe(null)

  // Act
  store.dispatch(
    syncRendererPreferences({
      markdownPreviewMode: 'reading',
      lastSeenVersion: '0.21.0',
    }),
  )
  store.dispatch(rendererPreferencesHydrated())
  await expect.poll(() => toastMock.mock.calls.length).toBe(1)
  await first.unmount()
  await renderHook(() => useReleaseNotesToast(), { wrapper })

  // Assert
  expect(toastMock).toHaveBeenCalledTimes(1)
  expect(store.getState().rendererPreferences.lastSeenVersion).toBe('0.21.1')
})
