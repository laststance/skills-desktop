import { join } from 'path'

import { app, shell, BrowserWindow, Menu, nativeImage, session } from 'electron'

import { isAllowedSkillsUrl } from '../shared/marketplaceUrlPolicy'

import { registerAllHandlers } from './ipc/handlers'
import { loadSettings } from './services/settings'
import { createOrFocusSettingsWindow } from './services/settingsWindow'
import { startupCleanup as runTrashStartupCleanup } from './services/trashService'
import { initAutoUpdater } from './updater'

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason)
})

/**
 * Module-scoped reference to the main window so `app.activate` can
 * recreate it specifically when the user has closed only the main
 * window (Settings may still be open). Pre-fix the activate handler
 * checked `getAllWindows().length === 0`, which was wrong: a Settings
 * window stays a window and would have prevented main from re-opening.
 */
let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    backgroundColor: '#0A0F1C',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  })
  mainWindow = window

  window.on('closed', () => {
    mainWindow = null
  })

  window.on('ready-to-show', () => {
    window.maximize()
    window.show()
  })

  /** Enforce safe webview options before attachment (Electron security recommendation).
   * Deny-by-default: only allow https://skills.sh origins.
   * @param event - Prevents webview attachment when URL is disallowed
   * @param webPreferences - Hardened to disable node integration
   * @param params - Contains the src URL to validate
   */
  window.webContents.on(
    'will-attach-webview',
    (event, webPreferences, params) => {
      if (!isAllowedSkillsUrl(params.src)) {
        event.preventDefault()
        return
      }

      webPreferences.nodeIntegration = false
      webPreferences.contextIsolation = true
      delete webPreferences.preload
    },
  )

  window.webContents.setWindowOpenHandler((details) => {
    try {
      const url = new URL(details.url)
      if (['http:', 'https:'].includes(url.protocol)) {
        shell.openExternal(details.url)
      }
    } catch {
      // Invalid URL, ignore
    }
    return { action: 'deny' }
  })

  // Enforce Content Security Policy in production builds.
  // Use file: and app: schemes explicitly since 'self' may not reliably match file:// origins.
  if (app.isPackaged) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self' file: app:; script-src 'self' file: app:; style-src 'self' 'unsafe-inline' file: app:; font-src 'self' data: file: app:; img-src 'self' data: file: app:; connect-src 'self'",
          ],
        },
      })
    })
  }

  // HMR for renderer based on electron-vite cli
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/**
 * Configure the native macOS About panel shown via the app menu's
 * `role: 'about'` item (or `app.showAboutPanel()`).
 *
 * macOS render order: icon → applicationName → applicationVersion → credits → copyright.
 * The About panel always renders `NSApp.applicationIconImage`; `setAboutPanelOptions`
 * `iconPath` is ignored on macOS. We therefore override the Dock icon via
 * `app.dock.setIcon()` — which updates `applicationIconImage` and propagates to the
 * About panel. In packaged builds the `.icns` bundle already supplies the correct
 * icon, so this is primarily a dev-mode fix.
 *
 * The `credits` block mirrors VS Code's convention — listing runtime versions and a
 * repo link so users can copy the block into bug reports.
 * @example
 * configureAboutPanel() // Call once before createMenu() in app.whenReady()
 */
function configureAboutPanel(): void {
  const appVersion = app.getVersion()
  const electronVersion = process.versions.electron
  const chromiumVersion = process.versions.chrome
  const nodeVersion = process.versions.node
  const platformAndArch = `${process.platform}-${process.arch}`
  const currentYear = new Date().getFullYear()

  // Resolve the bundled app icon (works in both dev and packaged builds).
  // In dev: `__dirname` is `out/main/`, so `../../resources/icon.icns` walks up to the repo root.
  // In packaged: `resources/` is asarUnpacked per electron-builder.yml, and the same
  // relative walk lands in `<app>.app/Contents/Resources/app.asar.unpacked/resources/`.
  const iconPath = join(__dirname, '../../resources/icon.icns')
  const appIconImage = nativeImage.createFromPath(iconPath)
  const isAppIconAvailable = !appIconImage.isEmpty()

  // Force the About panel (and Dock) to use our bundled icon.
  // In dev, the Electron default icon ships otherwise; this pulls in the real brand.
  if (isAppIconAvailable && process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(appIconImage)
  }

  const creditsLines = [
    'Visualize installed Skills and symlink status across AI agents.',
    '',
    `Electron ${electronVersion}  ·  Chromium ${chromiumVersion}`,
    `Node.js ${nodeVersion}  ·  ${platformAndArch}`,
    '',
    'https://github.com/laststance/skills-desktop',
  ]

  app.setAboutPanelOptions({
    applicationName: 'Skills Desktop',
    applicationVersion: appVersion,
    copyright: `© ${currentYear} Laststance.io`,
    credits: creditsLines.join('\n'),
  })
}

// Minimal menu bar
function createMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Settings…',
          accelerator: 'Cmd+,',
          click: (): void => {
            createOrFocusSettingsWindow()
          },
        },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' as const }]),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'close' }],
    },
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

app.whenReady().then(async () => {
  // Register IPC handlers before creating window
  registerAllHandlers()

  // Hydrate settings cache before any window opens so the first
  // `settings:get` from the renderer returns persisted values rather
  // than racing the disk read. Fire-and-forget; loadSettings swallows
  // its own errors and falls back to defaults.
  void loadSettings()

  // Sweep orphan trash entries older than 24h. Fire-and-forget: errors per
  // entry are caught + logged inside trashService; we never block startup.
  void runTrashStartupCleanup()

  // Configure the About panel before the menu wires up `role: 'about'`
  configureAboutPanel()
  createMenu()
  createWindow()

  // Initialize auto updater in production.
  // E2E_DISABLE_UPDATE=1 lets Playwright tests run against a packaged-shaped
  // build without the updater hitting the network or showing toasts.
  if (app.isPackaged && process.env['E2E_DISABLE_UPDATE'] !== '1') {
    initAutoUpdater()
  }

  // Recreate ONLY the main window if it has been closed — the Settings
  // window may still be open, so checking `getAllWindows().length === 0`
  // would incorrectly leave a Settings-only state without a main window
  // when the user clicks the dock icon.
  app.on('activate', () => {
    if (mainWindow === null || mainWindow.isDestroyed()) createWindow()
  })
})

app.on('window-all-closed', () => {
  // macOS: Keep app running when all windows are closed (standard behavior)
})
