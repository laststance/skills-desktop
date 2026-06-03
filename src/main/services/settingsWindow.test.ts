import type { BrowserWindowConstructorOptions } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type MockBrowserWindowInstance = {
  focus: ReturnType<typeof vi.fn>
  isDestroyed: ReturnType<typeof vi.fn>
  isMinimized: ReturnType<typeof vi.fn>
  loadFile: ReturnType<typeof vi.fn>
  loadURL: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  options: BrowserWindowConstructorOptions
  restore: ReturnType<typeof vi.fn>
  show: ReturnType<typeof vi.fn>
  webContents: {
    setWindowOpenHandler: ReturnType<typeof vi.fn>
  }
}

const electronMock = vi.hoisted(() => {
  const instances: MockBrowserWindowInstance[] = []
  const BrowserWindow = vi.fn(function MockBrowserWindow(
    options: BrowserWindowConstructorOptions,
  ) {
    const instance: MockBrowserWindowInstance = {
      focus: vi.fn(),
      isDestroyed: vi.fn(() => false),
      isMinimized: vi.fn(() => false),
      loadFile: vi.fn(),
      loadURL: vi.fn(),
      on: vi.fn(),
      options,
      restore: vi.fn(),
      show: vi.fn(),
      webContents: { setWindowOpenHandler: vi.fn() },
    }
    instances.push(instance)
    return instance
  })

  return {
    BrowserWindow,
    instances,
    openExternal: vi.fn(),
  }
})

vi.mock('electron', () => ({
  app: { isPackaged: false },
  BrowserWindow: electronMock.BrowserWindow,
  shell: { openExternal: electronMock.openExternal },
}))

/**
 * Imports a fresh settings window module after clearing its singleton state.
 * @returns Fresh Settings window module exports.
 * @example
 * const { createOrFocusSettingsWindow } = await importFreshSettingsWindow()
 */
async function importFreshSettingsWindow(): Promise<{
  createOrFocusSettingsWindow: () => void
}> {
  vi.resetModules()
  return import('./settingsWindow')
}

describe('createOrFocusSettingsWindow', () => {
  beforeEach(() => {
    electronMock.BrowserWindow.mockClear()
    electronMock.instances.length = 0
    delete process.env['ELECTRON_RENDERER_URL']
  })

  afterEach(() => {
    vi.clearAllMocks()
    delete process.env['ELECTRON_RENDERER_URL']
  })

  it("opens Settings without Electron's standard title bar frame while keeping macOS traffic lights", async () => {
    // Arrange
    const { createOrFocusSettingsWindow } = await importFreshSettingsWindow()

    // Act
    createOrFocusSettingsWindow()

    // Assert
    expect(electronMock.BrowserWindow).toHaveBeenCalledTimes(1)
    expect(electronMock.instances[0]?.options).toMatchObject({
      title: 'Settings',
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 16, y: 16 },
    })
  })
})
