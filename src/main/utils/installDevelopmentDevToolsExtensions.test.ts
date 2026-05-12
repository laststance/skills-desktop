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

  it('installs React and Redux DevTools for local development', async () => {
    mockInstallExtension.mockResolvedValue([
      { name: 'React Developer Tools' },
      { name: 'Redux DevTools' },
    ])

    await installDevelopmentDevToolsExtensions()

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

  it('skips packaged builds', async () => {
    mockState.isPackaged = true

    expect(shouldInstallDevelopmentDevToolsExtensions()).toBe(false)
    await installDevelopmentDevToolsExtensions()

    expect(mockInstallExtension).not.toHaveBeenCalled()
  })

  it('skips hidden E2E launches', async () => {
    mockState.isE2EBackgroundLaunch = true

    expect(shouldInstallDevelopmentDevToolsExtensions()).toBe(false)
    await installDevelopmentDevToolsExtensions()

    expect(mockInstallExtension).not.toHaveBeenCalled()
  })

  it('skips when the local opt-out env var is enabled', async () => {
    process.env['SKILLS_DESKTOP_DISABLE_DEVTOOLS_EXTENSIONS'] = '1'

    expect(shouldInstallDevelopmentDevToolsExtensions()).toBe(false)
    await installDevelopmentDevToolsExtensions()

    expect(mockInstallExtension).not.toHaveBeenCalled()
  })

  it('logs installer errors without blocking startup', async () => {
    const error = new Error('chrome web store unavailable')
    mockInstallExtension.mockRejectedValue(error)

    await expect(
      installDevelopmentDevToolsExtensions(),
    ).resolves.toBeUndefined()

    expect(console.warn).toHaveBeenCalledWith(
      'Failed to install Electron DevTools extensions:',
      error,
    )
  })
})
