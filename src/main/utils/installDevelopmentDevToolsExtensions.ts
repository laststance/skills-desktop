import { app } from 'electron'

import { isE2EBackgroundLaunch } from './e2eEnv'

/**
 * Environment variable for temporarily disabling Chrome DevTools extension
 * installation while debugging local startup problems.
 */
const DISABLE_DEVTOOLS_EXTENSIONS_ENV =
  'SKILLS_DESKTOP_DISABLE_DEVTOOLS_EXTENSIONS'

/**
 * Decides whether this process should install Electron DevTools extensions.
 *
 * The extensions are only useful during local interactive development. They
 * download Chrome Web Store packages into Electron's `userData`, so packaged
 * builds and hidden Playwright launches skip them to avoid network work and
 * test flake.
 *
 * @returns `true` when the current process is a local interactive dev launch.
 * @example
 * if (shouldInstallDevelopmentDevToolsExtensions()) await installDevelopmentDevToolsExtensions()
 */
export function shouldInstallDevelopmentDevToolsExtensions(): boolean {
  // Production builds should not download or load debugging extensions.
  if (app.isPackaged) return false

  // E2E launches drive the app through Playwright and should stay deterministic.
  if (isE2EBackgroundLaunch) return false

  // Local escape hatch for debugging installer/network issues.
  if (process.env[DISABLE_DEVTOOLS_EXTENSIONS_ENV] === '1') return false

  return true
}

/**
 * Installs React DevTools and Redux DevTools into Electron's default session.
 *
 * Called from `app.whenReady()` before windows are created so the extensions
 * are available when the user opens DevTools. Installer failures are non-fatal:
 * the app should still start if Chrome Web Store downloads fail or the user is
 * offline.
 *
 * @returns A promise that resolves after installation is attempted.
 * @example
 * await installDevelopmentDevToolsExtensions()
 */
export async function installDevelopmentDevToolsExtensions(): Promise<void> {
  if (!shouldInstallDevelopmentDevToolsExtensions()) return

  try {
    const { installExtension, REACT_DEVELOPER_TOOLS, REDUX_DEVTOOLS } =
      await import('electron-devtools-installer')

    const extensions = await installExtension(
      [REACT_DEVELOPER_TOOLS, REDUX_DEVTOOLS],
      {
        loadExtensionOptions: {
          // Required when local builds render from loadFile() instead of Vite dev URL.
          allowFileAccess: true,
        },
      },
    )
    const extensionNames = extensions.map((extension) => extension.name)

    console.info(
      `Installed Electron DevTools extensions: ${extensionNames.join(', ')}`,
    )
  } catch (error) {
    console.warn('Failed to install Electron DevTools extensions:', error)
  }
}
