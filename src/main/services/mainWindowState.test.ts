import type { BrowserWindow } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getMainWindow, setMainWindow } from './mainWindowState'

/**
 * Build the minimal BrowserWindow surface `getMainWindow` queries (only
 * `isDestroyed`), so node-lane tests can drive the live/destroyed branches
 * without instantiating a real Electron window.
 * @param isDestroyed - Whether the stub reports itself as destroyed.
 * @returns A BrowserWindow-typed stub exposing a controllable `isDestroyed`.
 * @example
 * setMainWindow(makeWindowStub(false)) // window stays handed out
 */
function makeWindowStub(isDestroyed: boolean): BrowserWindow {
  // Only `isDestroyed` is read by the module; cast is necessary because a real
  // BrowserWindow cannot be constructed in the node lane.
  return {
    isDestroyed: vi.fn(() => isDestroyed),
  } as unknown as BrowserWindow
}

describe('main window reference store', () => {
  beforeEach(() => {
    // Reset the module-scoped reference so each spec starts from "no window".
    setMainWindow(null)
  })

  it('reports no window before any main window has been created', () => {
    // Arrange — fresh state from beforeEach: no window has been stored

    // Act
    const currentWindow = getMainWindow()

    // Assert
    expect(currentWindow).toBeNull()
  })

  it('hands back the live main window while it is open', () => {
    // Arrange
    const liveWindow = makeWindowStub(false)
    setMainWindow(liveWindow)

    // Act
    const currentWindow = getMainWindow()

    // Assert
    expect(currentWindow).toBe(liveWindow)
  })

  it('stops handing out the window once Electron has destroyed it', () => {
    // Arrange
    const destroyedWindow = makeWindowStub(true)
    setMainWindow(destroyedWindow)

    // Act
    const currentWindow = getMainWindow()

    // Assert
    expect(currentWindow).toBeNull()
  })

  it('clears the stored window when passed null on the close event', () => {
    // Arrange
    setMainWindow(makeWindowStub(false))

    // Act
    setMainWindow(null)

    // Assert
    expect(getMainWindow()).toBeNull()
  })
})
