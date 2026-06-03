import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from 'vitest-browser-react'

import { RELEASE_NOTES_LAST_SEEN_VERSION_KEY } from '@/shared/constants'

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

afterEach(() => {
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

describe('useReleaseNotesToast', () => {
  it('does not show the release notes toast on first install', async () => {
    // Arrange
    const { useReleaseNotesToast } = await import('./useReleaseNotesToast')

    // Act
    await renderHook(() => useReleaseNotesToast())

    // Assert
    await expect
      .poll(() =>
        window.localStorage.getItem(RELEASE_NOTES_LAST_SEEN_VERSION_KEY),
      )
      .toBe('0.21.1')
    expect(toastMock).not.toHaveBeenCalled()
  })

  it('does not show the release notes toast when the current version was already seen', async () => {
    // Arrange
    window.localStorage.setItem(RELEASE_NOTES_LAST_SEEN_VERSION_KEY, '0.21.1')
    const { useReleaseNotesToast } = await import('./useReleaseNotesToast')

    // Act
    await renderHook(() => useReleaseNotesToast())

    // Assert
    expect(toastMock).not.toHaveBeenCalled()
  })

  it('shows a dismissible post-update release notes toast with the View action', async () => {
    // Arrange
    window.localStorage.setItem(RELEASE_NOTES_LAST_SEEN_VERSION_KEY, '0.21.0')
    const { useReleaseNotesToast } = await import('./useReleaseNotesToast')

    // Act
    await renderHook(() => useReleaseNotesToast())

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
