import type { BrowserWindow } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockOpenExternal = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  shell: {
    openExternal: mockOpenExternal,
  },
}))

import { attachExternalLinkHandler } from './attachExternalLinkHandler'

/**
 * Build a BrowserWindow stub that records the window-open handler so a test can
 * invoke it with arbitrary `details.url` values, mirroring what Electron does
 * when a `target="_blank"` anchor or `window.open()` fires inside the window.
 * @returns The stub window plus the captured handler (null until attached).
 * @example
 * const { window, getHandler } = makeWindowStub()
 * attachExternalLinkHandler(window)
 * getHandler()({ url: 'https://example.com' })
 */
function makeWindowStub() {
  type WindowOpenHandler = (details: { url: string }) => { action: 'deny' }
  let capturedHandler: WindowOpenHandler | null = null
  const window = {
    webContents: {
      setWindowOpenHandler: vi.fn((handler: WindowOpenHandler) => {
        capturedHandler = handler
      }),
    },
  } as unknown as BrowserWindow
  // Throwing narrows the return type to the handler so tests skip non-null `!`.
  const getHandler = (): WindowOpenHandler => {
    if (capturedHandler === null) {
      throw new Error('window-open handler was never registered')
    }
    return capturedHandler
  }
  return { window, getHandler }
}

/**
 * Guards the external-link hand-off security contract: http(s) links open in the
 * OS browser, every navigation is denied inside the app window, and hostile
 * schemes / malformed URLs never reach `shell.openExternal`.
 */
describe('attachExternalLinkHandler', () => {
  beforeEach(() => {
    mockOpenExternal.mockReset()
  })

  it('opens an https link in the OS browser instead of navigating the app window', () => {
    // Arrange
    const { window, getHandler } = makeWindowStub()
    attachExternalLinkHandler(window)
    const handler = getHandler()

    // Act
    const result = handler({ url: 'https://example.com/skill' })

    // Assert
    expect(mockOpenExternal).toHaveBeenCalledWith('https://example.com/skill')
    expect(result).toEqual({ action: 'deny' })
  })

  it('opens a plain http link in the OS browser instead of navigating the app window', () => {
    // Arrange
    const { window, getHandler } = makeWindowStub()
    attachExternalLinkHandler(window)
    const handler = getHandler()

    // Act
    const result = handler({ url: 'http://example.com/' })

    // Assert
    expect(mockOpenExternal).toHaveBeenCalledWith('http://example.com/')
    expect(result).toEqual({ action: 'deny' })
  })

  it('refuses to launch a javascript: scheme so marketplace content cannot pivot through the link hook', () => {
    // Arrange
    const { window, getHandler } = makeWindowStub()
    attachExternalLinkHandler(window)
    const handler = getHandler()

    // Act
    const result = handler({ url: 'javascript:alert(1)' })

    // Assert
    expect(mockOpenExternal).not.toHaveBeenCalled()
    expect(result).toEqual({ action: 'deny' })
  })

  it('refuses to launch a file: scheme so a listing cannot open local files via the OS', () => {
    // Arrange
    const { window, getHandler } = makeWindowStub()
    attachExternalLinkHandler(window)
    const handler = getHandler()

    // Act
    const result = handler({ url: 'file:///etc/passwd' })

    // Assert
    expect(mockOpenExternal).not.toHaveBeenCalled()
    expect(result).toEqual({ action: 'deny' })
  })

  it('swallows a malformed URL and still denies the in-window navigation', () => {
    // Arrange
    const { window, getHandler } = makeWindowStub()
    attachExternalLinkHandler(window)
    const handler = getHandler()

    // Act
    const result = handler({ url: 'not a valid url' })

    // Assert
    expect(mockOpenExternal).not.toHaveBeenCalled()
    expect(result).toEqual({ action: 'deny' })
  })
})
