import type { BrowserWindowConstructorOptions } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type WindowEventHandler = () => void

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
  // Captured `window.on(event, handler)` registrations so tests can fire
  // the `ready-to-show` / `closed` lifecycle callbacks the source wires up.
  eventHandlers: Map<string, WindowEventHandler>
}

const electronMock = vi.hoisted(() => {
  const instances: MockBrowserWindowInstance[] = []
  const BrowserWindow = vi.fn(function MockBrowserWindow(
    options: BrowserWindowConstructorOptions,
  ) {
    const eventHandlers = new Map<string, WindowEventHandler>()
    const instance: MockBrowserWindowInstance = {
      focus: vi.fn(),
      isDestroyed: vi.fn(() => false),
      isMinimized: vi.fn(() => false),
      loadFile: vi.fn(),
      loadURL: vi.fn(),
      // Record each lifecycle handler keyed by event name for later firing.
      on: vi.fn((event: string, handler: WindowEventHandler) => {
        eventHandlers.set(event, handler)
      }),
      options,
      restore: vi.fn(),
      show: vi.fn(),
      webContents: { setWindowOpenHandler: vi.fn() },
      eventHandlers,
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

  it('focuses the already-open Settings window instead of opening a second one', async () => {
    // Arrange
    const { createOrFocusSettingsWindow } = await importFreshSettingsWindow()
    createOrFocusSettingsWindow()
    const existingWindow = electronMock.instances[0]

    // Act
    createOrFocusSettingsWindow()

    // Assert
    expect(electronMock.BrowserWindow).toHaveBeenCalledTimes(1)
    expect(existingWindow?.focus).toHaveBeenCalledTimes(1)
    expect(existingWindow?.restore).not.toHaveBeenCalled()
  })

  it('un-minimizes the Settings window before focusing it when it was minimized', async () => {
    // Arrange
    const { createOrFocusSettingsWindow } = await importFreshSettingsWindow()
    createOrFocusSettingsWindow()
    const existingWindow = electronMock.instances[0]
    existingWindow?.isMinimized.mockReturnValue(true)

    // Act
    createOrFocusSettingsWindow()

    // Assert
    expect(existingWindow?.restore).toHaveBeenCalledTimes(1)
    expect(existingWindow?.focus).toHaveBeenCalledTimes(1)
  })

  it('opens a fresh Settings window again after the previous one was closed', async () => {
    // Arrange
    const { createOrFocusSettingsWindow } = await importFreshSettingsWindow()
    createOrFocusSettingsWindow()
    const firstWindow = electronMock.instances[0]
    const closedHandler = firstWindow?.eventHandlers.get('closed')

    // Act
    closedHandler?.()
    createOrFocusSettingsWindow()

    // Assert
    expect(electronMock.BrowserWindow).toHaveBeenCalledTimes(2)
    expect(firstWindow?.focus).not.toHaveBeenCalled()
  })

  it('reveals the Settings window once its content is ready to show', async () => {
    // Arrange
    const { createOrFocusSettingsWindow } = await importFreshSettingsWindow()
    createOrFocusSettingsWindow()
    const window = electronMock.instances[0]
    const readyToShowHandler = window?.eventHandlers.get('ready-to-show')

    // Act
    readyToShowHandler?.()

    // Assert
    expect(window?.show).toHaveBeenCalledTimes(1)
  })

  it('keeps the Settings window hidden when launched in E2E background mode', async () => {
    // Arrange
    vi.stubEnv('E2E_BACKGROUND_LAUNCH', '1')
    const { createOrFocusSettingsWindow } = await importFreshSettingsWindow()
    createOrFocusSettingsWindow()
    const window = electronMock.instances[0]
    const readyToShowHandler = window?.eventHandlers.get('ready-to-show')

    // Act
    readyToShowHandler?.()

    // Assert
    expect(window?.show).not.toHaveBeenCalled()
    vi.unstubAllEnvs()
  })

  it('hot-reloads the Settings UI from the dev renderer URL in development', async () => {
    // Arrange
    process.env['ELECTRON_RENDERER_URL'] = 'http://localhost:5173'
    const { createOrFocusSettingsWindow } = await importFreshSettingsWindow()

    // Act
    createOrFocusSettingsWindow()

    // Assert
    const window = electronMock.instances[0]
    expect(window?.loadURL).toHaveBeenCalledWith(
      'http://localhost:5173/settings/index.html',
    )
    expect(window?.loadFile).not.toHaveBeenCalled()
  })
})
