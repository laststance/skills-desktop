import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => ({
  isPackaged: false,
  isE2EBackgroundLaunch: false,
}))

const mockInstallExtension = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return mockState.isPackaged
    },
  },
}))

vi.mock('./e2eEnv', () => ({
  get isE2EBackgroundLaunch() {
    return mockState.isE2EBackgroundLaunch
  },
}))

vi.mock('electron-devtools-installer', () => ({
  installExtension: mockInstallExtension,
  REACT_DEVELOPER_TOOLS: { id: 'react-devtools' },
  REDUX_DEVTOOLS: { id: 'redux-devtools' },
}))

import {
  installDevelopmentDevToolsExtensions,
  shouldInstallDevelopmentDevToolsExtensions,
} from './installDevelopmentDevToolsExtensions'

/**
 * DevTools extension loader guards. These tests keep the installer dev-only so
 * production, E2E, and local opt-out launches do not download Chrome Web Store
 * extensions during startup.
 */
describe('installDevelopmentDevToolsExtensions', () => {
  beforeEach(() => {
    mockState.isPackaged = false
    mockState.isE2EBackgroundLaunch = false
    delete process.env['SKILLS_DESKTOP_DISABLE_DEVTOOLS_EXTENSIONS']
    mockInstallExtension.mockReset()
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('installs React and Redux DevTools and logs them on a local dev launch', async () => {
    // Arrange
    mockInstallExtension.mockResolvedValue([
      { name: 'React Developer Tools' },
      { name: 'Redux DevTools' },
    ])

    // Act
    await installDevelopmentDevToolsExtensions()

    // Assert
    expect(mockInstallExtension).toHaveBeenCalledWith(
      [{ id: 'react-devtools' }, { id: 'redux-devtools' }],
      {
        loadExtensionOptions: {
          allowFileAccess: true,
        },
      },
    )
    expect(console.info).toHaveBeenCalledWith(
      'Installed Electron DevTools extensions: React Developer Tools, Redux DevTools',
    )
  })

  it('never downloads DevTools extensions into a packaged production build', async () => {
    // Arrange
    mockState.isPackaged = true

    // Act
    const shouldInstall = shouldInstallDevelopmentDevToolsExtensions()
    await installDevelopmentDevToolsExtensions()

    // Assert
    expect(shouldInstall).toBe(false)
    expect(mockInstallExtension).not.toHaveBeenCalled()
  })

  it('never downloads DevTools extensions during a hidden E2E launch', async () => {
    // Arrange
    mockState.isE2EBackgroundLaunch = true

    // Act
    const shouldInstall = shouldInstallDevelopmentDevToolsExtensions()
    await installDevelopmentDevToolsExtensions()

    // Assert
    expect(shouldInstall).toBe(false)
    expect(mockInstallExtension).not.toHaveBeenCalled()
  })

  it('honors the local opt-out env var and skips the DevTools download', async () => {
    // Arrange
    process.env['SKILLS_DESKTOP_DISABLE_DEVTOOLS_EXTENSIONS'] = '1'

    // Act
    const shouldInstall = shouldInstallDevelopmentDevToolsExtensions()
    await installDevelopmentDevToolsExtensions()

    // Assert
    expect(shouldInstall).toBe(false)
    expect(mockInstallExtension).not.toHaveBeenCalled()
  })

  it('warns but still finishes startup when the DevTools download fails', async () => {
    // Arrange
    const error = new Error('chrome web store unavailable')
    mockInstallExtension.mockRejectedValue(error)

    // Act + Assert
    await expect(
      installDevelopmentDevToolsExtensions(),
    ).resolves.toBeUndefined()

    expect(console.warn).toHaveBeenCalledWith(
      'Failed to install Electron DevTools extensions:',
      error,
    )
  })
})
